# Session feedback and connection-state design

## Goal

Make the SSH session page communicate what is happening: the four action buttons (connect-and-start, disconnect, reconnect-tunnels, start-all) must show whether they are enabled, running, and what the outcome was; the per-rule status badge must reflect the real tunnel state instead of staying grey; and the session header must show whether the session is actually connected. This is a minimal fix with no new dialog/toast surface — outcomes are surfaced through the status badges, the footer status bar, and a session connection indicator.

## Root cause

The per-rule status badge never updates because the `runtime-state` contract is broken:

- The backend emits `TunnelManager::snapshot()`, a bare `Vec<RuntimeRuleState>` (a JSON array).
- The frontend listener reads `runtime.rules` expecting a `{ rules: [...] }` object, so `runtime.rules` is `undefined` and the loop throws.

The frontend also fails to default `runtimeState` for rules loaded from `load_config` (the Rust `LocalForwardRule` has no `runtime_state` field), so reloaded rules carry `runtimeState === undefined`.

## Runtime snapshot contract

Introduce an explicit snapshot payload carrying both per-rule state and the set of connected sessions:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub rules: Vec<RuntimeRuleState>,
    pub connected_session_ids: Vec<Uuid>,
}
```

`TunnelManager::snapshot()` returns this struct; `connected_session_ids` is the key set of the `sessions` map (the authenticated SSH transports), which `connect_session`, `disconnect_session`, and `detect_closed_transports` already maintain. Every existing `app.emit("runtime-state", snapshot().await)` call site follows the type change automatically.

The frontend `RuntimeSnapshot` interface gains `connectedSessionIds: string[]`, and the runtime listener is rewritten to parse-and-validate the payload defensively before mutating any state.

## Frontend store

- Track `connectedSessionIds: string[]` in the reactive store state (also in the `ViaStore` interface).
- Add a `parseRuntimeSnapshot(value: unknown): RuntimeSnapshot | null` validator that:
  - rejects non-objects and arrays;
  - requires `rules` to be an array of `{ ruleId: string, state: TunnelState, message: string | null }` (reusing `isTunnelState`);
  - treats a missing `connectedSessionIds` as `[]` and filters it to strings.
- The listener returns early on a malformed payload, otherwise updates `connectedSessionIds` and each rule's `runtimeState` (`reconnecting` still triggers `scheduleReconnect`).
- `replaceConfig` defaults every loaded rule's `runtimeState` to `'stopped'` when absent, covering both `load_config` and `save_session_secret` responses.

## UI behavior

New state in `App.vue`:

```ts
const sessionBusy = ref<'connect' | 'disconnect' | 'reconnect' | null>(null)
const bulkRulesBusy = ref(false)
const isConnected = computed(() => !!selectedSessionId.value
  && store.connectedSessionIds.includes(selectedSessionId.value))
```

Header buttons (disabled while busy, label swaps to an "in progress" form via `common.inProgress`):

- **Connect and start**: disabled when `sessionBusy !== null || isConnected`; runs `connect_session` then `start_enabled_rules`; on error opens the host-trust dialog or sets the connect/host-key-changed status error.
- **Disconnect**: disabled when `sessionBusy !== null || !isConnected`; runs `disconnect_session`; a failure sets a new `error.disconnect` status error (previously an unhandled rejection).
- **Reconnect tunnels**: disabled when `sessionBusy !== null`; forcibly rebuilds the connection via `disconnect_session → connect_session → start_enabled_rules`, sharing connect's host-trust/host-key error handling.

The session header shows a real connection indicator: a dot that is grey when disconnected and green when connected, plus a "connected / disconnected" text label.

`TunnelGrid` gains `bulkBusy` and `sessionConnected` props. "Start all" is disabled when `bulkBusy || !sessionConnected`; "Stop all" when `bulkBusy`. `App.vue` wraps `startAll`/`stopAll` with a busy flag and try/catch (`error.ruleOperation`); `connect()` calls `store.startEnabledRules` directly instead of reusing the busy-wrapped `startAll`.

Add disabled styling for header buttons (`opacity` + `cursor: not-allowed`), which currently have none.

## Internationalization

New translation keys in both `en` and `zh-CN` (type-checked via `TranslationKey`):

- `state.connected` — "Connected" / "已连接"
- `state.disconnected` — "Disconnected" / "未连接"
- `error.disconnect` — "Disconnect failed. Please try again." / "断开连接失败，请重试。"

## Backend boundaries

`RuntimeSnapshot` lives in `domain/models.rs` and is re-exported through `domain/mod.rs` and `lib.rs`. `TunnelManager::snapshot()` remains the single source of the emitted payload. No other backend behavior changes.

## Error handling and tests

Rust tests cover `snapshot()` returning both rule states and connected session ids across connect/disconnect/transport-drop transitions. Vue tests cover: malformed runtime payloads are ignored; well-formed payloads update badges and connection state; loaded rules without `runtimeState` render as "Stopped"; connect/start-all gating on connection state; disconnect/reconnect/start-all/stop-all busy and error paths; and the `error.disconnect` message. Full frontend typecheck/build and Rust test/check/lint remain required.
