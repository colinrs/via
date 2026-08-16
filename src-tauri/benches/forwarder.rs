use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;

use async_trait::async_trait;
use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use via::{AuthenticatedSession, BoxedIo, Forwarder, LocalForwardRule, ViaError};

struct LoopbackSession {
    peer: SocketAddr,
}

#[async_trait]
impl AuthenticatedSession for LoopbackSession {
    async fn open_direct_tcpip(&self, _host: &str, _port: u16) -> Result<BoxedIo, ViaError> {
        let stream = TcpStream::connect(self.peer)
            .await
            .map_err(|error| ViaError::Forwarding(error.to_string()))?;
        Ok(Box::new(stream))
    }

    async fn is_closed(&self) -> bool {
        false
    }
}

/// Reads `batch` bytes, sends a 1-byte ACK, and repeats — so the client can
/// time how long it takes to push a fixed batch through the tunnel.
async fn spawn_ack_sink(batch: usize) -> SocketAddr {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut stream, _) = match listener.accept().await {
                Ok(accepted) => accepted,
                Err(_) => break,
            };
            tokio::spawn(async move {
                let mut remaining = batch;
                let mut buffer = [0_u8; 64 * 1024];
                loop {
                    let size = match stream.read(&mut buffer).await {
                        Ok(0) | Err(_) => break,
                        Ok(size) => size,
                    };
                    if size < remaining {
                        remaining -= size;
                    } else {
                        if stream.write_all(&[0_u8]).await.is_err() {
                            break;
                        }
                        remaining = batch;
                    }
                }
            });
        }
    });
    addr
}

/// Echoes everything it reads, for round-trip latency measurement.
async fn spawn_echo() -> SocketAddr {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut stream, _) = match listener.accept().await {
                Ok(accepted) => accepted,
                Err(_) => break,
            };
            tokio::spawn(async move {
                let mut buffer = [0_u8; 64 * 1024];
                loop {
                    match stream.read(&mut buffer).await {
                        Ok(0) | Err(_) => break,
                        Ok(size) => {
                            if stream.write_all(&buffer[..size]).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            });
        }
    });
    addr
}

async fn spawn_forwarder(peer: SocketAddr) -> Forwarder {
    let rule = LocalForwardRule::new(
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
        true,
        free_port(),
        "target.internal",
        443,
        "bench",
    )
    .unwrap();
    Forwarder::start(rule, Arc::new(LoopbackSession { peer }))
        .await
        .unwrap()
}

fn free_port() -> u16 {
    std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

async fn run_throughput(client: &mut TcpStream, size: usize) {
    let chunk = [0_u8; 64 * 1024];
    let mut remaining = size;
    while remaining > 0 {
        let bytes = chunk.len().min(remaining);
        client.write_all(&chunk[..bytes]).await.unwrap();
        remaining -= bytes;
    }
    let mut ack = [0_u8; 1];
    client.read_exact(&mut ack).await.unwrap();
}

async fn run_roundtrip(client: &mut TcpStream) {
    client.write_all(&[0_u8]).await.unwrap();
    let mut reply = [0_u8; 1];
    client.read_exact(&mut reply).await.unwrap();
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

fn bench_unidirectional_throughput(c: &mut Criterion) {
    let runtime = runtime();
    let mut group = c.benchmark_group("forwarder_unidirectional_throughput");
    for size in [1_usize << 20, 16_usize << 20] {
        let sink_addr = runtime.block_on(spawn_ack_sink(size));
        let forwarder = runtime.block_on(spawn_forwarder(sink_addr));
        let forwarder_addr = forwarder.local_addr();
        let mut client = runtime
            .block_on(TcpStream::connect(forwarder_addr))
            .unwrap();
        group.throughput(Throughput::Bytes(size as u64));
        group.bench_function(BenchmarkId::new("unidirectional", size), |bencher| {
            bencher.iter(|| runtime.block_on(run_throughput(&mut client, size)));
        });
    }
    group.finish();
}

fn bench_roundtrip_latency(c: &mut Criterion) {
    let runtime = runtime();
    let echo_addr = runtime.block_on(spawn_echo());
    let forwarder = runtime.block_on(spawn_forwarder(echo_addr));
    let forwarder_addr = forwarder.local_addr();
    let mut client = runtime
        .block_on(TcpStream::connect(forwarder_addr))
        .unwrap();
    let mut group = c.benchmark_group("forwarder_roundtrip_latency");
    group.bench_function("1_byte_echo", |bencher| {
        bencher.iter(|| runtime.block_on(run_roundtrip(&mut client)));
    });
    group.finish();
}

criterion_group!(
    benches,
    bench_unidirectional_throughput,
    bench_roundtrip_latency
);
criterion_main!(benches);
