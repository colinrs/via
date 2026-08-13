use crate::{
    AppConfig, AuthConfig, ConfigRepository, Group, ImportMode, SecretStore, ViaError,
    app_state::AppState,
};
use tauri::State;
use uuid::Uuid;

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
    match &mut session.auth {
        AuthConfig::Password { secret_id: current } => *current = Some(secret_id),
        AuthConfig::PrivateKey {
            passphrase_secret_id,
            ..
        } => *passphrase_secret_id = Some(secret_id),
    }
    Ok(config)
}

pub fn persist_session_secret(
    repository: &ConfigRepository,
    secrets: &SecretStore,
    session_id: Uuid,
    secret: impl Into<String>,
) -> Result<AppConfig, ViaError> {
    let config = repository.load()?;
    if !config
        .sessions
        .iter()
        .any(|session| session.id == session_id)
    {
        return Err(ViaError::InvalidSession {
            field: "id",
            reason: "not found",
        });
    }
    let secret_id = secrets.put(secret)?;
    let next = replace_auth_secret(config, session_id, secret_id)?;
    if let Err(save_error) = repository.save(&next) {
        if let Err(rollback_error) = secrets.delete(secret_id) {
            return Err(ViaError::Storage(format!(
                "failed to save session secret: {save_error:?}; rollback failed: {rollback_error:?}"
            )));
        }
        return Err(save_error);
    }
    Ok(next)
}
#[tauri::command]
pub fn load_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    state.config.load().map_err(|e| format!("{e:?}"))
}
#[tauri::command]
pub fn save_config(state: State<'_, AppState>, config: AppConfig) -> Result<(), String> {
    state.config.save(&config).map_err(|e| format!("{e:?}"))
}
#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&session_id).map_err(|error| error.to_string())?;
    state
        .config
        .delete_session(id)
        .map_err(|error| format!("{error:?}"))
}
#[tauri::command]
pub fn delete_group(state: State<'_, AppState>, group_id: String) -> Result<(), String> {
    let id = Uuid::parse_str(&group_id).map_err(|error| error.to_string())?;
    state
        .config
        .delete_group(id)
        .map_err(|error| format!("{error:?}"))
}
#[tauri::command]
pub fn delete_rule(state: State<'_, AppState>, rule_id: String) -> Result<(), String> {
    let id = Uuid::parse_str(&rule_id).map_err(|error| error.to_string())?;
    state
        .config
        .delete_rule(id)
        .map_err(|error| format!("{error:?}"))
}
#[tauri::command]
pub fn create_group(state: State<'_, AppState>, group: Group) -> Result<(), String> {
    state
        .config
        .create_group(&group)
        .map_err(|error| format!("{error:?}"))
}
#[tauri::command]
pub fn export_config(state: State<'_, AppState>) -> Result<String, String> {
    state
        .config
        .export_json(&state.config.load().map_err(|e| format!("{e:?}"))?)
        .map_err(|e| format!("{e:?}"))
}
#[tauri::command]
pub fn import_config(
    state: State<'_, AppState>,
    json: String,
    replace_all: bool,
) -> Result<AppConfig, String> {
    state
        .config
        .import_json(
            &json,
            if replace_all {
                ImportMode::ReplaceAll
            } else {
                ImportMode::Merge
            },
        )
        .map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub fn save_session_secret(
    state: State<'_, AppState>,
    session_id: String,
    secret: String,
) -> Result<AppConfig, String> {
    let id = Uuid::parse_str(&session_id).map_err(|error| error.to_string())?;
    persist_session_secret(&state.config, &state.secrets, id, secret)
        .map_err(|error| format!("{error:?}"))
}
