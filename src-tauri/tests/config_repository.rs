use rusqlite::Connection;
use std::sync::{Arc, Barrier};
use uuid::Uuid;
use via::{
    AppConfig, AuthConfig, ConfigRepository, Group, ImportMode, LocalForwardRule, SecretStore,
    SessionConfig, commands::config::persist_session_secret,
};

#[test]
fn setting_a_password_secret_updates_only_that_sessions_secret_id() {
    let password_session_id = Uuid::new_v4();
    let private_key_session_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();
    let secret_id = Uuid::new_v4();
    let config = AppConfig {
        schema_version: 1,
        groups: vec![Group {
            id: group_id,
            name: "Default".into(),
        }],
        sessions: vec![
            SessionConfig::new(
                password_session_id,
                group_id,
                "password host",
                "password.test",
                22,
                "user",
                AuthConfig::Password { secret_id: None },
            )
            .unwrap(),
            SessionConfig::new(
                private_key_session_id,
                group_id,
                "key host",
                "key.test",
                22,
                "user",
                AuthConfig::PrivateKey {
                    path: "/keys/id_ed25519".into(),
                    passphrase_secret_id: None,
                },
            )
            .unwrap(),
        ],
        rules: vec![],
    };

    let next =
        ConfigRepository::replace_auth_secret(config, password_session_id, secret_id).unwrap();

    assert_eq!(
        match &next
            .sessions
            .iter()
            .find(|session| session.id == password_session_id)
            .unwrap()
            .auth
        {
            AuthConfig::Password { secret_id } => *secret_id,
            AuthConfig::PrivateKey { .. } => None,
        },
        Some(secret_id)
    );
    assert!(matches!(
        &next
            .sessions
            .iter()
            .find(|session| session.id == private_key_session_id)
            .unwrap()
            .auth,
        AuthConfig::PrivateKey {
            path,
            passphrase_secret_id: None
        } if path == "/keys/id_ed25519"
    ));
}

#[test]
fn setting_a_private_key_secret_updates_its_passphrase_secret_id() {
    let session_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();
    let secret_id = Uuid::new_v4();
    let config = AppConfig {
        schema_version: 1,
        groups: vec![Group {
            id: group_id,
            name: "Default".into(),
        }],
        sessions: vec![
            SessionConfig::new(
                session_id,
                group_id,
                "key host",
                "key.test",
                22,
                "user",
                AuthConfig::PrivateKey {
                    path: "/keys/id_ed25519".into(),
                    passphrase_secret_id: None,
                },
            )
            .unwrap(),
        ],
        rules: vec![],
    };

    let next = ConfigRepository::replace_auth_secret(config, session_id, secret_id).unwrap();

    assert_eq!(
        match &next.sessions[0].auth {
            AuthConfig::PrivateKey {
                passphrase_secret_id,
                ..
            } => *passphrase_secret_id,
            AuthConfig::Password { .. } => None,
        },
        Some(secret_id)
    );
}

#[test]
fn saving_a_session_secret_persists_its_reference_and_encrypted_value() {
    let path = temp_config_path();
    let repository = ConfigRepository::new(path.clone());
    let secrets = SecretStore::new(path);
    let session_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();
    repository
        .save(&AppConfig {
            schema_version: 1,
            groups: vec![Group {
                id: group_id,
                name: "Default".into(),
            }],
            sessions: vec![
                SessionConfig::new(
                    session_id,
                    group_id,
                    "password host",
                    "password.test",
                    22,
                    "user",
                    AuthConfig::Password { secret_id: None },
                )
                .unwrap(),
            ],
            rules: vec![],
        })
        .unwrap();
    secrets.initialize("master password").unwrap();

    let saved = persist_session_secret(&repository, &secrets, session_id, "ssh password").unwrap();

    assert_eq!(repository.load().unwrap(), saved);
    let secret_id = match saved.sessions[0].auth {
        AuthConfig::Password {
            secret_id: Some(secret_id),
        } => secret_id,
        _ => panic!("password secret reference was not saved"),
    };
    assert_eq!(secrets.get(secret_id).unwrap(), "ssh password");
}

#[test]
fn failed_auth_update_cannot_orphan_a_secret_even_if_secret_deletion_would_fail() {
    let path = temp_config_path();
    let repository = ConfigRepository::new(path.clone());
    let secrets = SecretStore::new(path.clone());
    let session_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();
    repository
        .save(&AppConfig {
            schema_version: 1,
            groups: vec![Group {
                id: group_id,
                name: "Default".into(),
            }],
            sessions: vec![
                SessionConfig::new(
                    session_id,
                    group_id,
                    "password host",
                    "password.test",
                    22,
                    "user",
                    AuthConfig::Password { secret_id: None },
                )
                .unwrap(),
            ],
            rules: vec![],
        })
        .unwrap();
    secrets.initialize("master password").unwrap();
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_session_delete
             BEFORE DELETE ON ssh_sessions
             BEGIN
               SELECT RAISE(ABORT, 'save blocked');
             END;
             CREATE TRIGGER reject_session_update
             BEFORE UPDATE OF auth_json ON ssh_sessions
             BEGIN
               SELECT RAISE(ABORT, 'save blocked');
             END;
             CREATE TRIGGER reject_secret_delete
             BEFORE DELETE ON encrypted_secrets
             BEGIN
               SELECT RAISE(ABORT, 'cleanup blocked');
             END;",
        )
        .unwrap();

    assert!(persist_session_secret(&repository, &secrets, session_id, "ssh password").is_err());

    let record_count: i64 = Connection::open(path)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM encrypted_secrets", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(record_count, 0);
}

