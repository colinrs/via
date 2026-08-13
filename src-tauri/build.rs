fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "load_config",
                "save_config",
                "delete_session",
                "create_group",
                "export_config",
                "import_config",
                "unlock_secrets",
                "lock_secrets",
                "approve_host_key",
                "connect_session",
                "disconnect_session",
                "start_rule",
                "stop_rule",
                "start_enabled_rules",
                "stop_session_rules",
                "poll_transports",
            ]),
        ),
    )
    .expect("failed to build Tauri application permissions")
}
