use async_trait::async_trait;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use via::{AuthenticatedSession, BoxedIo, LocalForwardRule, TunnelManager, TunnelState, ViaError};

#[test]
fn reconnect_backoff_caps_at_sixty_seconds() {
    assert_eq!(TunnelManager::reconnect_delay_seconds(0), 1);
    assert_eq!(TunnelManager::reconnect_delay_seconds(5), 32);
    assert_eq!(TunnelManager::reconnect_delay_seconds(6), 60);
    assert_eq!(TunnelManager::reconnect_delay_seconds(20), 60);
}

struct EchoSession;
#[async_trait]
impl AuthenticatedSession for EchoSession {
    async fn open_direct_tcpip(&self, _: &str, _: u16) -> Result<BoxedIo, ViaError> {
        let (a, _b) = tokio::io::duplex(64);
        Ok(Box::new(a))
    }
    async fn is_closed(&self) -> bool {
        false
    }
}

struct ClosingSession(AtomicBool);
#[async_trait]
impl AuthenticatedSession for ClosingSession {
    async fn open_direct_tcpip(&self, _: &str, _: u16) -> Result<BoxedIo, ViaError> {
        let (a, _b) = tokio::io::duplex(64);
        Ok(Box::new(a))
    }
    async fn is_closed(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[tokio::test]
async fn closed_transport_moves_running_rule_to_reconnecting() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    let transport = Arc::new(ClosingSession(AtomicBool::new(false)));
    manager
        .register_session(session_id, transport.clone())
        .await;
    let rule = rule(session_id, free_port());
    manager.start_rule(rule.clone()).await.unwrap();
    transport.0.store(true, Ordering::SeqCst);
    assert_eq!(manager.detect_closed_transports().await, vec![session_id]);
    assert!(
        manager
            .snapshot()
            .await
            .rules
            .iter()
            .any(|item| item.rule_id == rule.id && item.state == TunnelState::Reconnecting)
    );
}

#[tokio::test]
async fn conflicting_rule_does_not_stop_an_active_sibling_rule() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    manager
        .register_session(session_id, Arc::new(EchoSession))
        .await;
    let port = free_port();
    let active = rule(session_id, port);
    manager.start_rule(active.clone()).await.unwrap();
    let conflict = rule(session_id, port);
    assert!(matches!(
        manager.start_rule(conflict.clone()).await,
        Err(ViaError::PortConflict { .. })
    ));
    let states = manager.snapshot().await;
    assert!(
        states
            .rules
            .iter()
            .any(|item| item.rule_id == active.id && item.state == TunnelState::Active)
    );
    assert!(
        states
            .rules
            .iter()
            .any(|item| item.rule_id == conflict.id && item.state == TunnelState::Conflict)
    );
}

#[tokio::test]
async fn manual_stop_prevents_a_later_transport_drop_from_reconnecting_the_rule() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    manager
        .register_session(session_id, Arc::new(EchoSession))
        .await;
    let rule = rule(session_id, free_port());
    manager.start_rule(rule.clone()).await.unwrap();
    manager.stop_rule(rule.id).await;
    manager.simulate_transport_drop(session_id).await;
    assert!(
        manager
            .snapshot()
            .await
            .rules
            .iter()
            .any(|item| item.rule_id == rule.id && item.state == TunnelState::Stopped)
    );
}

#[tokio::test]
async fn transport_drop_restarts_active_rules_for_the_session() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    manager
        .register_session(session_id, Arc::new(EchoSession))
        .await;
    let rule = rule(session_id, free_port());
    manager.start_rule(rule.clone()).await.unwrap();

    manager.simulate_transport_drop(session_id).await;

    assert!(manager.snapshot().await.rules.iter().any(|item| {
        item.rule_id == rule.id && item.state == TunnelState::Active && item.message.is_none()
    }));
}

#[tokio::test]
async fn disconnecting_a_session_stops_its_running_rules() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    manager
        .register_session(session_id, Arc::new(EchoSession))
        .await;
    let rule = rule(session_id, free_port());
    manager.start_rule(rule.clone()).await.unwrap();

    manager.disconnect_session(session_id).await;

    assert!(
        manager
            .snapshot()
            .await
            .rules
            .iter()
            .any(|item| item.rule_id == rule.id && item.state == TunnelState::Stopped)
    );
}
#[tokio::test]
async fn snapshot_reports_connected_sessions_and_rule_states() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    manager
        .register_session(session_id, Arc::new(EchoSession))
        .await;
    let rule = rule(session_id, free_port());
    manager.start_rule(rule.clone()).await.unwrap();

    let snapshot = manager.snapshot().await;

    assert!(snapshot.connected_session_ids.contains(&session_id));
    assert!(
        snapshot
            .rules
            .iter()
            .any(|item| item.rule_id == rule.id && item.state == TunnelState::Active)
    );
}

#[tokio::test]
async fn snapshot_omits_disconnected_sessions() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    manager
        .register_session(session_id, Arc::new(EchoSession))
        .await;
    manager.disconnect_session(session_id).await;

    assert!(
        !manager
            .snapshot()
            .await
            .connected_session_ids
            .contains(&session_id)
    );
}

#[tokio::test]
async fn snapshot_serializes_connected_session_ids_as_camel_case() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    manager
        .register_session(session_id, Arc::new(EchoSession))
        .await;

    let value = serde_json::to_value(manager.snapshot().await).unwrap();

    assert_eq!(
        value["connectedSessionIds"],
        serde_json::json!([session_id.to_string()])
    );
    assert!(value.get("connected_session_ids").is_none());
}

#[tokio::test]
async fn snapshot_orders_connected_session_ids() {
    let manager = TunnelManager::new();
    let greater = uuid::Uuid::from_u128(2);
    let lesser = uuid::Uuid::from_u128(1);
    manager.register_session(greater, Arc::new(EchoSession)).await;
    manager.register_session(lesser, Arc::new(EchoSession)).await;

    let snapshot = manager.snapshot().await;

    assert_eq!(snapshot.connected_session_ids, vec![lesser, greater]);
}

fn rule(session_id: uuid::Uuid, port: u16) -> LocalForwardRule {
    LocalForwardRule::new(
        uuid::Uuid::new_v4(),
        session_id,
        true,
        port,
        "target",
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
