use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use argon2::Argon2;
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit},
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use subtle::ConstantTimeEq;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::ViaError;

const LEGACY_VERIFIER: &[u8] = b"via-secret-store-v1";
const VERIFIER: &[u8] = b"via-secret-store-v2";
const CURRENT_VERSION: i64 = 2;
const RECOVERY_CODE_COUNT: usize = 10;

pub struct SecretStore {
    path: PathBuf,
    state: Mutex<SecretStoreState>,
}

struct SecretStoreState {
    key: Option<Zeroizing<[u8; 32]>>,
    ephemeral: HashMap<Uuid, String>,
}

struct EncryptedValue {
    nonce: [u8; 24],
    ciphertext: Vec<u8>,
}

pub(super) struct PreparedSecret {
    id: Uuid,
    encrypted: EncryptedValue,
}

impl PreparedSecret {
    pub(super) fn id(&self) -> Uuid {
        self.id
    }
}

struct Metadata {
    version: i64,
    salt: Vec<u8>,
    verifier: EncryptedValue,
    wrapped_data_key: Option<EncryptedValue>,
}

struct RecoveryRecord {
    salt: [u8; 16],
    verifier: [u8; 32],
    wrapped_data_key: EncryptedValue,
}

impl SecretStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            state: Mutex::new(SecretStoreState {
                key: None,
                ephemeral: HashMap::new(),
            }),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn initialize(&self, master_password: &str) -> Result<Vec<String>, ViaError> {
        validate_master_password(master_password)?;

        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(database_error)?;
        let configured: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM secret_store_metadata WHERE id = 1)",
                [],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if configured {
            return Err(ViaError::Storage(
                "secret store is already initialized".into(),
            ));
        }

        let data_key = Zeroizing::new(random_key()?);
        let (salt, verifier, wrapped_data_key) =
            master_password_records(master_password, &data_key)?;
        insert_metadata(&transaction, &salt, &verifier, &wrapped_data_key)?;
        let recovery_codes = replace_recovery_codes(&transaction, &data_key)?;
        let mut state = self.state.lock().map_err(lock_error)?;
        transaction.commit().map_err(database_error)?;

        state.key = Some(data_key);
        Ok(recovery_codes)
    }

    /// Compatibility wrapper for callers that predate recovery-code setup.
    pub fn setup(&self, master_password: &str) -> Result<(), ViaError> {
        self.initialize(master_password).map(|_| ())
    }

    pub fn is_configured(&self) -> Result<bool, ViaError> {
        self.connection()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM secret_store_metadata WHERE id = 1)",
                [],
                |row| row.get(0),
            )
            .map_err(database_error)
    }

    /// Sets the first master password, or unlocks the existing encrypted store.
    /// It deliberately never resets an existing store, so a mistyped password
    /// cannot orphan persisted secrets.
    pub fn unlock_or_setup(&self, master_password: &str) -> Result<(), ViaError> {
        validate_master_password(master_password)?;
        if self.is_configured()? {
            self.unlock(master_password)
        } else {
            self.setup(master_password)
        }
    }

    pub fn unlock(&self, master_password: &str) -> Result<(), ViaError> {
        self.unlock_and_migrate(master_password).map(|_| ())
    }

    pub fn unlock_and_migrate(
        &self,
        master_password: &str,
    ) -> Result<Option<Vec<String>>, ViaError> {
        validate_master_password(master_password)?;

        let connection = self.connection()?;
        let metadata = load_metadata(&connection)?.ok_or(ViaError::SecretStoreLocked)?;
        match metadata.version {
            1 => self.unlock_and_migrate_legacy(connection, metadata, master_password),
            CURRENT_VERSION => {
                let data_key = Zeroizing::new(unlock_data_key(master_password, metadata)?);
                self.state.lock().map_err(lock_error)?.key = Some(data_key);
                Ok(None)
            }
            _ => Err(ViaError::Storage("unsupported secret store version".into())),
        }
    }

    pub fn recover(
        &self,
        recovery_code: &str,
        new_master_password: &str,
    ) -> Result<Vec<String>, ViaError> {
        validate_recovery_code(recovery_code)?;
        validate_master_password(new_master_password)?;

        if !self.path.exists() {
            return Err(ViaError::InvalidRecoveryCode);
        }
        let mut connection = Connection::open(&self.path).map_err(database_error)?;
        connection
            .busy_timeout(Duration::from_secs(30))
            .map_err(database_error)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let records = load_recovery_records(&transaction)?;
        let mut recovered_data_key = None;

        for record in records {
            let derived = Zeroizing::new(derive_recovery_material(recovery_code, &record.salt)?);
            let is_match = bool::from(derived[..32].ct_eq(&record.verifier));
            if is_match && recovered_data_key.is_none() {
                let mut wrapping_key = Zeroizing::new([0_u8; 32]);
                wrapping_key.copy_from_slice(&derived[32..]);
                let plaintext = Zeroizing::new(
                    decrypt(&wrapping_key, &record.wrapped_data_key)
                        .map_err(|_| ViaError::InvalidRecoveryCode)?,
                );
                let data_key = array_from_slice::<32>(&plaintext)
                    .map_err(|_| ViaError::InvalidRecoveryCode)?;
                recovered_data_key = Some(Zeroizing::new(data_key));
            }
        }

        let data_key = recovered_data_key.ok_or(ViaError::InvalidRecoveryCode)?;
        let (salt, verifier, wrapped_data_key) =
            master_password_records(new_master_password, &data_key)?;
        insert_metadata(&transaction, &salt, &verifier, &wrapped_data_key)?;
        let recovery_codes = replace_recovery_codes(&transaction, &data_key)?;
        let mut state = self.state.lock().map_err(lock_error)?;
        transaction.commit().map_err(database_error)?;

        state.key = Some(data_key);
        Ok(recovery_codes)
    }

    pub fn lock(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.key.take();
        }
    }

    pub fn put(&self, value: impl Into<String>) -> Result<Uuid, ViaError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(ViaError::InvalidSecret);
        }
        let id = Uuid::new_v4();
        let mut state = self.state.lock().map_err(lock_error)?;
        if let Some(key) = state.key.as_ref() {
            let encrypted = encrypt(key, value.as_bytes())?;
            self.connection()?
                .execute(
                    "INSERT INTO encrypted_secrets (id, nonce, ciphertext) VALUES (?1, ?2, ?3)",
                    params![
                        id.to_string(),
                        encrypted.nonce.as_slice(),
                        encrypted.ciphertext
                    ],
                )
                .map_err(database_error)?;
        } else {
            state.ephemeral.insert(id, value);
        }
        Ok(id)
    }

    pub(super) fn prepare_encrypted(
        &self,
        value: impl Into<String>,
    ) -> Result<PreparedSecret, ViaError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(ViaError::InvalidSecret);
        }
        let state = self.state.lock().map_err(lock_error)?;
        let key = state.key.as_ref().ok_or(ViaError::SecretStoreLocked)?;
        Ok(PreparedSecret {
            id: Uuid::new_v4(),
            encrypted: encrypt(key, value.as_bytes())?,
        })
    }

    pub(super) fn insert_prepared(
        &self,
        transaction: &Transaction<'_>,
        prepared: &PreparedSecret,
    ) -> Result<(), ViaError> {
        transaction
            .execute(
                "INSERT INTO encrypted_secrets (id, nonce, ciphertext) VALUES (?1, ?2, ?3)",
                params![
                    prepared.id.to_string(),
                    prepared.encrypted.nonce.as_slice(),
                    prepared.encrypted.ciphertext
                ],
            )
            .map_err(database_error)?;
        Ok(())
    }

    pub fn get(&self, id: Uuid) -> Result<String, ViaError> {
        let state = self.state.lock().map_err(lock_error)?;
        if let Some(value) = state.ephemeral.get(&id) {
            return Ok(value.clone());
        }
        let key = state.key.as_ref().ok_or(ViaError::SecretStoreLocked)?;
        let encrypted = self
            .connection()?
            .query_row(
                "SELECT nonce, ciphertext FROM encrypted_secrets WHERE id = ?1",
                [id.to_string()],
                |row| {
                    Ok(EncryptedValue {
                        nonce: array_from_vec::<24>(row.get::<_, Vec<u8>>(0)?)
                            .map_err(to_sql_error)?,
                        ciphertext: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or(ViaError::SecretStoreLocked)?;
        let plaintext = decrypt(key, &encrypted)
            .map_err(|_| ViaError::Storage("encrypted secret authentication failed".into()))?;
        String::from_utf8(plaintext).map_err(|error| ViaError::Storage(error.to_string()))
    }

    fn unlock_and_migrate_legacy(
        &self,
        mut connection: Connection,
        metadata: Metadata,
        master_password: &str,
    ) -> Result<Option<Vec<String>>, ViaError> {
        let salt = array_from_vec::<16>(metadata.salt)?;
        let legacy_key = Zeroizing::new(derive_key(master_password, &salt)?);
        let verifier = decrypt(&legacy_key, &metadata.verifier)?;
        if !bool::from(verifier.as_slice().ct_eq(LEGACY_VERIFIER)) {
            return Err(ViaError::InvalidMasterPassword);
        }

        let transaction = connection.transaction().map_err(database_error)?;
        let legacy_secrets = load_encrypted_secrets(&transaction)?;
        let data_key = Zeroizing::new(random_key()?);
        let mut migrated_secrets = Vec::with_capacity(legacy_secrets.len());
        for (id, encrypted) in legacy_secrets {
            let plaintext =
                Zeroizing::new(decrypt(&legacy_key, &encrypted).map_err(|_| {
                    ViaError::Storage("encrypted secret authentication failed".into())
                })?);
            let migrated = encrypt(&data_key, &plaintext)?;
            migrated_secrets.push((id, migrated));
        }

        for (id, encrypted) in migrated_secrets {
            transaction
                .execute(
                    "UPDATE encrypted_secrets SET nonce = ?1, ciphertext = ?2 WHERE id = ?3",
                    params![encrypted.nonce.as_slice(), encrypted.ciphertext, id],
                )
                .map_err(database_error)?;
        }
        transaction
            .execute("DROP TABLE secret_store_metadata", [])
            .map_err(database_error)?;
        create_metadata_table(&transaction)?;
        create_recovery_codes_table(&transaction)?;
        let (new_salt, new_verifier, wrapped_data_key) =
            master_password_records(master_password, &data_key)?;
        insert_metadata(&transaction, &new_salt, &new_verifier, &wrapped_data_key)?;
        let recovery_codes = replace_recovery_codes(&transaction, &data_key)?;
        let mut state = self.state.lock().map_err(lock_error)?;
        transaction.commit().map_err(database_error)?;

        state.key = Some(data_key);
        Ok(Some(recovery_codes))
    }

    fn connection(&self) -> Result<Connection, ViaError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let mut connection = Connection::open(&self.path).map_err(database_error)?;
        ensure_schema(&mut connection)?;
        Ok(connection)
    }
}

fn ensure_schema(connection: &mut Connection) -> Result<(), ViaError> {
    let transaction = connection.transaction().map_err(database_error)?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS encrypted_secrets (
               id TEXT PRIMARY KEY NOT NULL,
               nonce BLOB NOT NULL,
               ciphertext BLOB NOT NULL
             );",
        )
        .map_err(database_error)?;

    let metadata_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'secret_store_metadata')",
            [],
            |row| row.get(0),
        )
        .map_err(database_error)?;
    if !metadata_exists {
        create_metadata_table(&transaction)?;
        create_recovery_codes_table(&transaction)?;
    } else {
        let columns = {
            let mut statement = transaction
                .prepare("PRAGMA table_info(secret_store_metadata)")
                .map_err(database_error)?;
            statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(database_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(database_error)?
        };
        let has_wrapped_data_key = columns
            .iter()
            .any(|column| column == "wrapped_data_key_nonce")
            && columns
                .iter()
                .any(|column| column == "wrapped_data_key_ciphertext");
        if has_wrapped_data_key {
            create_recovery_codes_table(&transaction)?;
        } else {
            let configured: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM secret_store_metadata WHERE id = 1)",
                    [],
                    |row| row.get(0),
                )
                .map_err(database_error)?;
            if !configured {
                transaction
                    .execute("DROP TABLE secret_store_metadata", [])
                    .map_err(database_error)?;
                create_metadata_table(&transaction)?;
                create_recovery_codes_table(&transaction)?;
            }
        }
    }
    transaction.commit().map_err(database_error)
}

