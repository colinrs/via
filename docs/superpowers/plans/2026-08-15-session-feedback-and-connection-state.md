# Session Feedback and Connection State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SSH session page communicate state: fix the broken `runtime-state` contract so rule status badges actually update, and surface session connection state plus busy/disabled feedback on the connect/disconnect/reconnect/start-all buttons.

**Architecture:** The backend emits a structured `RuntimeSnapshot { rules, connectedSessionIds }` instead of a bare array. The frontend store validates and applies that snapshot, tracks `connectedSessionIds`, and defaults missing `runtimeState` to `stopped` on config load. `App.vue` and `TunnelGrid.vue` derive button enabled/disabled and busy state from it.

**Tech Stack:** Rust (Tauri 2, tokio, serde, uuid) backend; Vue 3 + TypeScript + Vitest + Vue Test Utils frontend.

## Global Constraints

- Rust serialization: structs use `#[serde(rename_all = "camelCase")]`, enum tags `snake_case`; the frontend DTO field names must match exactly.
- Frontend DTOs are `camelCase`; store validators reject malformed bridge payloads rather than silently corrupting state.
- i18n: `en` and `zh-CN` catalogs must stay in sync; `TranslationKey = keyof typeof en` type-checks that every `en` key has a `zh-CN` entry.
- Commit messages use conventional-commit prefixes (`feat:`, `fix:`, `test:`, `docs:`) in English.
- Full gate is `make test` (vitest + `vue-tsc` typecheck + `cargo fmt --check` + `clippy -D warnings` + `cargo test`).
- Tunnels bind only to `127.0.0.1`; no secrets may leak into logs, errors, or exported config.

---

### Task 1: Backend structured runtime snapshot

**Files:**
- Modify: `src-tauri/src/domain/models.rs`
- Modify: `src-tauri/src/domain/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/services/tunnel_manager.rs`
- Test: `src-tauri/tests/tunnel_manager.rs`

**Interfaces:**
- Consumes: existing `RuntimeRuleState`, `TunnelState`, `Uuid` (already exported).
- Produces: `RuntimeSnapshot { pub rules: Vec<RuntimeRuleState>, pub connected_session_ids: Vec<Uuid> }`; `TunnelManager::snapshot() -> RuntimeSnapshot`.

- [ ] **Step 1: Add the `RuntimeSnapshot` struct**

In `src-tauri/src/domain/models.rs`, immediately after the `RuntimeRuleState` struct (after line 23), add:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub rules: Vec<RuntimeRuleState>,
    pub connected_session_ids: Vec<Uuid>,
}
```

- [ ] **Step 2: Re-export `RuntimeSnapshot`**

In `src-tauri/src/domain/mod.rs`, change the `pub use models::{...}` line to include `RuntimeSnapshot`:

```rust
pub use models::{
    AppConfig, AuthConfig, Group, LocalForwardRule, RuntimeRuleState, RuntimeSnapshot,
    SessionConfig, TunnelState,
};
```

In `src-tauri/src/lib.rs`, change the `pub use domain::{...}` line to include `RuntimeSnapshot`:

```rust
pub use domain::{
    AppConfig, AuthConfig, Group, LocalForwardRule, RuntimeRuleState, RuntimeSnapshot,
    SessionConfig, TunnelState, ViaError,
};
```

- [ ] **Step 3: Change `TunnelManager::snapshot()` to return `RuntimeSnapshot`**

In `src-tauri/src/services/tunnel_manager.rs`, add `RuntimeSnapshot` to the `use crate::{...}` list at the top (currently imports `RuntimeRuleState, TunnelState, ViaError` and others), then replace the `snapshot` method (lines 177-179):

```rust
    pub async fn snapshot(&self) -> RuntimeSnapshot {
        RuntimeSnapshot {
            rules: self.states.lock().await.values().cloned().collect(),
            connected_session_ids: self.sessions.lock().await.keys().copied().collect(),
        }
    }
```

- [ ] **Step 4: Update the Rust tests to the new shape and add connection coverage**

In `src-tauri/tests/tunnel_manager.rs`, change every `.snapshot().await.iter()` to `.snapshot().await.rules.iter()`, and the `let states = manager.snapshot().await;` block (line 76-86) to use `states.rules.iter()`. There are five occurrences (lines 54, 76-86, 102, 121, 140).

Then add these two tests at the end of the file (before the `rule` helper):

```rust
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
    assert!(snapshot
        .rules
        .iter()
        .any(|item| item.rule_id == rule.id && item.state == TunnelState::Active));
}

