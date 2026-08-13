use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use argon2::Argon2;
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit},
};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::ViaError;

const VERIFIER: &[u8] = b"via-secret-store-v1";

pub struct SecretStore {
    path: PathBuf,
    state: Mutex<SecretStoreState>,
}

struct SecretStoreState {
    key: Option<[u8; 32]>,
    ephemeral: HashMap<Uuid, String>,
}

struct EncryptedValue {
    nonce: [u8; 24],
    ciphertext: Vec<u8>,
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

    pub fn setup(&self, master_password: &str) -> Result<(), ViaError> {
        let connection = self.connection()?;
        let salt = random_bytes();
        let key = derive_key(master_password, &salt)?;
        let verifier = encrypt(&key, VERIFIER)?;
        connection.execute(
            "INSERT OR REPLACE INTO secret_store_metadata (id, version, salt, verifier_nonce, verifier_ciphertext) VALUES (1, 1, ?1, ?2, ?3)",
            params![salt.as_slice(), verifier.nonce.as_slice(), verifier.ciphertext],
        ).map_err(database_error)?;
        let mut state = self.state.lock().map_err(lock_error)?;
        state.key = Some(key);
        Ok(())
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
        if self.is_configured()? {
            self.unlock(master_password)
        } else {
            self.setup(master_password)
        }
    }

    pub fn unlock(&self, master_password: &str) -> Result<(), ViaError> {
        let connection = self.connection()?;
        let metadata = connection.query_row(
            "SELECT version, salt, verifier_nonce, verifier_ciphertext FROM secret_store_metadata WHERE id = 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?, row.get::<_, Vec<u8>>(2)?, row.get::<_, Vec<u8>>(3)?)),
        ).optional().map_err(database_error)?.ok_or(ViaError::SecretStoreLocked)?;
        if metadata.0 != 1 {
            return Err(ViaError::Storage("unsupported secret store version".into()));
        }
        let salt = array_from_vec::<16>(metadata.1)?;
        let key = derive_key(master_password, &salt)?;
        let verifier = EncryptedValue {
            nonce: array_from_vec::<24>(metadata.2)?,
            ciphertext: metadata.3,
        };
        if decrypt(&key, &verifier).ok().as_deref() != Some(VERIFIER) {
            return Err(ViaError::InvalidMasterPassword);
        }
        self.state.lock().map_err(lock_error)?.key = Some(key);
        Ok(())
    }

    pub fn lock(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(key) = state.key.as_mut() {
                key.zeroize();
            }
            state.key = None;
        }
    }

    pub fn put(&self, value: impl Into<String>) -> Result<Uuid, ViaError> {
        let id = Uuid::new_v4();
        let value = value.into();
        let mut state = self.state.lock().map_err(lock_error)?;
        if let Some(key) = state.key {
            let encrypted = encrypt(&key, value.as_bytes())?;
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

    pub fn get(&self, id: Uuid) -> Result<String, ViaError> {
        let state = self.state.lock().map_err(lock_error)?;
        if let Some(value) = state.ephemeral.get(&id) {
            return Ok(value.clone());
        }
        let key = state.key.ok_or(ViaError::SecretStoreLocked)?;
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
        String::from_utf8(decrypt(&key, &encrypted)?)
            .map_err(|error| ViaError::Storage(error.to_string()))
    }

    fn connection(&self) -> Result<Connection, ViaError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let connection = Connection::open(&self.path).map_err(database_error)?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS encrypted_secrets (id TEXT PRIMARY KEY NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL);
             CREATE TABLE IF NOT EXISTS secret_store_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL, salt BLOB NOT NULL, verifier_nonce BLOB NOT NULL, verifier_ciphertext BLOB NOT NULL);",
        ).map_err(database_error)?;
        Ok(connection)
    }
}

fn derive_key(password: &str, salt: &[u8; 16]) -> Result<[u8; 32], ViaError> {
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| ViaError::Storage(error.to_string()))?;
    Ok(key)
}

fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<EncryptedValue, ViaError> {
    let nonce = random_nonce();
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
fn random_bytes() -> [u8; 16] {
    *Uuid::new_v4().as_bytes()
}
fn random_nonce() -> [u8; 24] {
    let first = *Uuid::new_v4().as_bytes();
    let second = *Uuid::new_v4().as_bytes();
    let mut nonce = [0_u8; 24];
    nonce[..16].copy_from_slice(&first);
    nonce[16..].copy_from_slice(&second[..8]);
    nonce
}
