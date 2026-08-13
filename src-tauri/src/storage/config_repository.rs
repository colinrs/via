use std::{collections::HashSet, path::PathBuf, time::Duration};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{AppConfig, AuthConfig, Group, LocalForwardRule, SecretStore, SessionConfig, ViaError};

#[derive(Debug, Clone, Copy)]
pub enum ImportMode {
    Merge,
    ReplaceAll,
}

pub struct ConfigRepository {
    path: PathBuf,
}

impl ConfigRepository {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<AppConfig, ViaError> {
        let connection = self.connection()?;
        let groups = load_groups(&connection)?;
        let sessions = load_sessions(&connection)?;
        let rules = load_rules(&connection)?;
        Ok(AppConfig {
            schema_version: 1,
            groups,
            sessions,
            rules,
        })
    }

    pub fn save(&self, config: &AppConfig) -> Result<(), ViaError> {
        self.validate(config)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(database_error)?;
        transaction
            .execute("DELETE FROM local_forward_rules", [])
            .map_err(database_error)?;
        transaction
            .execute("DELETE FROM ssh_sessions", [])
            .map_err(database_error)?;
        transaction
            .execute("DELETE FROM session_groups", [])
            .map_err(database_error)?;
        insert_config(&transaction, config)?;
        transaction.commit().map_err(database_error)
    }

    pub fn save_session_secret(
        &self,
        secrets: &SecretStore,
        session_id: Uuid,
        secret: impl Into<String>,
    ) -> Result<(), ViaError> {
        let prepared = secrets.prepare_encrypted(secret)?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let auth_json = transaction
            .query_row(
                "SELECT auth_json FROM ssh_sessions WHERE id = ?1",
                [session_id.to_string()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(ViaError::InvalidSession {
                field: "id",
                reason: "not found",
            })?;
        let mut auth: AuthConfig = serde_json::from_str(&auth_json)
            .map_err(|error| ViaError::Storage(error.to_string()))?;
        set_auth_secret(&mut auth, prepared.id());
        let next_auth_json =
            serde_json::to_string(&auth).map_err(|error| ViaError::Storage(error.to_string()))?;

        secrets.insert_prepared(&transaction, &prepared)?;
        let updated = transaction
            .execute(
                "UPDATE ssh_sessions SET auth_json = ?1 WHERE id = ?2",
                params![next_auth_json, session_id.to_string()],
            )
            .map_err(database_error)?;
        if updated != 1 {
            return Err(ViaError::Storage(
                "session secret reference was not updated".into(),
            ));
        }
        transaction.commit().map_err(database_error)
    }

    pub fn replace_auth_secret(
        mut config: AppConfig,
        session_id: Uuid,
        secret_id: Uuid,
    ) -> Result<AppConfig, ViaError> {
        let session = config
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or(ViaError::InvalidSession {
                field: "id",
                reason: "not found",
            })?;
        set_auth_secret(&mut session.auth, secret_id);
        Ok(config)
    }

    /// Deletes one persisted session and relies on the database foreign key to
    /// remove only its forwarding rules. This intentionally does not validate
    /// unrelated in-memory editor drafts.
    pub fn delete_session(&self, session_id: Uuid) -> Result<(), ViaError> {
        self.connection()?
            .execute(
                "DELETE FROM ssh_sessions WHERE id = ?1",
                [session_id.to_string()],
            )
            .map_err(database_error)?;
        Ok(())
    }

    pub fn delete_group(&self, group_id: Uuid) -> Result<(), ViaError> {
        self.connection()?
            .execute(
                "DELETE FROM session_groups WHERE id = ?1",
                [group_id.to_string()],
            )
            .map_err(database_error)?;
        Ok(())
    }

    pub fn delete_rule(&self, rule_id: Uuid) -> Result<(), ViaError> {
        self.connection()?
            .execute(
                "DELETE FROM local_forward_rules WHERE id = ?1",
                [rule_id.to_string()],
            )
            .map_err(database_error)?;
        Ok(())
    }

    /// Persists a group without rewriting unrelated sessions or editor drafts.
    pub fn create_group(&self, group: &Group) -> Result<(), ViaError> {
        let name = group.name.trim();
        if name.is_empty() {
            return Err(ViaError::InvalidImport(
                "group name must not be blank".into(),
            ));
        }
        self.connection()?
            .execute(
                "INSERT INTO session_groups (id, name) VALUES (?1, ?2)",
                params![group.id.to_string(), name],
            )
            .map_err(database_error)?;
        Ok(())
    }

    pub fn export_json(&self, config: &AppConfig) -> Result<String, ViaError> {
        serde_json::to_string_pretty(&ExportConfig::from(config))
            .map_err(|error| ViaError::Storage(error.to_string()))
    }

    pub fn import_json(&self, json: &str, mode: ImportMode) -> Result<AppConfig, ViaError> {
        let imported: ExportConfig = serde_json::from_str(json)
            .map_err(|error| ViaError::InvalidImport(error.to_string()))?;
        let imported = imported.into_config()?;
        self.validate(&imported)?;
        let next = match mode {
            ImportMode::ReplaceAll => imported,
            ImportMode::Merge => merge(self.load()?, imported),
        };
        self.save(&next)?;
        Ok(next)
    }

    fn connection(&self) -> Result<Connection, ViaError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let connection = Connection::open(&self.path).map_err(database_error)?;
        connection
            .busy_timeout(Duration::from_secs(30))
            .map_err(database_error)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS session_groups (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS ssh_sessions (id TEXT PRIMARY KEY NOT NULL, group_id TEXT NOT NULL, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, user TEXT NOT NULL, auth_json TEXT NOT NULL, FOREIGN KEY(group_id) REFERENCES session_groups(id) ON DELETE CASCADE);
             CREATE TABLE IF NOT EXISTS local_forward_rules (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, enabled INTEGER NOT NULL, local_port INTEGER NOT NULL, target_host TEXT NOT NULL, target_port INTEGER NOT NULL, note TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES ssh_sessions(id) ON DELETE CASCADE);
             CREATE TABLE IF NOT EXISTS encrypted_secrets (id TEXT PRIMARY KEY NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL);
             CREATE TABLE IF NOT EXISTS secret_store_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL, salt BLOB NOT NULL, verifier_nonce BLOB NOT NULL, verifier_ciphertext BLOB NOT NULL);",
        ).map_err(database_error)?;
        Ok(connection)
    }

