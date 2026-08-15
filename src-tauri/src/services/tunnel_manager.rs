use crate::{
    AuthenticatedSession, Forwarder, LocalForwardRule, RuntimeRuleState, RuntimeSnapshot,
    TunnelState, ViaError,
};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use tokio::sync::Mutex;
pub struct TunnelManager {
    sessions: Mutex<HashMap<uuid::Uuid, Arc<dyn AuthenticatedSession>>>,
    rules: Mutex<HashMap<uuid::Uuid, LocalForwardRule>>,
    running: Mutex<HashMap<uuid::Uuid, Forwarder>>,
    manually_stopped: Mutex<HashSet<uuid::Uuid>>,
    states: Mutex<HashMap<uuid::Uuid, RuntimeRuleState>>,
}
impl TunnelManager {
    pub const fn reconnect_delay_seconds(attempt: u32) -> u64 {
        match attempt {
            0..=5 => 1_u64 << attempt,
            _ => 60,
        }
    }
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            rules: Mutex::new(HashMap::new()),
            running: Mutex::new(HashMap::new()),
            manually_stopped: Mutex::new(HashSet::new()),
            states: Mutex::new(HashMap::new()),
        }
    }
    pub async fn register_session(&self, id: uuid::Uuid, session: Arc<dyn AuthenticatedSession>) {
        self.sessions.lock().await.insert(id, session);
    }
    pub async fn disconnect_session(&self, session_id: uuid::Uuid) {
        self.sessions.lock().await.remove(&session_id);
        let rule_ids = self
            .rules
            .lock()
            .await
            .values()
            .filter(|rule| rule.session_id == session_id)
            .map(|rule| rule.id)
            .collect::<Vec<_>>();
        for rule_id in rule_ids {
            self.stop_rule(rule_id).await;
        }
    }
    pub async fn detect_closed_transports(&self) -> Vec<uuid::Uuid> {
        let sessions = self.sessions.lock().await.clone();
        let mut closed = Vec::new();
        for (id, session) in sessions {
            if session.is_closed().await {
                closed.push(id);
            }
        }
        for session_id in &closed {
            self.mark_transport_dropped(*session_id).await;
        }
        closed
    }
    pub async fn mark_transport_dropped(&self, session_id: uuid::Uuid) {
        self.sessions.lock().await.remove(&session_id);
        let stopped = self.manually_stopped.lock().await.clone();
        let rules = self
            .rules
            .lock()
            .await
            .values()
            .filter(|rule| rule.session_id == session_id && !stopped.contains(&rule.id))
            .cloned()
            .collect::<Vec<_>>();
        let old = {
            let mut running = self.running.lock().await;
            rules
                .iter()
                .filter_map(|rule| running.remove(&rule.id))
                .collect::<Vec<_>>()
        };
        for forwarder in old {
            forwarder.shutdown().await;
        }
        for rule in rules {
            self.set(rule.id, TunnelState::Reconnecting, None).await;
        }
    }
    pub async fn start_rule(&self, rule: LocalForwardRule) -> Result<(), ViaError> {
        self.rules.lock().await.insert(rule.id, rule.clone());
        self.manually_stopped.lock().await.remove(&rule.id);
        self.set(rule.id, TunnelState::Starting, None).await;
        let session = match self.sessions.lock().await.get(&rule.session_id).cloned() {
            Some(session) => session,
            None => {
                let error = ViaError::Forwarding("SSH session is not connected".into());
                self.set(rule.id, TunnelState::Failed, Some(format!("{error:?}")))
                    .await;
                return Err(error);
            }
        };
        match Forwarder::start(rule.clone(), session).await {
            Ok(f) => {
                self.running.lock().await.insert(rule.id, f);
                self.set(rule.id, TunnelState::Active, None).await;
                Ok(())
            }
            Err(e) => {
                let s = if matches!(e, ViaError::PortConflict { .. }) {
                    TunnelState::Conflict
                } else {
                    TunnelState::Failed
                };
                self.set(rule.id, s, Some(format!("{e:?}"))).await;
                Err(e)
            }
        }
    }
    pub async fn stop_rule(&self, id: uuid::Uuid) {
        if let Some(forwarder) = self.running.lock().await.remove(&id) {
            forwarder.shutdown().await;
        }
        self.manually_stopped.lock().await.insert(id);
        self.set(id, TunnelState::Stopped, None).await;
    }

    /// Recreates forwards that were active when an SSH transport disappeared.
    /// The production connector can call this after it has established a fresh
    /// authenticated transport; keeping it here makes the state transition
    /// deterministic and ensures explicit user stops are never revived.
    pub async fn simulate_transport_drop(&self, session_id: uuid::Uuid) {
        let rules = self
            .rules
            .lock()
            .await
            .values()
            .filter(|rule| rule.session_id == session_id)
            .cloned()
            .collect::<Vec<_>>();
        let manually_stopped = self.manually_stopped.lock().await.clone();
        let affected = rules
            .into_iter()
            .filter(|rule| !manually_stopped.contains(&rule.id))
            .collect::<Vec<_>>();

        let old_forwarders = {
            let mut running = self.running.lock().await;
            affected
                .iter()
                .filter_map(|rule| running.remove(&rule.id))
                .collect::<Vec<_>>()
        };
        for forwarder in old_forwarders {
            forwarder.shutdown().await;
        }

        let session = self.sessions.lock().await.get(&session_id).cloned();
        for rule in affected {
            self.set(rule.id, TunnelState::Reconnecting, None).await;
            match session.clone() {
                Some(session) => match Forwarder::start(rule.clone(), session).await {
                    Ok(forwarder) => {
                        self.running.lock().await.insert(rule.id, forwarder);
                        self.set(rule.id, TunnelState::Active, None).await;
                    }
                    Err(error) => self.record_failure(rule.id, error).await,
                },
                None => {
                    self.set(
                        rule.id,
                        TunnelState::Failed,
                        Some("SSH session is not connected".into()),
                    )
                    .await;
                }
            }
        }
    }
    pub async fn snapshot(&self) -> RuntimeSnapshot {
        let mut connected_session_ids: Vec<uuid::Uuid> =
            self.sessions.lock().await.keys().copied().collect();
        connected_session_ids.sort();
        RuntimeSnapshot {
            rules: self.states.lock().await.values().cloned().collect(),
            connected_session_ids,
        }
    }
    async fn set(&self, id: uuid::Uuid, state: TunnelState, message: Option<String>) {
        self.states.lock().await.insert(
            id,
            RuntimeRuleState {
                rule_id: id,
                state,
                message,
            },
        );
    }
    async fn record_failure(&self, id: uuid::Uuid, error: ViaError) {
        let state = if matches!(error, ViaError::PortConflict { .. }) {
            TunnelState::Conflict
        } else {
            TunnelState::Failed
        };
        self.set(id, state, Some(format!("{error:?}"))).await;
    }
}
impl Default for TunnelManager {
    fn default() -> Self {
        Self::new()
    }
}
