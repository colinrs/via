use argon2::Argon2;
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit},
};
use rusqlite::{Connection, params};
use std::sync::{Arc, Barrier};
use uuid::Uuid;
use via::{SecretStore, ViaError};

#[test]
fn encrypted_secret_requires_the_correct_master_password_after_locking() {
    let store = SecretStore::new(temp_secret_path());
    store.setup("correct horse battery staple").unwrap();
    assert_eq!(
        &std::fs::read(store.path()).unwrap()[..16],
        b"SQLite format 3\0"
    );
    let secret_id = store.put("ssh-password").unwrap();

    store.lock();
    assert!(store.unlock("wrong password").is_err());
    store.unlock("correct horse battery staple").unwrap();
    assert_eq!(store.get(secret_id).unwrap(), "ssh-password");
}

#[test]
fn secrets_are_not_persisted_without_a_master_password() {
    let store = SecretStore::new(temp_secret_path());

    let secret_id = store.put("ephemeral").unwrap();
    assert_eq!(store.get(secret_id).unwrap(), "ephemeral");

    let restarted_store = SecretStore::new(store.path().to_path_buf());
    assert!(restarted_store.get(secret_id).is_err());
}

#[test]
fn unlock_or_setup_initializes_once_then_rejects_an_incorrect_password() {
    let store = SecretStore::new(temp_secret_path());
    assert!(!store.is_configured().unwrap());

    store.unlock_or_setup("first password").unwrap();
    assert!(store.is_configured().unwrap());
    store.lock();

    assert!(store.unlock_or_setup("incorrect password").is_err());
    store.unlock_or_setup("first password").unwrap();
}

#[test]
fn setup_returns_ten_codes_and_each_code_is_not_stored_as_plaintext() {
    let store = SecretStore::new(temp_secret_path());
    let codes = store.initialize("master password").unwrap();

    assert_eq!(codes.len(), 10);
    let database = std::fs::read(store.path()).unwrap();
    assert!(codes.iter().all(|code| {
        !database
            .windows(code.len())
            .any(|window| window == code.as_bytes())
    }));

    let connection = Connection::open(store.path()).unwrap();
    let (row_count, distinct_salts): (i64, i64) = connection
        .query_row(
            "SELECT COUNT(*), COUNT(DISTINCT hex(salt)) FROM recovery_codes",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((row_count, distinct_salts), (10, 10));
}

#[test]
fn recovery_rotates_codes_changes_master_password_and_keeps_secrets_readable() {
    let store = SecretStore::new(temp_secret_path());
    let codes = store.initialize("old master password").unwrap();
    let secret_id = store.put("ssh-password").unwrap();
    store.lock();

    let replacement_codes = store.recover(&codes[0], "new master password").unwrap();

    assert_eq!(replacement_codes.len(), 10);
    store.lock();
    assert!(store.unlock("old master password").is_err());
    store.unlock("new master password").unwrap();
    assert_eq!(store.get(secret_id).unwrap(), "ssh-password");
    assert!(store.recover(&codes[0], "another password").is_err());
}

#[test]
fn invalid_recovery_code_does_not_change_the_existing_master_password() {
    let store = SecretStore::new(temp_secret_path());
    store.initialize("old master password").unwrap();

    assert_eq!(
        store.recover("bad-code", "new master password"),
        Err(ViaError::InvalidRecoveryCode)
    );
    assert_eq!(
        store.recover(
            &Uuid::new_v4().hyphenated().to_string(),
            "new master password"
        ),
        Err(ViaError::InvalidRecoveryCode)
    );
    store.lock();
    store.unlock("old master password").unwrap();
}

#[test]
fn blank_passwords_are_rejected_without_consuming_a_recovery_code() {
    let path = temp_secret_path();
    let store = SecretStore::new(path.clone());

    assert_eq!(
        store.initialize("  \t"),
        Err(ViaError::InvalidMasterPassword)
    );
    assert!(!path.exists());

    let recovery_code = store.initialize("old master password").unwrap().remove(0);
    store.lock();
    assert_eq!(
        store.recover(&recovery_code, " \n "),
        Err(ViaError::InvalidMasterPassword)
    );
    store
        .recover(&recovery_code, "new master password")
        .unwrap();
}

#[test]
fn invalid_recovery_does_not_create_an_unconfigured_vault() {
    let path = temp_secret_path();
    let store = SecretStore::new(path.clone());

    assert_eq!(
        store.recover(
            &Uuid::new_v4().hyphenated().to_string(),
            "new master password"
        ),
        Err(ViaError::InvalidRecoveryCode)
    );
    assert!(!path.exists());
}

#[test]
fn a_recovery_code_can_only_succeed_once_across_store_instances() {
    let path = temp_secret_path();
    let store = SecretStore::new(path.clone());
    let recovery_code = store.initialize("old master password").unwrap().remove(0);
    store.lock();

    let barrier = Arc::new(Barrier::new(2));
    let attempts = ["first replacement", "second replacement"].map(|password| {
        let path = path.clone();
        let recovery_code = recovery_code.clone();
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            let store = SecretStore::new(path);
            barrier.wait();
            store.recover(&recovery_code, password)
        })
    });
    let successes = attempts
        .into_iter()
        .map(|attempt| attempt.join().unwrap())
        .filter(Result::is_ok)
        .count();

    assert_eq!(successes, 1);
}