#[tokio::test]
async fn snapshot_omits_disconnected_sessions() {
    let manager = TunnelManager::new();
    let session_id = uuid::Uuid::new_v4();
    manager
        .register_session(session_id, Arc::new(EchoSession))
        .await;
    manager.disconnect_session(session_id).await;

    assert!(!manager.snapshot().await.connected_session_ids.contains(&session_id));
}
```

- [ ] **Step 5: Run the Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass, including the two new `snapshot_*` tests.

- [ ] **Step 6: Commit**

```bash
git add -f src-tauri/src/domain/models.rs src-tauri/src/domain/mod.rs src-tauri/src/lib.rs src-tauri/src/services/tunnel_manager.rs src-tauri/tests/tunnel_manager.rs
git commit -m "fix: emit structured runtime-state snapshot with connected sessions"
```

---

### Task 2: Frontend store — validate snapshot, track connections, normalize state

**Files:**
- Modify: `src/stores/via.ts`
- Test: `src/stores/via.spec.ts`

**Interfaces:**
- Consumes: `isTunnelState` from `../types/via`; existing `RuntimeSnapshot` type (being extended).
- Produces: `RuntimeSnapshot { rules, connectedSessionIds }`; store state field `connectedSessionIds: string[]`; `ViaStore` interface member `connectedSessionIds`.

- [ ] **Step 1: Write the failing store tests**

In `src/stores/via.spec.ts`, add a helper above `describe('ViaStore', ...)` and three tests inside the `describe` block.

Helper (add after the `import` lines):

```ts
async function storeWithRuntimeHandler(rules: Array<{ id: string; sessionId: string; enabled: boolean; localPort: number; targetHost: string; targetPort: number; note: string; runtimeState?: string }>) {
  let runtimeHandler: ((payload: unknown) => void) | undefined
  const config = { schemaVersion: 1, groups: [], sessions: [], rules }
  const invoke = vi.fn().mockImplementation((command: string) => command === 'load_config'
    ? Promise.resolve(config)
    : command === 'secret_store_status' ? Promise.resolve({ configured: true }) : Promise.resolve())
  const store = createViaStore({
    invoke,
    listen: vi.fn().mockImplementation((_event: string, handler: (payload: unknown) => void) => {
      runtimeHandler = handler
      return Promise.resolve(() => {})
    }),
  } as ViaBridge)
  await store.initialize()
  return { store, fire: (payload: unknown) => runtimeHandler?.(payload) }
}
```

Tests (add inside `describe('ViaStore', () => { ... })`, before the closing `})`):

```ts
  it('applies a well-formed runtime snapshot to rules and connection state', async () => {
    const { store, fire } = await storeWithRuntimeHandler([
      { id: 'rule-a', sessionId: 'session-a', enabled: true, localPort: 1, targetHost: 'h', targetPort: 1, note: '' },
    ])

    fire({ rules: [{ ruleId: 'rule-a', state: 'active', message: null }], connectedSessionIds: ['session-a'] })

    expect(store.rules[0].runtimeState).toBe('active')
    expect(store.connectedSessionIds).toEqual(['session-a'])
  })

  it('ignores malformed runtime snapshots without mutating state', async () => {
    const invalidPayloads: unknown[] = [
      null,
      [{ ruleId: 'rule-a', state: 'active', message: null }],
      { rules: 'not-an-array', connectedSessionIds: [] },
      { rules: [null] },
      { rules: [{ state: 'active', message: null }] },
      { rules: [{ ruleId: 'rule-a', state: 'dynamic', message: null }] },
      { rules: [{ ruleId: 'rule-a', state: 'active', message: 42 }] },
      { rules: [], connectedSessionIds: 'not-an-array' },
    ]
    for (const payload of invalidPayloads) {
      const { store, fire } = await storeWithRuntimeHandler([
        { id: 'rule-a', sessionId: 'session-a', enabled: true, localPort: 1, targetHost: 'h', targetPort: 1, note: '' },
      ])
      fire(payload)
      expect(store.rules[0].runtimeState).toBe('stopped')
      expect(store.connectedSessionIds).toEqual([])
    }
  })

  it('defaults a loaded rule runtimeState to stopped when the backend omits it', async () => {
    const invoke = vi.fn().mockImplementation((command: string) => command === 'load_config'
      ? Promise.resolve({
          schemaVersion: 1,
          groups: [],
          sessions: [],
          rules: [{ id: 'rule-a', sessionId: 'session-a', enabled: true, localPort: 1, targetHost: 'h', targetPort: 1, note: '' }],
        })
      : command === 'secret_store_status' ? Promise.resolve({ configured: true }) : Promise.resolve())
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await store.initialize()

    expect(store.rules[0].runtimeState).toBe('stopped')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/stores/via.spec.ts`
Expected: the new tests fail — the runtime listener throws on `runtime.rules` (array), `connectedSessionIds` is undefined, and loaded rules have `runtimeState === undefined`.

- [ ] **Step 3: Implement the store changes**

In `src/stores/via.ts`:

1. Add the value import next to the existing type import (line 5):

```ts
import type { Group, LocalForwardRule, SessionConfig, TunnelState } from '../types/via'
import { isTunnelState } from '../types/via'
```

2. Extend the `RuntimeSnapshot` interface (lines 12-14):

```ts
export interface RuntimeSnapshot {
  rules: Array<{ ruleId: string; state: TunnelState; message: string | null }>
  connectedSessionIds: string[]
}
```

3. Add `connectedSessionIds: string[]` to the `ViaStore` interface (after `rules: LocalForwardRule[]` on line 40).

4. Add a module-level `parseRuntimeSnapshot` function above `createViaStore` (after the `defaultPreferences` block):

```ts
function parseRuntimeSnapshot(value: unknown): RuntimeSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.rules)) return null
  const rules: RuntimeSnapshot['rules'] = []
  for (const item of record.rules) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const entry = item as Record<string, unknown>
    if (typeof entry.ruleId !== 'string' || typeof entry.state !== 'string' || !isTunnelState(entry.state)) return null
    if (entry.message !== undefined && entry.message !== null && typeof entry.message !== 'string') return null
    rules.push({
      ruleId: entry.ruleId,
      state: entry.state,
      message: typeof entry.message === 'string' ? entry.message : null,
    })
  }
  const connected = record.connectedSessionIds
  if (connected !== undefined && !Array.isArray(connected)) return null
  const connectedSessionIds = (connected ?? []).filter((id): id is string => typeof id === 'string')
  return { rules, connectedSessionIds }
}
```

5. Add `connectedSessionIds: [] as string[]` to the reactive `state` object (after `rules: [] as LocalForwardRule[]`, around line 84).

6. Normalize `runtimeState` in `replaceConfig` (lines 96-100):

```ts
  const replaceConfig = (config: PersistedConfig) => {
    replace(state.groups, config.groups)
    replace(state.sessions, config.sessions)
    replace(state.rules, config.rules.map((rule) => ({ ...rule, runtimeState: rule.runtimeState ?? 'stopped' })))
  }
