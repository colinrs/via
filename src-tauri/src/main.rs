#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("via.db");
            app.manage(via::app_state::AppState::new(path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            via::commands::config::load_config,
            via::commands::config::save_config,
            via::commands::config::delete_session,
            via::commands::config::delete_group,
            via::commands::config::delete_rule,
            via::commands::config::create_group,
            via::commands::config::export_config,
            via::commands::config::import_config,
            via::commands::config::save_session_secret,
            via::commands::security::secret_store_status,
            via::commands::security::initialize_secrets,
            via::commands::security::unlock_secrets,
            via::commands::security::recover_secrets,
            via::commands::security::lock_secrets,
            via::commands::security::approve_host_key,
            via::commands::tunnels::connect_session,
            via::commands::tunnels::disconnect_session,
            via::commands::tunnels::start_rule,
            via::commands::tunnels::stop_rule,
            via::commands::tunnels::start_enabled_rules,
            via::commands::tunnels::stop_session_rules,
            via::commands::tunnels::poll_transports
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Via");
}