    fn validate(&self, config: &AppConfig) -> Result<(), ViaError> {
        if config.schema_version != 1 {
            return Err(ViaError::InvalidImport("unsupported schema version".into()));
        }
        for group in &config.groups {
            if group.name.trim().is_empty() {
                return Err(ViaError::InvalidImport(
                    "group name must not be blank".into(),
                ));
            }
        }
        let group_ids = config
            .groups
            .iter()
            .map(|group| group.id)
            .collect::<HashSet<_>>();
        let session_ids = config
            .sessions
            .iter()
            .map(|session| session.id)
            .collect::<HashSet<_>>();
        for session in &config.sessions {
            if !group_ids.contains(&session.group_id) {
                return Err(ViaError::InvalidImport(
                    "session references a missing group".into(),
                ));
            }
            SessionConfig::new(
                session.id,
                session.group_id,
                &session.name,
                &session.host,
                session.port,
                &session.user,
                session.auth.clone(),
            )
            .map_err(|error| ViaError::InvalidImport(format!("invalid session: {error:?}")))?;
        }
        for rule in &config.rules {
            if !session_ids.contains(&rule.session_id) {
                return Err(ViaError::InvalidImport(
                    "rule references a missing session".into(),
                ));
            }
            LocalForwardRule::new(
                rule.id,
                rule.session_id,
                rule.enabled,
                rule.local_port,
                &rule.target_host,
                rule.target_port,
                &rule.note,
            )
            .map_err(|error| ViaError::InvalidImport(format!("invalid rule: {error:?}")))?;
        }
        Ok(())
    }
}

fn set_auth_secret(auth: &mut AuthConfig, secret_id: Uuid) {
    match auth {
        AuthConfig::Password { secret_id: current } => *current = Some(secret_id),
        AuthConfig::PrivateKey {
            passphrase_secret_id,
            ..
        } => *passphrase_secret_id = Some(secret_id),
    }
}

fn insert_config(transaction: &Transaction<'_>, config: &AppConfig) -> Result<(), ViaError> {
    for group in &config.groups {
        transaction
            .execute(
                "INSERT INTO session_groups (id, name) VALUES (?1, ?2)",
                params![group.id.to_string(), group.name],
            )
            .map_err(database_error)?;
    }
    for session in &config.sessions {
        transaction.execute(
            "INSERT INTO ssh_sessions (id, group_id, name, host, port, user, auth_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![session.id.to_string(), session.group_id.to_string(), session.name, session.host, session.port, session.user, serde_json::to_string(&session.auth).map_err(|error| ViaError::Storage(error.to_string()))?],
        ).map_err(database_error)?;
    }
    for rule in &config.rules {
        transaction.execute(
            "INSERT INTO local_forward_rules (id, session_id, enabled, local_port, target_host, target_port, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![rule.id.to_string(), rule.session_id.to_string(), rule.enabled, rule.local_port, rule.target_host, rule.target_port, rule.note],
        ).map_err(database_error)?;
    }
    Ok(())
}

