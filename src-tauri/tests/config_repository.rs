use uuid::Uuid;
use via::{
    AppConfig, AuthConfig, ConfigRepository, Group, ImportMode, LocalForwardRule, SessionConfig,
};

#[test]
fn export_never_contains_secret_references_or_ciphertext() {
    let repository = ConfigRepository::new(temp_config_path());
    let group_id = Uuid::new_v4();
    let config = AppConfig {
        schema_version: 1,
        groups: vec![Group {
            id: group_id,
            name: "AWS".into(),
        }],
        sessions: vec![
            SessionConfig::new(
                Uuid::new_v4(),
                group_id,
                "stage bastion",
                "bastion.example.com",
                22,
                "ec2-user",
                AuthConfig::Password {
                    secret_id: Some(Uuid::new_v4()),
                },
            )
            .unwrap(),
        ],
        rules: vec![],
    };

    let json = repository.export_json(&config).unwrap();

    assert!(!json.contains("secret_id"));
    assert!(!json.contains("ciphertext"));
}

#[test]
fn exported_json_uses_the_frontend_camel_case_contract() {
    let repository = ConfigRepository::new(temp_config_path());
    let group_id = Uuid::new_v4();
    let config = AppConfig {
        schema_version: 1,
        groups: vec![Group {
            id: group_id,
            name: "Default".into(),
        }],
        sessions: vec![
            SessionConfig::new(
                Uuid::new_v4(),
                group_id,
                "host",
                "host.test",
                22,
                "user",
                AuthConfig::Password { secret_id: None },
            )
            .unwrap(),
        ],
        rules: vec![],
    };

    let json = repository.export_json(&config).unwrap();
    assert!(json.contains("\"schemaVersion\""));
    assert!(json.contains("\"groupId\""));
    assert!(!json.contains("\"schema_version\""));
}

#[test]
fn invalid_import_does_not_replace_existing_config() {
    let repository = ConfigRepository::new(temp_config_path());
    let original = AppConfig::default();
    repository.save(&original).unwrap();

    assert!(
        repository
            .import_json("{bad", ImportMode::ReplaceAll)
            .is_err()
    );
    assert_eq!(repository.load().unwrap(), original);
}

#[test]
fn configuration_is_persisted_in_a_sqlite_database() {
    let path = temp_config_path();
    let repository = ConfigRepository::new(path.clone());

    repository.save(&AppConfig::default()).unwrap();

    assert_eq!(&std::fs::read(path).unwrap()[..16], b"SQLite format 3\0");
}

#[test]
fn configuration_rejects_sessions_or_rules_with_missing_parents() {
    let repository = ConfigRepository::new(temp_config_path());
    let config = AppConfig {
        schema_version: 1,
        groups: vec![],
        sessions: vec![
            SessionConfig::new(
                Uuid::new_v4(),
                Uuid::new_v4(),
                "host",
                "host.test",
                22,
                "user",
                AuthConfig::Password { secret_id: None },
            )
            .unwrap(),
        ],
        rules: vec![],
    };
    assert!(repository.save(&config).is_err());
}

#[test]
fn deleting_one_session_removes_its_rules_without_revalidating_other_drafts() {
    let repository = ConfigRepository::new(temp_config_path());
    let group_id = Uuid::new_v4();
    let deleted_id = Uuid::new_v4();
    let retained_id = Uuid::new_v4();
    let config = AppConfig {
        schema_version: 1,
        groups: vec![Group {
            id: group_id,
            name: "default".into(),
        }],
        sessions: vec![
            SessionConfig::new(
                deleted_id,
                group_id,
                "delete",
                "delete.test",
                22,
                "user",
                AuthConfig::Password { secret_id: None },
            )
            .unwrap(),
            SessionConfig::new(
                retained_id,
                group_id,
                "keep",
                "keep.test",
                22,
                "user",
                AuthConfig::Password { secret_id: None },
            )
            .unwrap(),
        ],
        rules: vec![
            LocalForwardRule::new(
                Uuid::new_v4(),
                deleted_id,
                true,
                3001,
                "target",
                443,
                "delete",
            )
            .unwrap(),
        ],
    };
    repository.save(&config).unwrap();

    repository.delete_session(deleted_id).unwrap();

    let saved = repository.load().unwrap();
    assert_eq!(
        saved
            .sessions
            .iter()
            .map(|session| session.id)
            .collect::<Vec<_>>(),
        vec![retained_id]
    );
    assert!(saved.rules.is_empty());
}

