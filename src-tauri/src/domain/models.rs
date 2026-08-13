use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ViaError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelState {
    Stopped,
    Starting,
    Active,
    Reconnecting,
    Conflict,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRuleState {
    pub rule_id: Uuid,
    pub state: TunnelState,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AuthConfig {
    Password {
        secret_id: Option<Uuid>,
    },
    PrivateKey {
        path: String,
        passphrase_secret_id: Option<Uuid>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    pub id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub groups: Vec<Group>,
    pub sessions: Vec<SessionConfig>,
    pub rules: Vec<LocalForwardRule>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            groups: Vec::new(),
            sessions: Vec::new(),
            rules: Vec::new(),
        }
    }
}

impl SessionConfig {
    pub fn new(
        id: Uuid,
        group_id: Uuid,
        name: impl Into<String>,
        host: impl Into<String>,
        port: u16,
        user: impl Into<String>,
        auth: AuthConfig,
    ) -> Result<Self, ViaError> {
        let name = name.into().trim().to_owned();
        let host = host.into().trim().to_owned();
        let user = user.into().trim().to_owned();

        if name.is_empty() {
            return Err(ViaError::InvalidSession {
                field: "name",
                reason: "must not be blank",
            });
        }
        if host.is_empty() {
            return Err(ViaError::InvalidSession {
                field: "host",
                reason: "must not be blank",
            });
        }
        if port == 0 {
            return Err(ViaError::InvalidSession {
                field: "port",
                reason: "must be 1-65535",
            });
        }
        if user.is_empty() {
            return Err(ViaError::InvalidSession {
                field: "user",
                reason: "must not be blank",
            });
        }

        Ok(Self {
            id,
            group_id,
            name,
            host,
            port,
            user,
            auth,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalForwardRule {
    pub id: Uuid,
    pub session_id: Uuid,
    pub enabled: bool,
    pub local_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub note: String,
}

impl LocalForwardRule {
    pub fn new(
        id: Uuid,
        session_id: Uuid,
        enabled: bool,
        local_port: u16,
        target_host: impl Into<String>,
        target_port: u16,
        note: impl Into<String>,
    ) -> Result<Self, ViaError> {
        let target_host = target_host.into().trim().to_owned();

        if local_port == 0 {
            return Err(ViaError::InvalidRule {
                field: "local_port",
                reason: "must be 1-65535",
            });
        }
        if target_host.is_empty() {
            return Err(ViaError::InvalidRule {
                field: "target_host",
                reason: "must not be blank",
            });
        }
        if target_port == 0 {
            return Err(ViaError::InvalidRule {
                field: "target_port",
                reason: "must be 1-65535",
            });
        }

        Ok(Self {
            id,
            session_id,
            enabled,
            local_port,
            target_host,
            target_port,
            note: note.into(),
        })
    }
}
