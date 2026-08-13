use crate::{AppConfig, Group, ImportMode, app_state::AppState};
use tauri::State;
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
