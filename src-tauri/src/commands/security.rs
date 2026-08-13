use crate::app_state::AppState;
use tauri::State;

#[tauri::command]
pub fn unlock_secrets(state: State<'_, AppState>, master_password: String) -> Result<(), String> {
    state
        .secrets
        .unlock_or_setup(&master_password)
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
