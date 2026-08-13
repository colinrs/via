use crate::app_state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStoreStatus {
    pub configured: bool,
}

#[tauri::command]
pub fn secret_store_status(state: State<'_, AppState>) -> Result<SecretStoreStatus, String> {
    state
        .secrets
        .is_configured()
        .map(|configured| SecretStoreStatus { configured })
        .map_err(|error| format!("{error:?}"))
}

#[tauri::command]
pub fn initialize_secrets(
    state: State<'_, AppState>,
    master_password: String,
) -> Result<Vec<String>, String> {
    state
        .secrets
        .initialize(&master_password)
        .map_err(|error| format!("{error:?}"))
}

#[tauri::command]
pub fn unlock_secrets(
    state: State<'_, AppState>,
    master_password: String,
) -> Result<Option<Vec<String>>, String> {
    state
        .secrets
        .unlock_and_migrate(&master_password)
        .map_err(|error| format!("{error:?}"))
}

#[tauri::command]
pub fn recover_secrets(
    state: State<'_, AppState>,
    recovery_code: String,
    new_master_password: String,
) -> Result<Vec<String>, String> {
    state
        .secrets
        .recover(&recovery_code, &new_master_password)
        .map_err(|error| format!("{error:?}"))
}

#[tauri::command]
pub fn lock_secrets(state: State<'_, AppState>) {
    state.secrets.lock();
}

#[tauri::command]
pub fn approve_host_key(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    algorithm: String,
    fingerprint: String,
) -> Result<(), String> {
    state
        .trust
        .approve(&host, port, &algorithm, &fingerprint)
        .map_err(|error| format!("{error:?}"))
}
