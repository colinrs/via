use crate::{AuthConfig, ConnectSecrets, app_state::AppState};
use tauri::{AppHandle, Emitter, State};
#[tauri::command]
pub async fn connect_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let config = state.config.load().map_err(|e| format!("{e:?}"))?;
    let session = config
        .sessions
        .into_iter()
        .find(|item| item.id.to_string() == session_id)
        .ok_or("session not found")?;
    let secrets = match &session.auth {
        AuthConfig::Password { secret_id } => ConnectSecrets {
            password: secret_id
                .map(|id| state.secrets.get(id))
                .transpose()
                .map_err(|e| format!("{e:?}"))?,
            key_passphrase: None,
        },
        AuthConfig::PrivateKey {
            passphrase_secret_id,
            ..
        } => ConnectSecrets {
            password: None,
            key_passphrase: passphrase_secret_id
                .map(|id| state.secrets.get(id))
                .transpose()
                .map_err(|e| format!("{e:?}"))?,
        },
    };
    let transport = state
        .ssh
        .connect(&session, secrets)
        .await
        .map_err(|e| format!("{e:?}"))?;
    state.tunnels.register_session(session.id, transport).await;
    app.emit("runtime-state", state.tunnels.snapshot().await)
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn disconnect_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&session_id).map_err(|error| error.to_string())?;
    state.tunnels.disconnect_session(id).await;
    app.emit("runtime-state", state.tunnels.snapshot().await)
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn start_rule(
    app: AppHandle,
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<(), String> {
    let rule = state
        .config
        .load()
        .map_err(|e| format!("{e:?}"))?
        .rules
        .into_iter()
        .find(|item| item.id.to_string() == rule_id)
        .ok_or("rule not found")?;
    state
        .tunnels
        .start_rule(rule)
        .await
        .map_err(|e| format!("{e:?}"))?;
    app.emit("runtime-state", state.tunnels.snapshot().await)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn stop_rule(
    app: AppHandle,
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&rule_id).map_err(|e| e.to_string())?;
    state.tunnels.stop_rule(id).await;
    app.emit("runtime-state", state.tunnels.snapshot().await)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn start_enabled_rules(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    for rule in state
        .config
        .load()
        .map_err(|e| format!("{e:?}"))?
        .rules
        .into_iter()
        .filter(|rule| rule.session_id == id && rule.enabled)
    {
        let _ = state.tunnels.start_rule(rule).await;
    }
    app.emit("runtime-state", state.tunnels.snapshot().await)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn stop_session_rules(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    for rule in state
        .config
        .load()
        .map_err(|e| format!("{e:?}"))?
        .rules
        .into_iter()
        .filter(|rule| rule.session_id == id)
    {
        state.tunnels.stop_rule(rule.id).await;
    }
    app.emit("runtime-state", state.tunnels.snapshot().await)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn poll_transports(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if !state.tunnels.detect_closed_transports().await.is_empty() {
        app.emit("runtime-state", state.tunnels.snapshot().await)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