#[test]
fn deleting_one_rule_keeps_its_session_and_other_rules() {
    let repository = ConfigRepository::new(temp_config_path());
    let group_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let deleted_rule_id = Uuid::new_v4();
    let retained_rule_id = Uuid::new_v4();
    repository
        .save(&AppConfig {
            schema_version: 1,
            groups: vec![Group {
                id: group_id,
                name: "default".into(),
            }],
            sessions: vec![SessionConfig::new(
                session_id,
                group_id,
                "host",
                "host.test",
                22,
                "user",
                AuthConfig::Password { secret_id: None },
            )
            .unwrap()],
            rules: vec![
                LocalForwardRule::new(
                    deleted_rule_id,
                    session_id,
                    true,
                    3001,
                    "target",
                    443,
                    "delete",
                )
                .unwrap(),
                LocalForwardRule::new(
                    retained_rule_id,
                    session_id,
                    true,
                    3002,
                    "target",
                    443,
                    "keep",
                )
                .unwrap(),
            ],
        })
        .unwrap();

    repository.delete_rule(deleted_rule_id).unwrap();

    let config = repository.load().unwrap();
    assert_eq!(
        config
            .sessions
            .iter()
            .map(|session| session.id)
            .collect::<Vec<_>>(),
        vec![session_id]
    );
    assert_eq!(
        config.rules.iter().map(|rule| rule.id).collect::<Vec<_>>(),
        vec![retained_rule_id]
    );
}

#[test]
fn deleting_a_group_cascades_to_its_sessions_and_rules_only() {
    let repository = ConfigRepository::new(temp_config_path());
    let deleted_group_id = Uuid::new_v4();
    let retained_group_id = Uuid::new_v4();
    let deleted_session_id = Uuid::new_v4();
    let retained_session_id = Uuid::new_v4();
    repository
        .save(&AppConfig {
            schema_version: 1,
            groups: vec![
                Group {
                    id: deleted_group_id,
                    name: "delete".into(),
                },
                Group {
                    id: retained_group_id,
                    name: "keep".into(),
                },
            ],
            sessions: vec![
                SessionConfig::new(
                    deleted_session_id,
                    deleted_group_id,
                    "delete",
                    "delete.test",
                    22,
                    "user",
                    AuthConfig::Password { secret_id: None },
                )
                .unwrap(),
                SessionConfig::new(
                    retained_session_id,
                    retained_group_id,
                    "keep",
                    "keep.test",
                    22,
                    "user",
                    AuthConfig::Password { secret_id: None },
                )
                .unwrap(),
            ],
            rules: vec![
                LocalForwardRule::new(
                    Uuid::new_v4(),
                    deleted_session_id,
                    true,
                    3001,
                    "target",
                    443,
                    "delete",
                )
                .unwrap(),
                LocalForwardRule::new(
                    Uuid::new_v4(),
                    retained_session_id,
                    true,
                    3002,
                    "target",
                    443,
                    "keep",
                )
                .unwrap(),
            ],
        })
        .unwrap();

    repository.delete_group(deleted_group_id).unwrap();

    let config = repository.load().unwrap();
    assert_eq!(config.groups.len(), 1);
    assert_eq!(config.groups[0].id, retained_group_id);
    assert!(config
        .sessions
        .iter()
        .all(|session| session.group_id != deleted_group_id));
    assert_eq!(
        config
            .sessions
            .iter()
            .map(|session| session.id)
            .collect::<Vec<_>>(),
        vec![retained_session_id]
    );
    assert!(config.rules.iter().all(|rule| {
        config
            .sessions
            .iter()
            .any(|session| session.id == rule.session_id)
    }));
}

#[test]
fn creating_a_group_persists_only_the_new_group() {
    let repository = ConfigRepository::new(temp_config_path());
    let group = Group {
        id: Uuid::new_v4(),
        name: "生产环境".into(),
    };

    repository.create_group(&group).unwrap();

    assert_eq!(repository.load().unwrap().groups, vec![group]);
}

fn temp_config_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("via-config-test-{}.json", Uuid::new_v4()))
}
