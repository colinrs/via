use crate::{AuthConfig, AuthenticatedSession, BoxedIo, HostTrustStore, SessionConfig, ViaError};
use async_trait::async_trait;
use russh::{
    client,
    keys::{PrivateKeyWithHashAlg, load_secret_key, ssh_key::HashAlg},
};
use std::{path::Path, sync::Arc};
use tokio::sync::Mutex;

pub struct SshConnector {
    trust: Arc<HostTrustStore>,
}
pub struct ConnectSecrets {
    pub password: Option<String>,
    pub key_passphrase: Option<String>,
}
struct TrustHandler {
    trust: Arc<HostTrustStore>,
    host: String,
    port: u16,
    trust_error: Arc<std::sync::Mutex<Option<ViaError>>>,
}
struct RusshSession {
    handle: Mutex<client::Handle<TrustHandler>>,
}

impl SshConnector {
    pub fn new(trust: Arc<HostTrustStore>) -> Self {
        Self { trust }
    }
    pub async fn connect(
        &self,
        config: &SessionConfig,
        secrets: ConnectSecrets,
    ) -> Result<Arc<dyn AuthenticatedSession>, ViaError> {
        let trust_error = Arc::new(std::sync::Mutex::new(None));
        let handler = TrustHandler {
            trust: self.trust.clone(),
            host: config.host.clone(),
            port: config.port,
            trust_error: trust_error.clone(),
        };
        let mut handle = match client::connect(
            Arc::new(client::Config::default()),
            (config.host.as_str(), config.port),
            handler,
        )
        .await
        {
            Ok(handle) => handle,
            Err(error) => {
                if let Ok(mut recorded) = trust_error.lock()
                    && let Some(error) = recorded.take()
                {
                    return Err(error);
                }
                return Err(error);
            }
        };
        let authenticated = match &config.auth {
            AuthConfig::Password { .. } => handle
                .authenticate_password(
                    &config.user,
                    secrets.password.ok_or(ViaError::SecretStoreLocked)?,
                )
                .await?
                .success(),
            AuthConfig::PrivateKey { path, .. } => {
                let key = load_secret_key(Path::new(path), secrets.key_passphrase.as_deref())
                    .map_err(|error| ViaError::Forwarding(error.to_string()))?;
                let signer = PrivateKeyWithHashAlg::new(
                    Arc::new(key),
                    handle.best_supported_rsa_hash().await?.flatten(),
                );
                handle
                    .authenticate_publickey(&config.user, signer)
                    .await?
                    .success()
            }
        };
        if !authenticated {
            return Err(ViaError::Forwarding("SSH authentication failed".into()));
        }
        Ok(Arc::new(RusshSession {
            handle: Mutex::new(handle),
        }))
    }
}

impl client::Handler for TrustHandler {
    type Error = ViaError;
    async fn check_server_key(
        &mut self,
        key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let algorithm = key.algorithm().to_string();
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        if let Err(error) =
            self.trust
                .verify_or_request(&self.host, self.port, &algorithm, &fingerprint)
        {
            if let Ok(mut recorded) = self.trust_error.lock() {
                *recorded = Some(error.clone());
            }
            return Err(error);
        }
        Ok(true)
    }
}

#[async_trait]
impl AuthenticatedSession for RusshSession {
    async fn open_direct_tcpip(&self, host: &str, port: u16) -> Result<BoxedIo, ViaError> {
        let handle = self.handle.lock().await;
        let channel = handle
            .channel_open_direct_tcpip(host, port.into(), "127.0.0.1", 0)
            .await?;
        Ok(Box::new(channel.into_stream()))
    }
    async fn is_closed(&self) -> bool {
        self.handle.lock().await.is_closed()
    }
}