```

7. Rewrite the runtime listener inside `initialize()` (lines 163-171):

```ts
          unsubscribe = await runtime.listen<unknown>('runtime-state', (payload) => {
            const snapshot = parseRuntimeSnapshot(payload)
            if (!snapshot) return
            state.connectedSessionIds = snapshot.connectedSessionIds
            for (const update of snapshot.rules) {
              const rule = state.rules.find((item) => item.id === update.ruleId)
              if (rule) {
                rule.runtimeState = update.state
                if (update.state === 'reconnecting') scheduleReconnect(rule.sessionId)
              }
            }
          })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/stores/via.spec.ts`
Expected: all `ViaStore` tests pass, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add src/stores/via.ts src/stores/via.spec.ts
git commit -m "fix: validate runtime-state payload and track session connection state"
```

---

### Task 3: TunnelGrid bulk-action gating

**Files:**
- Modify: `src/components/TunnelGrid.vue`
- Test: `src/components/TunnelGrid.spec.ts`

**Interfaces:**
- Consumes: nothing new (existing `LocalForwardRule`).
- Produces: two optional props `bulkBusy?: boolean` (default `false`) and `sessionConnected?: boolean` (default `true`) that disable the toolbar bulk buttons.

- [ ] **Step 1: Write the failing component test**

In `src/components/TunnelGrid.spec.ts`, add:

```ts
  it('disables start-all when disconnected and both bulk buttons while busy', () => {
    const disconnected = mount(TunnelGrid, {
      ...withChineseI18n(),
      props: { rules: [rules[0]], sessionConnected: false },
    })
    const toolbarButtons = disconnected.findAll('.toolbar-actions button')
    expect(toolbarButtons[1].attributes('disabled')).toBeDefined()
    expect(toolbarButtons[2].attributes('disabled')).toBeUndefined()

    const busy = mount(TunnelGrid, {
      ...withChineseI18n(),
      props: { rules: [rules[0]], sessionConnected: true, bulkBusy: true },
    })
    const busyButtons = busy.findAll('.toolbar-actions button')
    expect(busyButtons[1].attributes('disabled')).toBeDefined()
    expect(busyButtons[2].attributes('disabled')).toBeDefined()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/TunnelGrid.spec.ts`
Expected: the new test fails — the buttons have no `disabled` attribute because the props do not exist yet.

- [ ] **Step 3: Implement the props and disabled bindings**

In `src/components/TunnelGrid.vue`, replace the `defineProps` block (line 7) with:

```ts
const props = withDefaults(defineProps<{
  rules: LocalForwardRule[]
  bulkBusy?: boolean
  sessionConnected?: boolean
}>(), {
  bulkBusy: false,
  sessionConnected: true,
})
```

Then in the toolbar (line 45-46), change the two buttons:

```html
        <button class="success-button" type="button" :disabled="bulkBusy || !sessionConnected" @click="emit('startAll')">{{ t('action.startAll') }}</button>
        <button class="secondary-button" type="button" :disabled="bulkBusy" @click="emit('stopAll')">{{ t('action.stopAll') }}</button>
```

Note: `props.rules` remains in use by the `filteredRules`/`visibleRules` computeds, so keep the `const props =` assignment; the template references `bulkBusy` and `sessionConnected` directly (Vue exposes props to the template).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/TunnelGrid.spec.ts`
Expected: all `TunnelGrid` tests pass, including the new gating test.

- [ ] **Step 5: Commit**

```bash
git add src/components/TunnelGrid.vue src/components/TunnelGrid.spec.ts
git commit -m "feat: gate tunnel bulk actions on connection and busy state"
```

---

### Task 4: App.vue connection indicator, busy feedback, and reconnect/disconnect handling

**Files:**
- Modify: `src/i18n/catalog.ts`
- Modify: `src/App.vue`
- Test: `src/App.spec.ts`

**Interfaces:**
- Consumes: `store.connectedSessionIds` (Task 2); `TunnelGrid` props `bulkBusy`/`sessionConnected` (Task 3).
- Produces: new i18n keys `state.connected`, `state.disconnected`, `error.disconnect`; App-level `sessionBusy`, `bulkRulesBusy`, `isConnected`.

- [ ] **Step 1: Add the i18n keys**

In `src/i18n/catalog.ts`, add to the `en` object (e.g. after `state.failed` on line 144):

```ts
  'state.connected': 'Connected',
  'state.disconnected': 'Disconnected',
  'error.disconnect': 'Disconnect failed. Please try again.',
```

And add matching entries to the `zhCN` object (in the same relative position, after `'state.failed': '失败',`):

```ts
  'state.connected': '已连接', 'state.disconnected': '未连接', 'error.disconnect': '断开连接失败，请重试。',