#[test]
fn ignored_auth_update_rolls_back_the_inserted_secret() {
    let path = temp_config_path();
    let repository = ConfigRepository::new(path.clone());
    let secrets = SecretStore::new(path.clone());
    let session_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();
    repository
        .save(&AppConfig {
            schema_version: 1,
            groups: vec![Group {
                id: group_id,
                name: "Default".into(),
            }],
            sessions: vec![
                SessionConfig::new(
                    session_id,
                    group_id,
                    "password host",
                    "password.test",
                    22,
                    "user",
                    AuthConfig::Password { secret_id: None },
                )
                .unwrap(),
            ],
            rules: vec![],
        })
        .unwrap();
    secrets.initialize("master password").unwrap();
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER ignore_session_update
             BEFORE UPDATE OF auth_json ON ssh_sessions
             BEGIN
               SELECT RAISE(IGNORE);
             END;",
        )
        .unwrap();

    assert!(persist_session_secret(&repository, &secrets, session_id, "ssh password").is_err());

    assert_eq!(encrypted_secret_count(&path), 0);
}

#[test]
fn concurrent_secret_updates_target_distinct_sessions_without_rewriting_config() {
    let path = temp_config_path();
    let repository = ConfigRepository::new(path.clone());
    let first_session_id = Uuid::new_v4();
    let second_session_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();
    repository
        .save(&AppConfig {
            schema_version: 1,
            groups: vec![Group {
                id: group_id,
                name: "Default".into(),
            }],
            sessions: vec![
                SessionConfig::new(
                    first_session_id,
                    group_id,
                    "first host",
                    "first.test",
                    22,
                    "user",
                    AuthConfig::Password { secret_id: None },
                )
                .unwrap(),
                SessionConfig::new(
                    second_session_id,
                    group_id,
                    "second host",
                    "second.test",
                    22,
                    "user",
                    AuthConfig::PrivateKey {
                        path: "/keys/id_ed25519".into(),
                        passphrase_secret_id: None,
                    },
                )
                .unwrap(),
            ],
            rules: vec![],
        })
        .unwrap();
    let reader = SecretStore::new(path.clone());
    reader.initialize("master password").unwrap();
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_session_delete
             BEFORE DELETE ON ssh_sessions
             BEGIN
               SELECT RAISE(ABORT, 'whole-config replacement forbidden');
             END;",
        )
        .unwrap();

    let barrier = Arc::new(Barrier::new(2));
    let updates = [
        (first_session_id, "first secret"),
        (second_session_id, "second secret"),
    ]
    .map(|(session_id, secret)| {
        let path = path.clone();
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            let repository = ConfigRepository::new(path.clone());
            let secrets = SecretStore::new(path);
            secrets.unlock("master password").unwrap();
            barrier.wait();
            persist_session_secret(&repository, &secrets, session_id, secret)
        })
    });
    for update in updates {
        update.join().unwrap().unwrap();
    }

    let saved = repository.load().unwrap();
    let first_secret_id = match saved
        .sessions
        .iter()
        .find(|session| session.id == first_session_id)
        .unwrap()
        .auth
    {
        AuthConfig::Password {
            secret_id: Some(secret_id),
        } => secret_id,
        _ => panic!("first secret reference was not saved"),
    };
    let second_secret_id = match saved
        .sessions
        .iter()
        .find(|session| session.id == second_session_id)
        .unwrap()
        .auth
    {
        AuthConfig::PrivateKey {
            passphrase_secret_id: Some(secret_id),
            ..
        } => secret_id,
        _ => panic!("second secret reference was not saved"),
    };
    assert_eq!(reader.get(first_secret_id).unwrap(), "first secret");
    assert_eq!(reader.get(second_secret_id).unwrap(), "second secret");
    assert_eq!(encrypted_secret_count(&path), 2);
}

#[test]
fn missing_session_does_not_create_an_encrypted_secret() {
    let path = temp_config_path();
    let repository = ConfigRepository::new(path.clone());
    repository.save(&AppConfig::default()).unwrap();
    let secrets = SecretStore::new(path.clone());
    secrets.initialize("master password").unwrap();

    assert!(persist_session_secret(&repository, &secrets, Uuid::new_v4(), "ssh password").is_err());

    assert_eq!(encrypted_secret_count(&path), 0);
}

#[test]
fn blank_session_secret_is_rejected_before_database_mutation() {
    let path = temp_config_path();
    let repository = ConfigRepository::new(path.clone());
    let session_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();
    repository
        .save(&AppConfig {
            schema_version: 1,
            groups: vec![Group {
                id: group_id,
                name: "Default".into(),
            }],
            sessions: vec![
                SessionConfig::new(
                    session_id,
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
        })
        .unwrap();
    let secrets = SecretStore::new(path.clone());
    secrets.initialize("master password").unwrap();

    assert_eq!(
        persist_session_secret(&repository, &secrets, session_id, " \t "),
        Err(via::ViaError::InvalidSecret)
    );

    assert_eq!(encrypted_secret_count(&path), 0);
}

fn encrypted_secret_count(path: &std::path::Path) -> i64 {
    Connection::open(path)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM encrypted_secrets", [], |row| {
            row.get(0)
        })
        .unwrap()
}

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
            sessions: vec![
                SessionConfig::new(
                    session_id,
                    group_id,
                    "host",
                    "host.test",
                    22,
                    "user",
                    AuthConfig::Password { secret_id: None },
                )
                .unwrap(),
            ],
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
    assert!(
        config
            .sessions
            .iter()
            .all(|session| session.group_id != deleted_group_id)
    );
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