fn create_metadata_table(transaction: &Transaction<'_>) -> Result<(), ViaError> {
    transaction
        .execute_batch(
            "CREATE TABLE secret_store_metadata (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               version INTEGER NOT NULL,
               salt BLOB NOT NULL,
               verifier_nonce BLOB NOT NULL,
               verifier_ciphertext BLOB NOT NULL,
               wrapped_data_key_nonce BLOB NOT NULL,
               wrapped_data_key_ciphertext BLOB NOT NULL
             );",
        )
        .map_err(database_error)
}

fn create_recovery_codes_table(transaction: &Transaction<'_>) -> Result<(), ViaError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS recovery_codes (
               id TEXT PRIMARY KEY NOT NULL,
               salt BLOB NOT NULL,
               verifier BLOB NOT NULL,
               wrapped_data_key_nonce BLOB NOT NULL,
               wrapped_data_key_ciphertext BLOB NOT NULL
             );",
        )
        .map_err(database_error)
}

fn load_metadata(connection: &Connection) -> Result<Option<Metadata>, ViaError> {
    let has_wrapped_data_key = metadata_columns(connection)?
        .iter()
        .any(|column| column == "wrapped_data_key_nonce");
    if !has_wrapped_data_key {
        return connection
            .query_row(
                "SELECT version, salt, verifier_nonce, verifier_ciphertext
                 FROM secret_store_metadata WHERE id = 1",
                [],
                |row| {
                    Ok(Metadata {
                        version: row.get(0)?,
                        salt: row.get(1)?,
                        verifier: EncryptedValue {
                            nonce: array_from_vec::<24>(row.get::<_, Vec<u8>>(2)?)
                                .map_err(to_sql_error)?,
                            ciphertext: row.get(3)?,
                        },
                        wrapped_data_key: None,
                    })
                },
            )
            .optional()
            .map_err(database_error);
    }

    connection
        .query_row(
            "SELECT version, salt, verifier_nonce, verifier_ciphertext,
                    wrapped_data_key_nonce, wrapped_data_key_ciphertext
             FROM secret_store_metadata WHERE id = 1",
            [],
            |row| {
                let version = row.get(0)?;
                let wrapped_data_key = if version == 1 {
                    None
                } else {
                    Some(EncryptedValue {
                        nonce: array_from_vec::<24>(row.get::<_, Vec<u8>>(4)?)
                            .map_err(to_sql_error)?,
                        ciphertext: row.get(5)?,
                    })
                };
                Ok(Metadata {
                    version,
                    salt: row.get(1)?,
                    verifier: EncryptedValue {
                        nonce: array_from_vec::<24>(row.get::<_, Vec<u8>>(2)?)
                            .map_err(to_sql_error)?,
                        ciphertext: row.get(3)?,
                    },
                    wrapped_data_key,
                })
            },
        )
        .optional()
        .map_err(database_error)
}