```

- [ ] **Step 2: Run the typecheck to verify the keys are wired**

Run: `npx vue-tsc --noEmit`
Expected: no errors — `TranslationKey` now includes the three new keys and both catalogs satisfy it.

- [ ] **Step 3: Write the failing App tests**

In `src/App.spec.ts`, add these tests inside the `describe('App', ...)` block (before the closing `})`):

```ts
  it('shows the session as disconnected and disables disconnect before connecting', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    })

    const disconnect = wrapper.findAll('button').find((button) => button.text() === '断开连接')!
    expect(disconnect.attributes('disabled')).toBeDefined()
    expect(wrapper.get('.connection').text()).toContain('未连接')
  })

  it('marks the session connected and disables connect after a runtime update', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    })
    const runtimeListener = listen.mock.calls.at(-1)![1]
    runtimeListener({ payload: { rules: [], connectedSessionIds: ['session-a'] } })
    await wrapper.vm.$nextTick()

    const connect = wrapper.findAll('button').find((button) => button.text() === '连接并启动')!
    expect(connect.attributes('disabled')).toBeDefined()
    expect(wrapper.get('.connection').text()).toContain('已连接')
  })

  it('reports a specific error when disconnecting a connected session fails', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, [], { disconnect_session: async () => { throw new Error('disconnect failed') } })
    const runtimeListener = listen.mock.calls.at(-1)![1]
    runtimeListener({ payload: { rules: [], connectedSessionIds: ['session-a'] } })
    await wrapper.vm.$nextTick()

    await wrapper.findAll('button').find((button) => button.text() === '断开连接')!.trigger('click')
    await flushPromises()

    expect(wrapper.get('.statusbar').text()).toContain('断开连接失败，请重试。')
  })

  it('rebuilds the connection when reconnect tunnels is pressed', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    })
    const callsBefore = invoke.mock.calls.length

    await wrapper.findAll('button').find((button) => button.text().includes('重连隧道'))!.trigger('click')
    await flushPromises()

    expect(invoke.mock.calls.slice(callsBefore).map(([command]) => command)).toEqual([
      'disconnect_session',
      'connect_session',
      'start_enabled_rules',
    ])
  })

  it('shows an in-progress label on connect while it is pending', async () => {
    const pendingConnect = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, [], { connect_session: () => pendingConnect.promise })
    await wrapper.findAll('button').find((button) => button.text() === '连接并启动')!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('button').some((button) => button.text().includes('连接并启动中'))).toBe(true)

    pendingConnect.resolve()
    await flushPromises()
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/App.spec.ts`
Expected: the new tests fail — buttons have no `disabled` attribute, no `.connection-state`/`.session-dot` exist, `reconnect` handler and `error.disconnect` do not exist, and connect has no busy label.

- [ ] **Step 5: Implement the App.vue changes**

In `src/App.vue`:

1. Add the three new state declarations after the existing `ruleDeletionBusy` declaration (around line 57):

```ts
const sessionBusy = ref<'connect' | 'disconnect' | 'reconnect' | null>(null)
const bulkRulesBusy = ref(false)
```

2. Add `isConnected` and `bulkOperationsBusy` computed values (after the `errorCount` computed, around line 94):

```ts
const isConnected = computed(() => !!selectedSessionId.value
  && store.connectedSessionIds.includes(selectedSessionId.value))
const bulkOperationsBusy = computed(() => bulkRulesBusy.value || sessionBusy.value !== null)
```

3. Replace the `startAll` and `stopAll` functions (lines 309-310) and the `connect` (line 316) and `disconnect` (line 318) functions with the block below, **keeping `hostTrustRequest` (lines 311-315) and `approveHostTrust` (line 317) exactly as they are** (both are still referenced — `applyConnectFailure` uses `hostTrustRequest`, and `approveHostTrust` still calls `connect`):

```ts
function applyConnectFailure(error: unknown) {
  hostTrust.value = hostTrustRequest(error)
  const value = String(error)
  statusError.value = hostTrust.value ? null : value.includes('HostKeyChanged') ? 'error.hostKeyChanged' : 'error.connect'
}
async function connect() {
  if (!selectedSessionId.value || sessionBusy.value) return
  sessionBusy.value = 'connect'
  try {
    await store.connectSession(selectedSessionId.value)
    await store.startEnabledRules(selectedSessionId.value)
    statusError.value = null
  } catch (error) {
    applyConnectFailure(error)
  } finally {
    sessionBusy.value = null
  }
}
async function disconnect() {
  if (!selectedSessionId.value || sessionBusy.value) return
  sessionBusy.value = 'disconnect'
  try {
    await store.disconnectSession(selectedSessionId.value)
    statusError.value = null
  } catch {
    statusError.value = 'error.disconnect'
  } finally {
    sessionBusy.value = null
  }
}
async function reconnect() {
  if (!selectedSessionId.value || sessionBusy.value) return
  sessionBusy.value = 'reconnect'
  try {
    await store.disconnectSession(selectedSessionId.value)
    await store.connectSession(selectedSessionId.value)
    await store.startEnabledRules(selectedSessionId.value)
    statusError.value = null
  } catch (error) {
    applyConnectFailure(error)
  } finally {
    sessionBusy.value = null
  }
}
async function startAll() {
  if (!selectedSessionId.value || bulkRulesBusy.value) return
  bulkRulesBusy.value = true
  try {
    await store.startEnabledRules(selectedSessionId.value)
    statusError.value = null
  } catch {
    statusError.value = 'error.ruleOperation'
  } finally {
    bulkRulesBusy.value = false
  }
}
async function stopAll() {
  if (!selectedSessionId.value || bulkRulesBusy.value) return
  bulkRulesBusy.value = true
  try {
    await store.stopSessionRules(selectedSessionId.value)
    statusError.value = null
  } catch {
    statusError.value = 'error.ruleOperation'
  } finally {
    bulkRulesBusy.value = false
  }
}
```

Note: `hostTrustRequest` (lines 311-315) remains unchanged and is now used by `applyConnectFailure`.

4. Update the connection line in the template (line 541) to use the session dot and state label:

```html
          <div><p class="section-label">{{ t('title.session') }}</p><h1>{{ selectedSession.name }}</h1><p class="connection"><span class="session-dot" :class="{ connected: isConnected }" />{{ selectedSession.user }}@{{ selectedSession.host || t('message.unconfiguredHost') }}:{{ selectedSession.port }}<span class="connection-state" :class="{ connected: isConnected }">{{ t(isConnected ? 'state.connected' : 'state.disconnected') }}</span></p></div>
