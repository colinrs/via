use uuid::Uuid;
use via::{HostTrustStore, ViaError};

#[test]
fn unknown_key_requires_approval_and_changed_key_is_blocked() {
    let trust = HostTrustStore::new(temp_database_path());

    assert!(matches!(
        trust.verify_or_request("bastion.example.com", 22, "ssh-ed25519", "SHA256:first"),
        Err(ViaError::HostTrustRequired { algorithm, .. }) if algorithm == "ssh-ed25519"
    ));

    trust
        .approve("bastion.example.com", 22, "ssh-ed25519", "SHA256:first")
        .unwrap();
    trust
        .verify_or_request("bastion.example.com", 22, "ssh-ed25519", "SHA256:first")
        .unwrap();

    assert!(matches!(
        trust.verify_or_request("bastion.example.com", 22, "ssh-ed25519", "SHA256:changed"),
        Err(ViaError::HostKeyChanged { .. })
    ));
}

fn temp_database_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("via-host-trust-test-{}.db", Uuid::new_v4()))
}
