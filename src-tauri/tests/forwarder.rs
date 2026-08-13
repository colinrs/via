use std::sync::Arc;

use async_trait::async_trait;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use via::{AuthenticatedSession, Forwarder, LocalForwardRule};

struct EchoSession;

#[async_trait]
impl AuthenticatedSession for EchoSession {
    async fn open_direct_tcpip(
        &self,
        _host: &str,
        _port: u16,
    ) -> Result<via::BoxedIo, via::ViaError> {
        let (client, mut server) = tokio::io::duplex(1024);
        tokio::spawn(async move {
            let mut buffer = [0_u8; 32];
            let size = server.read(&mut buffer).await.unwrap();
            server.write_all(&buffer[..size]).await.unwrap();
        });
        Ok(Box::new(client))
    }
    async fn is_closed(&self) -> bool {
        false
    }
}

#[tokio::test]
async fn accepted_loopback_bytes_are_copied_to_direct_tcpip_channel() {
    let forwarder = Forwarder::start(rule(free_port()), Arc::new(EchoSession))
        .await
        .unwrap();
    let mut client = TcpStream::connect(forwarder.local_addr()).await.unwrap();
    client.write_all(b"ping").await.unwrap();
    let mut reply = [0_u8; 4];
    client.read_exact(&mut reply).await.unwrap();
    assert_eq!(&reply, b"ping");
}

#[tokio::test]
async fn refuses_an_already_bound_port() {
    let first = Forwarder::start(rule(free_port()), Arc::new(EchoSession))
        .await
        .unwrap();
    let port = first.local_addr().port();
    let result = Forwarder::start(rule(port), Arc::new(EchoSession)).await;
    assert!(
        matches!(result, Err(via::ViaError::PortConflict { port: failed_port }) if failed_port == port)
    );
}

fn rule(port: u16) -> LocalForwardRule {
    LocalForwardRule::new(
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
        true,
        port,
        "target.internal",
        443,
        "test",
    )
    .unwrap()
}
fn free_port() -> u16 {
    std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
