use uuid::Uuid;
use via::SecretStore;

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

fn temp_secret_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("via-secrets-test-{}.json", Uuid::new_v4()))
}
