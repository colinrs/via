use crate::{ConfigRepository, HostTrustStore, SecretStore, SshConnector, TunnelManager};
use std::sync::Arc;
pub struct AppState {
    pub config: ConfigRepository,
    pub secrets: SecretStore,
    pub trust: Arc<HostTrustStore>,
    pub ssh: SshConnector,
    pub tunnels: TunnelManager,
}
impl AppState {
    pub fn new(path: std::path::PathBuf) -> Self {
        let trust = Arc::new(HostTrustStore::new(path.clone()));
        Self {
            config: ConfigRepository::new(path.clone()),
            secrets: SecretStore::new(path),
            ssh: SshConnector::new(trust.clone()),
            trust,
            tunnels: TunnelManager::new(),
        }
    }
}