fn unlock_data_key(master_password: &str, metadata: Metadata) -> Result<[u8; 32], ViaError> {
    let salt = array_from_vec::<16>(metadata.salt)?;
    let wrapping_key = Zeroizing::new(derive_key(master_password, &salt)?);
    let verifier = decrypt(&wrapping_key, &metadata.verifier)?;
    if !bool::from(verifier.as_slice().ct_eq(VERIFIER)) {
        return Err(ViaError::InvalidMasterPassword);
    }
    let wrapped_data_key = metadata
        .wrapped_data_key
        .ok_or_else(|| ViaError::Storage("missing wrapped data key".into()))?;
    let plaintext = Zeroizing::new(decrypt(&wrapping_key, &wrapped_data_key)?);
    array_from_slice::<32>(&plaintext)
}

fn master_password_records(
    master_password: &str,
    data_key: &[u8; 32],
) -> Result<([u8; 16], EncryptedValue, EncryptedValue), ViaError> {
    let salt = random_bytes()?;
    let wrapping_key = Zeroizing::new(derive_key(master_password, &salt)?);
    let verifier = encrypt(&wrapping_key, VERIFIER)?;
    let wrapped_data_key = encrypt(&wrapping_key, data_key)?;
    Ok((salt, verifier, wrapped_data_key))
}

