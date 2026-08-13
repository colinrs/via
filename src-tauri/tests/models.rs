use uuid::Uuid;
use via::{AuthConfig, SessionConfig, ViaError};

#[test]
fn session_rejects_a_blank_host() {
    let result = SessionConfig::new(
        Uuid::new_v4(),
        Uuid::new_v4(),
        "stage bastion",
        "  ",
        22,
        "ec2-user",
        AuthConfig::Password { secret_id: None },
    );

    assert!(matches!(result, Err(ViaError::InvalidSession { .. })));
}

#[test]
fn config_json_uses_the_frontend_camel_case_contract() {
    let group_id = uuid::Uuid::new_v4();
    let session = via::SessionConfig::new(
        uuid::Uuid::new_v4(),
        group_id,
        "session",
        "example.test",
        22,
        "via",
        via::AuthConfig::Password { secret_id: None },
    )
    .unwrap();
    let json = serde_json::to_value(session).unwrap();

    assert!(json.get("groupId").is_some());
    assert!(json["auth"].get("secretId").is_some());
    assert!(json.get("group_id").is_none());
}