```

5. Update the header actions (line 542) to bind disabled and busy labels, and switch reconnect to `reconnect`:

```html
          <div class="header-actions"><button class="success-button" type="button" :disabled="sessionBusy !== null || isConnected" @click="connect">{{ sessionBusy === 'connect' ? t('common.inProgress', { action: t('action.connectAndStart') }) : t('action.connectAndStart') }}</button><button class="danger-button" type="button" :disabled="sessionBusy !== null || !isConnected" @click="disconnect">{{ sessionBusy === 'disconnect' ? t('common.inProgress', { action: t('action.disconnect') }) : t('action.disconnect') }}</button><button class="secondary-button" type="button" :disabled="sessionBusy !== null" @click="reconnect">{{ sessionBusy === 'reconnect' ? t('common.inProgress', { action: t('action.reconnectTunnels') }) : t('action.reconnectTunnels') }}</button><button class="danger-button" type="button" @click="requestRemoveSession">{{ t('action.deleteSession') }}</button></div>
```

6. Pass the new props to `TunnelGrid` (line 544):

```html
        <TunnelGrid :rules="currentRules" :bulk-busy="bulkOperationsBusy" :session-connected="isConnected" @add="addRule" @update="updateRule" @toggle="toggleRule" @remove="requestRemoveRule" @clone="cloneRule" @start-all="startAll" @stop-all="stopAll" />
```

7. Add the connection-dot, connection-state, and disabled-button styles to the global `<style>` block. Add after the `.connected` rule (line 584) or at the end of the rule block:

```css
.session-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.session-dot.connected { background: var(--green); box-shadow: 0 0 7px var(--green); }
.connection-state { margin-left: 8px; color: var(--muted); }
.connection-state.connected { color: var(--green); }
button:disabled { opacity: .55; cursor: not-allowed; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/App.spec.ts src/components/TunnelGrid.spec.ts src/components/ComponentTranslations.spec.ts`
Expected: all pass. `ComponentTranslations.spec.ts` still passes because `TunnelGrid`'s new props are optional with defaults.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/catalog.ts src/App.vue src/App.spec.ts
git commit -m "feat: surface session connection state and button busy feedback"
```

---

### Task 5: Full gate

- [ ] **Step 1: Run the full gate**

Run: `make test`
Expected: vitest suite, `vue-tsc`, `cargo fmt --check`, `clippy -D warnings`, and `cargo test` all pass.

- [ ] **Step 2: Verify the runtime-state flow end to end (manual smoke, optional but recommended)**

Run `make dev`, then:
1. Create a session and one enabled rule, click "连接并启动" — the header dot turns green, shows "已连接", the rule badge turns "运行中" (green), and "连接并启动" becomes disabled while "断开连接" enables.
2. Click "断开连接" — dot turns grey ("未连接"), rule badge returns "已停止".
3. Click "重连隧道" — the session disconnects, reconnects, and enabled rules restart.
4. Stop an SSH server mid-session and wait for the 2s `poll_transports` — the rule badge shows "重连中" (yellow) instead of silently staying grey.

No commit for this task unless a fix is required.

---