fn insert_metadata(
    transaction: &Transaction<'_>,
    salt: &[u8; 16],
    verifier: &EncryptedValue,
    wrapped_data_key: &EncryptedValue,
) -> Result<(), ViaError> {
    transaction
        .execute(
            "INSERT OR REPLACE INTO secret_store_metadata (
               id, version, salt, verifier_nonce, verifier_ciphertext,
               wrapped_data_key_nonce, wrapped_data_key_ciphertext
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                CURRENT_VERSION,
                salt.as_slice(),
                verifier.nonce.as_slice(),
                verifier.ciphertext,
                wrapped_data_key.nonce.as_slice(),
                wrapped_data_key.ciphertext,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn replace_recovery_codes(
    transaction: &Transaction<'_>,
    data_key: &[u8; 32],
) -> Result<Vec<String>, ViaError> {
    transaction
        .execute("DELETE FROM recovery_codes", [])
        .map_err(database_error)?;

    let mut recovery_codes = Vec::with_capacity(RECOVERY_CODE_COUNT);
    for _ in 0..RECOVERY_CODE_COUNT {
        let code = Uuid::new_v4().hyphenated().to_string();
        let salt = random_bytes()?;
        let derived = Zeroizing::new(derive_recovery_material(&code, &salt)?);
        let verifier = &derived[..32];
        let mut wrapping_key = Zeroizing::new([0_u8; 32]);
        wrapping_key.copy_from_slice(&derived[32..]);
        let wrapped_data_key = encrypt(&wrapping_key, data_key)?;

        transaction
            .execute(
                "INSERT INTO recovery_codes (
                   id, salt, verifier, wrapped_data_key_nonce, wrapped_data_key_ciphertext
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    Uuid::new_v4().to_string(),
                    salt.as_slice(),
                    verifier,
                    wrapped_data_key.nonce.as_slice(),
                    wrapped_data_key.ciphertext,
                ],
            )
            .map_err(database_error)?;
        recovery_codes.push(code);
    }
    Ok(recovery_codes)
}

fn load_recovery_records(connection: &Connection) -> Result<Vec<RecoveryRecord>, ViaError> {
    if !table_exists(connection, "recovery_codes")? {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare(
            "SELECT salt, verifier, wrapped_data_key_nonce, wrapped_data_key_ciphertext
             FROM recovery_codes",
        )
        .map_err(database_error)?;
    statement
        .query_map([], |row| {
            Ok(RecoveryRecord {
                salt: array_from_vec::<16>(row.get::<_, Vec<u8>>(0)?).map_err(to_sql_error)?,
                verifier: array_from_vec::<32>(row.get::<_, Vec<u8>>(1)?).map_err(to_sql_error)?,
                wrapped_data_key: EncryptedValue {
                    nonce: array_from_vec::<24>(row.get::<_, Vec<u8>>(2)?).map_err(to_sql_error)?,
                    ciphertext: row.get(3)?,
                },
            })
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)
}

fn metadata_columns(connection: &Connection) -> Result<Vec<String>, ViaError> {
    let mut statement = connection
        .prepare("PRAGMA table_info(secret_store_metadata)")
        .map_err(database_error)?;
    statement
        .query_map([], |row| row.get(1))
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)
}

fn table_exists(connection: &Connection, name: &str) -> Result<bool, ViaError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [name],
            |row| row.get(0),
        )
        .map_err(database_error)
}

