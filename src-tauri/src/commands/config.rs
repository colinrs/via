use crate::{
    AppConfig, ConfigRepository, Group, ImportMode, SecretStore, ViaError, app_state::AppState,
};
use tauri::State;
use uuid::Uuid;

pub fn persist_session_secret(
    repository: &ConfigRepository,
    secrets: &SecretStore,
    session_id: Uuid,
    secret: impl Into<String>,
) -> Result<AppConfig, ViaError> {
    repository.save_session_secret(secrets, session_id, secret)?;
    repository.load()
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