#[test]
fn successful_legacy_unlock_migrates_the_vault_and_generates_recovery_codes() {
    let (store, secret_id) = legacy_v1_store_with_secret("legacy password");

    let codes = store.unlock_and_migrate("legacy password").unwrap();

    assert_eq!(codes.unwrap().len(), 10);
    assert_eq!(store.get(secret_id).unwrap(), "legacy ssh password");
    store.lock();
    assert_eq!(store.unlock_and_migrate("legacy password").unwrap(), None);
    assert_eq!(store.get(secret_id).unwrap(), "legacy ssh password");
}

#[test]
fn rejected_legacy_unlock_does_not_migrate_the_database() {
    let (store, _) = legacy_v1_store_with_secret("legacy password");

    assert_eq!(
        store.unlock_and_migrate("wrong password"),
        Err(ViaError::InvalidMasterPassword)
    );

    let connection = Connection::open(store.path()).unwrap();
    let columns = metadata_columns(&connection);
    assert!(!columns.iter().any(|name| name == "wrapped_data_key_nonce"));
    assert!(!table_exists(&connection, "recovery_codes"));
}

#[test]
fn initialization_upgrades_an_empty_legacy_metadata_table() {
    let path = temp_secret_path();
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE secret_store_metadata (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               version INTEGER NOT NULL,
               salt BLOB NOT NULL,
               verifier_nonce BLOB NOT NULL,
               verifier_ciphertext BLOB NOT NULL
             );",
        )
        .unwrap();
    drop(connection);

    let store = SecretStore::new(path);
    let recovery_codes = store.initialize("master password").unwrap();

    assert_eq!(recovery_codes.len(), 10);
    store.lock();
    store.unlock("master password").unwrap();
}

fn legacy_v1_store_with_secret(master_password: &str) -> (SecretStore, Uuid) {
    let path = temp_secret_path();
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE encrypted_secrets (
               id TEXT PRIMARY KEY NOT NULL,
               nonce BLOB NOT NULL,
               ciphertext BLOB NOT NULL
             );
             CREATE TABLE secret_store_metadata (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               version INTEGER NOT NULL,
               salt BLOB NOT NULL,
               verifier_nonce BLOB NOT NULL,
               verifier_ciphertext BLOB NOT NULL
             );",
        )
        .unwrap();

    let salt = *Uuid::new_v4().as_bytes();
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(master_password.as_bytes(), &salt, &mut key)
        .unwrap();
    let verifier = legacy_encrypt(&key, b"via-secret-store-v1");
    connection
        .execute(
            "INSERT INTO secret_store_metadata (
               id, version, salt, verifier_nonce, verifier_ciphertext
             ) VALUES (1, 1, ?1, ?2, ?3)",
            params![salt.as_slice(), verifier.0.as_slice(), verifier.1],
        )
        .unwrap();

    let secret_id = Uuid::new_v4();
    let secret = legacy_encrypt(&key, b"legacy ssh password");
    connection
        .execute(
            "INSERT INTO encrypted_secrets (id, nonce, ciphertext) VALUES (?1, ?2, ?3)",
            params![secret_id.to_string(), secret.0.as_slice(), secret.1],
        )
        .unwrap();
    drop(connection);

    (SecretStore::new(path), secret_id)
}

fn legacy_encrypt(key: &[u8; 32], plaintext: &[u8]) -> ([u8; 24], Vec<u8>) {
    let first = *Uuid::new_v4().as_bytes();
    let second = *Uuid::new_v4().as_bytes();
    let mut nonce = [0_u8; 24];
    nonce[..16].copy_from_slice(&first);
    nonce[16..].copy_from_slice(&second[..8]);
    let cipher = XChaCha20Poly1305::new_from_slice(key).unwrap();
    let nonce_ref = XNonce::try_from(&nonce[..]).unwrap();
    let ciphertext = cipher.encrypt(&nonce_ref, plaintext).unwrap();
    (nonce, ciphertext)
}

fn metadata_columns(connection: &Connection) -> Vec<String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(secret_store_metadata)")
        .unwrap();
    statement
        .query_map([], |row| row.get(1))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn table_exists(connection: &Connection, name: &str) -> bool {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [name],
            |row| row.get(0),
        )
        .unwrap()
}

fn temp_secret_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("via-secrets-test-{}.json", Uuid::new_v4()))
}