fn load_groups(connection: &Connection) -> Result<Vec<Group>, ViaError> {
    let mut statement = connection
        .prepare("SELECT id, name FROM session_groups ORDER BY name")
        .map_err(database_error)?;
    statement
        .query_map([], |row| {
            Ok(Group {
                id: parse_id(row.get::<_, String>(0)?).map_err(to_sql_error)?,
                name: row.get(1)?,
            })
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)
}

fn load_sessions(connection: &Connection) -> Result<Vec<SessionConfig>, ViaError> {
    let mut statement = connection.prepare("SELECT id, group_id, name, host, port, user, auth_json FROM ssh_sessions ORDER BY name").map_err(database_error)?;
    statement
        .query_map([], |row| {
            let auth_json: String = row.get(6)?;
            let auth = serde_json::from_str(&auth_json)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            Ok(SessionConfig {
                id: parse_id(row.get::<_, String>(0)?).map_err(to_sql_error)?,
                group_id: parse_id(row.get::<_, String>(1)?).map_err(to_sql_error)?,
                name: row.get(2)?,
                host: row.get(3)?,
                port: row.get(4)?,
                user: row.get(5)?,
                auth,
            })
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)
}

fn load_rules(connection: &Connection) -> Result<Vec<LocalForwardRule>, ViaError> {
    let mut statement = connection.prepare("SELECT id, session_id, enabled, local_port, target_host, target_port, note FROM local_forward_rules ORDER BY local_port").map_err(database_error)?;
    statement
        .query_map([], |row| {
            Ok(LocalForwardRule {
                id: parse_id(row.get::<_, String>(0)?).map_err(to_sql_error)?,
                session_id: parse_id(row.get::<_, String>(1)?).map_err(to_sql_error)?,
                enabled: row.get(2)?,
                local_port: row.get(3)?,
                target_host: row.get(4)?,
                target_port: row.get(5)?,
                note: row.get(6)?,
            })
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)
}

fn parse_id(value: String) -> Result<Uuid, ViaError> {
    Uuid::parse_str(&value).map_err(|error| ViaError::Storage(error.to_string()))
}
fn to_sql_error(error: ViaError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!("{error:?}"))))
}
fn database_error(error: rusqlite::Error) -> ViaError {
    ViaError::Storage(error.to_string())
}
fn storage_error(error: std::io::Error) -> ViaError {
    ViaError::Storage(error.to_string())
}

fn merge(mut current: AppConfig, imported: AppConfig) -> AppConfig {
    merge_by_id(&mut current.groups, imported.groups, |item| item.id);
    merge_by_id(&mut current.sessions, imported.sessions, |item| item.id);
    merge_by_id(&mut current.rules, imported.rules, |item| item.id);
    current
}
fn merge_by_id<T>(current: &mut Vec<T>, imported: Vec<T>, id: impl Fn(&T) -> Uuid) {
    for item in imported {
        if let Some(index) = current
            .iter()
            .position(|existing| id(existing) == id(&item))
        {
            current[index] = item;
        } else {
            current.push(item);
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportConfig {
    schema_version: u32,
    groups: Vec<Group>,
    sessions: Vec<ExportSession>,
    rules: Vec<LocalForwardRule>,
}
impl From<&AppConfig> for ExportConfig {
    fn from(config: &AppConfig) -> Self {
        Self {
            schema_version: config.schema_version,
            groups: config.groups.clone(),
            sessions: config.sessions.iter().map(ExportSession::from).collect(),
            rules: config.rules.clone(),
        }
    }
}
impl ExportConfig {
    fn into_config(self) -> Result<AppConfig, ViaError> {
        Ok(AppConfig {
            schema_version: self.schema_version,
            groups: self.groups,
            sessions: self
                .sessions
                .into_iter()
                .map(ExportSession::into_session)
                .collect(),
            rules: self.rules,
        })
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportSession {
    id: Uuid,
    group_id: Uuid,
    name: String,
    host: String,
    port: u16,
    user: String,
    auth: ExportAuth,
}
impl From<&SessionConfig> for ExportSession {
    fn from(session: &SessionConfig) -> Self {
        Self {
            id: session.id,
            group_id: session.group_id,
            name: session.name.clone(),
            host: session.host.clone(),
            port: session.port,
            user: session.user.clone(),
            auth: ExportAuth::from(&session.auth),
        }
    }
}
impl ExportSession {
    fn into_session(self) -> SessionConfig {
        SessionConfig {
            id: self.id,
            group_id: self.group_id,
            name: self.name,
            host: self.host,
            port: self.port,
            user: self.user,
            auth: self.auth.into_auth(),
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum ExportAuth {
    Password,
    PrivateKey { path: String },
}
impl From<&AuthConfig> for ExportAuth {
    fn from(auth: &AuthConfig) -> Self {
        match auth {
            AuthConfig::Password { .. } => Self::Password,
            AuthConfig::PrivateKey { path, .. } => Self::PrivateKey { path: path.clone() },
        }
    }
}
impl ExportAuth {
    fn into_auth(self) -> AuthConfig {
        match self {
            Self::Password => AuthConfig::Password { secret_id: None },
            Self::PrivateKey { path } => AuthConfig::PrivateKey {
                path,
                passphrase_secret_id: None,
            },
        }
    }
}