fn load_encrypted_secrets(
    transaction: &Transaction<'_>,
) -> Result<Vec<(String, EncryptedValue)>, ViaError> {
    let mut statement = transaction
        .prepare("SELECT id, nonce, ciphertext FROM encrypted_secrets")
        .map_err(database_error)?;
    statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                EncryptedValue {
                    nonce: array_from_vec::<24>(row.get::<_, Vec<u8>>(1)?).map_err(to_sql_error)?,
                    ciphertext: row.get(2)?,
                },
            ))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)
}

fn validate_master_password(password: &str) -> Result<(), ViaError> {
    if password.trim().is_empty() {
        Err(ViaError::InvalidMasterPassword)
    } else {
        Ok(())
    }
}

fn validate_recovery_code(recovery_code: &str) -> Result<(), ViaError> {
    if recovery_code.len() != 36 || Uuid::parse_str(recovery_code).is_err() {
        Err(ViaError::InvalidRecoveryCode)
    } else {
        Ok(())
    }
}

fn derive_key(password: &str, salt: &[u8; 16]) -> Result<[u8; 32], ViaError> {
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| ViaError::Storage(error.to_string()))?;
    Ok(key)
}

fn derive_recovery_material(code: &str, salt: &[u8; 16]) -> Result<[u8; 64], ViaError> {
    let mut material = [0_u8; 64];
    Argon2::default()
        .hash_password_into(code.as_bytes(), salt, &mut material)
        .map_err(|error| ViaError::Storage(error.to_string()))?;
    Ok(material)
}

fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<EncryptedValue, ViaError> {
    let nonce = random_nonce()?;
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|error| ViaError::Storage(error.to_string()))?;
    let nonce_ref =
        XNonce::try_from(&nonce[..]).map_err(|error| ViaError::Storage(error.to_string()))?;
    let ciphertext = cipher
        .encrypt(&nonce_ref, plaintext)
        .map_err(|error| ViaError::Storage(error.to_string()))?;
    Ok(EncryptedValue { nonce, ciphertext })
}

fn decrypt(key: &[u8; 32], record: &EncryptedValue) -> Result<Vec<u8>, ViaError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|error| ViaError::Storage(error.to_string()))?;
    let nonce = XNonce::try_from(&record.nonce[..])
        .map_err(|error| ViaError::Storage(error.to_string()))?;
    cipher
        .decrypt(&nonce, record.ciphertext.as_ref())
        .map_err(|_| ViaError::InvalidMasterPassword)
}

fn array_from_vec<const N: usize>(value: Vec<u8>) -> Result<[u8; N], ViaError> {
    value
        .try_into()
        .map_err(|_| ViaError::Storage("invalid encrypted record length".into()))
}
fn array_from_slice<const N: usize>(value: &[u8]) -> Result<[u8; N], ViaError> {
    value
        .try_into()
        .map_err(|_| ViaError::Storage("invalid encrypted record length".into()))
}
fn database_error(error: rusqlite::Error) -> ViaError {
    ViaError::Storage(error.to_string())
}
fn storage_error(error: std::io::Error) -> ViaError {
    ViaError::Storage(error.to_string())
}
fn lock_error<T>(_error: std::sync::PoisonError<T>) -> ViaError {
    ViaError::Storage("secret store lock poisoned".into())
}
fn to_sql_error(error: ViaError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!("{error:?}"))))
}
fn random_bytes() -> Result<[u8; 16], ViaError> {
    random_array()
}
fn random_key() -> Result<[u8; 32], ViaError> {
    random_array()
}
fn random_nonce() -> Result<[u8; 24], ViaError> {
    random_array()
}
fn random_array<const N: usize>() -> Result<[u8; N], ViaError> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes)
        .map_err(|_| ViaError::Storage("operating system randomness is unavailable".into()))?;
    Ok(bytes)
}
