use std::{net::Ipv4Addr, sync::Arc};

use async_trait::async_trait;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpListener,
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

use crate::{LocalForwardRule, ViaError};

pub type BoxedIo = Box<dyn AsyncReadWrite>;
pub trait AsyncReadWrite: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncReadWrite for T {}

#[async_trait]
pub trait AuthenticatedSession: Send + Sync {
    async fn open_direct_tcpip(&self, host: &str, port: u16) -> Result<BoxedIo, ViaError>;
    async fn is_closed(&self) -> bool;
}

pub struct Forwarder {
    address: std::net::SocketAddr,
    cancel: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl Forwarder {
    pub async fn start(
        rule: LocalForwardRule,
        session: Arc<dyn AuthenticatedSession>,
    ) -> Result<Self, ViaError> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, rule.local_port))
            .await
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AddrInUse {
                    ViaError::PortConflict {
                        port: rule.local_port,
                    }
                } else {
                    ViaError::Forwarding(error.to_string())
                }
            })?;
        let address = listener
            .local_addr()
            .map_err(|error| ViaError::Forwarding(error.to_string()))?;
        let cancel = CancellationToken::new();
        let task_cancel = cancel.clone();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = task_cancel.cancelled() => break,
                    accepted = listener.accept() => match accepted { Ok((mut inbound, _)) => { let session = session.clone(); let host = rule.target_host.clone(); let port = rule.target_port; tokio::spawn(async move { if let Ok(mut outbound) = session.open_direct_tcpip(&host, port).await { let _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound).await; } }); }, Err(_) => break }
                }
            }
        });
        Ok(Self {
            address,
            cancel,
            task: Some(task),
        })
    }
    pub fn local_addr(&self) -> std::net::SocketAddr {
        self.address
    }
    pub async fn shutdown(mut self) {
        self.cancel.cancel();
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}
impl Drop for Forwarder {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
