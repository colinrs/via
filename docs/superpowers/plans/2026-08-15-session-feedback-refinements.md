# Session Feedback Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add disabled-button tooltips, hide the "Stop all" action when nothing is running, add an import fill-example button, and apply four deferred cleanups to the session feedback work.

**Architecture:** Wrapper `<span class="button-wrap" :title="hint">` elements provide native tooltips on disabled buttons. `TunnelGrid` hides "Stop all" unless a rule has a non-`stopped` runtime state. `ImportDialog` gains a demo-JSON fill button. The Rust `snapshot()` sorts `connected_session_ids`; the store validator rejects non-string `connectedSessionIds`; `applyConnectFailure` hoists `String(error)`.

**Tech Stack:** Rust (Tauri 2, serde, uuid) backend; Vue 3 + TypeScript + Vitest + Vue Test Utils frontend.

## Global Constraints

- Rust structs use `#[serde(rename_all = "camelCase")]`, enum tags `snake_case`; frontend DTO field names match exactly.
- i18n: `en` and `zh-CN` catalogs stay in sync; `TranslationKey = keyof typeof en` type-checks that every `en` key has a `zh-CN` entry.
- Store validators reject malformed bridge payloads rather than silently corrupting state.
- Tunnels bind only to `127.0.0.1`; no secrets may leak into logs, errors, UI, or exported config.
- Commit messages use conventional-commit prefixes (`feat:`, `fix:`, `test:`, `style:`, `docs:`) in English.
- Full gate is `make test` (vitest + `vue-tsc` + `cargo fmt --check` + `clippy -D warnings` + `cargo test`). NOTE: two pre-existing blockers in `src-tauri/src/storage/secret_store.rs` (a `clippy::type_complexity` error and a parallel `cargo test` deadlock) are out of scope for this plan — run `cargo test -- --test-threads=1` for the Rust portion.

---

### Task 1: Deterministic session ordering in the snapshot

**Files:**
- Modify: `src-tauri/src/services/tunnel_manager.rs`
- Test: `src-tauri/tests/tunnel_manager.rs`

**Interfaces:**
- Consumes: existing `RuntimeSnapshot`, `TunnelManager` (unchanged signatures).
- Produces: `TunnelManager::snapshot()` returns `connected_session_ids` in ascending `Uuid` order.

- [ ] **Step 1: Write the failing test**

In `src-tauri/tests/tunnel_manager.rs`, add next to the other `snapshot_*` tests (before the `fn rule(...)` helper):

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test tunnel_manager`
Expected: FAIL — `snapshot.connected_session_ids` order is non-deterministic (HashMap iteration), so the `assert_eq!` does not hold reliably.

- [ ] **Step 3: Sort the ids in `snapshot()`**

In `src-tauri/src/services/tunnel_manager.rs`, replace the `snapshot` method body:

```rust
    pub async fn snapshot(&self) -> RuntimeSnapshot {
        let mut connected_session_ids: Vec<uuid::Uuid> =
            self.sessions.lock().await.keys().copied().collect();
        connected_session_ids.sort();
        RuntimeSnapshot {
            rules: self.states.lock().await.values().cloned().collect(),
            connected_session_ids,
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test tunnel_manager`
Expected: PASS — all 10 tests (9 existing + the new ordering test).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/tunnel_manager.rs src-tauri/tests/tunnel_manager.rs
git commit -m "fix: sort connected session ids in runtime snapshot"
```

---

### Task 2: Strict `connectedSessionIds` validation

**Files:**
- Modify: `src/stores/via.ts`
- Test: `src/stores/via.spec.ts`

**Interfaces:**
- Consumes: `isTunnelState` from `../types/via` (already imported).
- Produces: `parseRuntimeSnapshot` rejects a non-string `connectedSessionIds` entry.

- [ ] **Step 1: Write the failing test**

In `src/stores/via.spec.ts`, inside the `it('ignores malformed runtime snapshots without mutating state', ...)` test, add this entry to the `invalidPayloads` array (after the existing `{ rules: [], connectedSessionIds: 'not-an-array' }` entry):

```ts
      { rules: [], connectedSessionIds: [123] },
      { rules: [], connectedSessionIds: ['session-a', null] },
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/via.spec.ts`
Expected: FAIL — the two new payloads are currently accepted (the `.filter` drops non-strings instead of rejecting), so `store.rules[0].runtimeState`/`store.connectedSessionIds` assertions fail on the loop iteration.

- [ ] **Step 3: Reject non-string entries**

In `src/stores/via.ts`, inside `parseRuntimeSnapshot`, replace these two lines:

```ts
  const connected = record.connectedSessionIds
  if (connected !== undefined && !Array.isArray(connected)) return null
  const connectedSessionIds = (connected ?? []).filter((id): id is string => typeof id === 'string')
  return { rules, connectedSessionIds }
```

with:

```ts
  const connected = record.connectedSessionIds
  if (connected !== undefined && (!Array.isArray(connected) || connected.some((id) => typeof id !== 'string'))) return null
  const connectedSessionIds = (connected ?? []) as string[]
  return { rules, connectedSessionIds }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/via.spec.ts`
Expected: PASS — all 28 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/via.ts src/stores/via.spec.ts
git commit -m "fix: reject malformed connected session ids in runtime snapshot"
```

---

### Task 3: i18n keys and catalog cleanup

**Files:**
- Modify: `src/i18n/catalog.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: new keys `hint.operationInProgress`, `hint.sessionConnected`, `hint.sessionNotConnected`, `hint.connectSessionFirst`, `action.fillExample` in both `en` and `zh-CN`; `error.disconnect` relocated to the `error.*` block.

- [ ] **Step 1: Add the keys and relocate `error.disconnect`**

Read the current `src/i18n/catalog.ts` first (it already contains `state.connected`, `state.disconnected`, and `error.disconnect` from the prior work). Make these edits to the `en` object:

1. After `'state.disconnected': 'Disconnected',`, add:

```ts
  'hint.operationInProgress': 'Operation in progress',
  'hint.sessionConnected': 'Session already connected',
  'hint.sessionNotConnected': 'Session not connected',
  'hint.connectSessionFirst': 'Connect the SSH session first',
```

2. After `'action.iSaved': 'I saved it',`, add:

```ts
  'action.fillExample': 'Fill example',
```

3. Remove `'error.disconnect': 'Disconnect failed. Please try again.',` from its current position (right after `state.disconnected`), and re-add it immediately after `'error.deleteSession': 'Could not delete the session. Please try again.',`.

Make the matching edits to the `zhCN` object (the `zhCN` object is formatted as one long line per block; keep the existing formatting style):

1. Add (near the `state.*` keys): `'hint.operationInProgress': '操作进行中，请稍候', 'hint.sessionConnected': '会话已连接', 'hint.sessionNotConnected': '会话未连接', 'hint.connectSessionFirst': '先连接 SSH 会话',`
2. Add (near the `action.*` keys): `'action.fillExample': '填入示例',`
3. Move `'error.disconnect': '断开连接失败，请重试。',` from its current spot (next to `state.disconnected`) to the `error.*` block (next to `'error.deleteSession': '删除会话失败，请重试。',`).

- [ ] **Step 2: Verify the catalogs type-check**

Run: `npx vue-tsc --noEmit`
Expected: exit 0 — `TranslationKey` now includes the five new keys, and both catalogs satisfy it (a missing `zh-CN` entry would fail typecheck).

- [ ] **Step 3: Commit**

```bash
git add src/i18n/catalog.ts
git commit -m "feat: add hint and fill-example translation keys"
```

---

### Task 4: App.vue tooltips, `String(error)` hoist, and busy tests

**Files:**
- Modify: `src/App.vue`
- Test: `src/App.spec.ts`

**Interfaces:**
- Consumes: `store.connectedSessionIds`; i18n keys from Task 3 (`hint.*`).
- Produces: header-button tooltips via wrapper spans; `hostTrustRequest(value: string)` (changed parameter type); new `connectHint`/`disconnectHint`/`reconnectHint` computeds.

- [ ] **Step 1: Write the failing tests**

In `src/App.spec.ts`, inside the `describe('App', ...)` block, add these five tests before the closing `})`:

```ts
  it('shows a not-connected hint on the disabled disconnect button', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    })
    const disconnect = wrapper.findAll('button').find((button) => button.text() === '断开连接')!
    expect(disconnect.element.parentElement?.getAttribute('title')).toBe('会话未连接')
  })

  it('shows a connected hint on the disabled connect button', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    })
    const runtimeListener = listen.mock.calls.at(-1)![1]
    runtimeListener({ payload: { rules: [], connectedSessionIds: ['session-a'] } })
    await wrapper.vm.$nextTick()

    const connect = wrapper.findAll('button').find((button) => button.text() === '连接并启动')!
    expect(connect.element.parentElement?.getAttribute('title')).toBe('会话已连接')
  })

  it('shows an in-progress hint on the disabled reconnect button', async () => {
    const pendingConnect = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, [], { connect_session: () => pendingConnect.promise })
    await wrapper.findAll('button').find((button) => button.text() === '连接并启动')!.trigger('click')
    await wrapper.vm.$nextTick()

    const reconnect = wrapper.findAll('button').find((button) => button.text().includes('重连隧道'))!
    expect(reconnect.element.parentElement?.getAttribute('title')).toBe('操作进行中，请稍候')
    pendingConnect.resolve()
    await flushPromises()
  })

  it('disables bulk actions while start-all is in flight', async () => {
    const pendingStart = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, [], { start_enabled_rules: () => pendingStart.promise })
    const runtimeListener = listen.mock.calls.at(-1)![1]
    runtimeListener({ payload: { rules: [], connectedSessionIds: ['session-a'] } })
    await wrapper.vm.$nextTick()

    await wrapper.findAll('button').find((button) => button.text().includes('启动所有'))!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('button').find((button) => button.text().includes('启动所有'))!.attributes('disabled')).toBeDefined()

    pendingStart.resolve()
    await flushPromises()
  })

  it('shows an in-progress label on reconnect while pending', async () => {
    const pendingDisconnect = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, [], { disconnect_session: () => pendingDisconnect.promise })

    await wrapper.findAll('button').find((button) => button.text().includes('重连隧道'))!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('button').some((button) => button.text().includes('重连隧道中'))).toBe(true)

    pendingDisconnect.resolve()
    await flushPromises()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/App.spec.ts`
Expected: FAIL — the tooltip tests find no `title` on the buttons' parent (no wrapper span yet), and the two busy tests already pass against the current implementation (they are coverage-only additions; if they pass now, that is expected — they guard against regression).

- [ ] **Step 3: Implement the App.vue changes**

In `src/App.vue`:

1. Change `hostTrustRequest` to accept a string (remove the internal `String(error)`):

```ts
function hostTrustRequest(value: string) {
  const match = /HostTrustRequired \{ host: "([^"]+)", port: (\d+), algorithm: "([^"]+)", fingerprint: "([^"]+)" \}/.exec(value)
  return match ? { host: match[1], port: Number(match[2]), algorithm: match[3], fingerprint: match[4] } : null
}
```

2. Change `applyConnectFailure` to compute `String(error)` once:

```ts
function applyConnectFailure(error: unknown) {
  const value = String(error)
  hostTrust.value = hostTrustRequest(value)
  statusError.value = hostTrust.value ? null : value.includes('HostKeyChanged') ? 'error.hostKeyChanged' : 'error.connect'
}
```

3. Add the three hint computeds (after the `bulkOperationsBusy` computed):

```ts
const connectHint = computed(() => isConnected.value
  ? t('hint.sessionConnected')
  : sessionBusy.value ? t('hint.operationInProgress') : '')
const disconnectHint = computed(() => !isConnected.value
  ? t('hint.sessionNotConnected')
  : sessionBusy.value ? t('hint.operationInProgress') : '')
const reconnectHint = computed(() => sessionBusy.value ? t('hint.operationInProgress') : '')
```

4. Wrap the three header action buttons in titled spans. Replace the `header-actions` block so the connect/disconnect/reconnect buttons are each inside `<span class="button-wrap" :title="...">`, while the delete-session button stays unwrapped:

```html
          <div class="header-actions"><span class="button-wrap" :title="connectHint"><button class="success-button" type="button" :disabled="sessionBusy !== null || isConnected" @click="connect">{{ sessionBusy === 'connect' ? t('common.inProgress', { action: t('action.connectAndStart') }) : t('action.connectAndStart') }}</button></span><span class="button-wrap" :title="disconnectHint"><button class="danger-button" type="button" :disabled="sessionBusy !== null || !isConnected" @click="disconnect">{{ sessionBusy === 'disconnect' ? t('common.inProgress', { action: t('action.disconnect') }) : t('action.disconnect') }}</button></span><span class="button-wrap" :title="reconnectHint"><button class="secondary-button" type="button" :disabled="sessionBusy !== null" @click="reconnect">{{ sessionBusy === 'reconnect' ? t('common.inProgress', { action: t('action.reconnectTunnels') }) : t('action.reconnectTunnels') }}</button></span><button class="danger-button" type="button" @click="requestRemoveSession">{{ t('action.deleteSession') }}</button></div>
```

5. Add the `.button-wrap` rule to the global `<style>` block (next to the other button rules):

```css
.button-wrap { display: inline-flex; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/App.spec.ts`
Expected: PASS — all App tests (existing + five new) pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.vue src/App.spec.ts
git commit -m "feat: add disabled-button tooltips and hoist connect error string"
```

---

### Task 5: TunnelGrid tooltips and stop-all visibility

**Files:**
- Modify: `src/components/TunnelGrid.vue`
- Test: `src/components/TunnelGrid.spec.ts`

**Interfaces:**
- Consumes: `hint.*` i18n keys from Task 3; the global `.button-wrap` style from Task 4.
- Produces: `startAllHint`/`stopAllHint` computeds; "Stop all" hidden when every rule is `stopped`.

- [ ] **Step 1: Write the failing tests**

In `src/components/TunnelGrid.spec.ts`, first update the existing `it('disables start-all when disconnected and both bulk buttons while busy', ...)` test so it uses a non-`stopped` rule (otherwise "Stop all" is hidden and `toolbarButtons[2]` is undefined):

```ts
  it('disables start-all when disconnected and both bulk buttons while busy', () => {
    const activeRules = [{ ...rules[0], runtimeState: 'active' as const }]
    const disconnected = mount(TunnelGrid, {
      ...withChineseI18n(),
      props: { rules: activeRules, sessionConnected: false },
    })
    const toolbarButtons = disconnected.findAll('.toolbar-actions button')
    expect(toolbarButtons[1].attributes('disabled')).toBeDefined()
    expect(toolbarButtons[2].attributes('disabled')).toBeUndefined()

    const busy = mount(TunnelGrid, {
      ...withChineseI18n(),
      props: { rules: activeRules, sessionConnected: true, bulkBusy: true },
    })
    const busyButtons = busy.findAll('.toolbar-actions button')
    expect(busyButtons[1].attributes('disabled')).toBeDefined()
    expect(busyButtons[2].attributes('disabled')).toBeDefined()
  })
```

Then add these three tests after it:

```ts
  it('hides stop-all when every rule is stopped', () => {
    const wrapper = mount(TunnelGrid, { ...withChineseI18n(), props: { rules: [rules[0]] } })
    expect(wrapper.findAll('button').some((button) => button.text().includes('全部关闭'))).toBe(false)
  })

  it('shows stop-all when any rule is not stopped', () => {
    const activeRules = [{ ...rules[0], runtimeState: 'active' as const }]
    const wrapper = mount(TunnelGrid, { ...withChineseI18n(), props: { rules: activeRules } })
    expect(wrapper.findAll('button').some((button) => button.text().includes('全部关闭'))).toBe(true)
  })

  it('shows a connect-first hint on start-all when disconnected', () => {
    const wrapper = mount(TunnelGrid, { ...withChineseI18n(), props: { rules: [rules[0]], sessionConnected: false } })
    const startAll = wrapper.findAll('button').find((button) => button.text().includes('启动所有'))!
    expect(startAll.element.parentElement?.getAttribute('title')).toBe('先连接 SSH 会话')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/TunnelGrid.spec.ts`
Expected: FAIL — the stop-all visibility and tooltip tests fail (no `v-if`/`title` yet).

- [ ] **Step 3: Implement the TunnelGrid changes**

In `src/components/TunnelGrid.vue`:

1. Add the two hint computeds (after the existing `onScroll` const):

```ts
const startAllHint = computed(() => !props.sessionConnected ? t('hint.connectSessionFirst') : props.bulkBusy ? t('hint.operationInProgress') : '')
const stopAllHint = computed(() => props.bulkBusy ? t('hint.operationInProgress') : '')
```

2. Replace the two toolbar bulk buttons with titled, wrapped buttons and hide "Stop all" when nothing is running:

```html
        <span class="button-wrap" :title="startAllHint"><button class="success-button" type="button" :disabled="bulkBusy || !sessionConnected" @click="emit('startAll')">{{ t('action.startAll') }}</button></span>
        <span v-if="rules.some((rule) => rule.runtimeState !== 'stopped')" class="button-wrap" :title="stopAllHint"><button class="secondary-button" type="button" :disabled="bulkBusy" @click="emit('stopAll')">{{ t('action.stopAll') }}</button></span>
```

3. Add a scoped `.button-wrap` rule to the `<style scoped>` block (so the span is inline-flex when `TunnelGrid` is mounted standalone in tests):

```css
.button-wrap { display: inline-flex; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/TunnelGrid.spec.ts src/components/ComponentTranslations.spec.ts`
Expected: PASS — `TunnelGrid` tests pass (updated + three new), and `ComponentTranslations.spec.ts` still passes (it mounts `TunnelGrid` with only `rules`, so the new optional props default and no assertion touches the stop-all button).

- [ ] **Step 5: Commit**

```bash
git add src/components/TunnelGrid.vue src/components/TunnelGrid.spec.ts
git commit -m "feat: gate stop-all visibility and add bulk-action tooltips"
```

---

### Task 6: Import fill-example button

**Files:**
- Modify: `src/components/ImportDialog.vue`
- Test: `src/components/ImportDialog.spec.ts`

**Interfaces:**
- Consumes: `action.fillExample` i18n key from Task 3.
- Produces: a demo-JSON constant and a `fillExample()` handler that sets the textarea.

- [ ] **Step 1: Write the failing tests**

In `src/components/ImportDialog.spec.ts`, add:

```ts
it('fills the textarea with a demo config in import mode', async () => {
  const wrapper = mount(ImportDialog, { ...withChineseI18n(), props: { mode: 'import', open: true } })
  await wrapper.get('button.fill-example').trigger('click')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toContain('"schemaVersion": 1')
})

it('does not show the fill-example button in export mode', () => {
  const wrapper = mount(ImportDialog, { ...withChineseI18n(), props: { mode: 'export', open: true } })
  expect(wrapper.find('button.fill-example').exists()).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ImportDialog.spec.ts`
Expected: FAIL — `button.fill-example` does not exist yet.

- [ ] **Step 3: Implement the ImportDialog changes**

In `src/components/ImportDialog.vue`:

1. Add the demo JSON constant and `fillExample` handler inside `<script setup>` (after `const { t } = injectI18n()`):

```ts
const DEMO_JSON = `{
  "schemaVersion": 1,
  "groups": [
    { "id": "00000000-0000-4000-8000-000000000001", "name": "Demo group" }
  ],
  "sessions": [
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "groupId": "00000000-0000-4000-8000-000000000001",
      "name": "Demo SSH session",
      "host": "ssh.example.com",
      "port": 22,
      "user": "root",
      "auth": { "kind": "password" }
    }
  ],
  "rules": [
    {
      "id": "00000000-0000-4000-8000-000000000003",
      "sessionId": "00000000-0000-4000-8000-000000000002",
      "enabled": true,
      "localPort": 5432,
      "targetHost": "localhost",
      "targetPort": 5432,
      "note": "Demo rule"
    }
  ]
}`
function fillExample() { json.value = DEMO_JSON }
```

2. Add the fill-example button as the first element in the `<footer>` (import mode only):

```html
<footer><button v-if="mode==='import'" class="fill-example" @click="fillExample">{{ t('action.fillExample') }}</button><button @click="emit('close')">{{ t('common.cancel') }}</button><button v-if="mode==='import'" :disabled="!json.trim()" @click="emit('confirm',json,false)">{{ t('action.mergeImport') }}</button><button v-if="mode==='import'" class="danger" :disabled="!json.trim()" @click="emit('confirm',json,true)">{{ t('action.replaceAll') }}</button><button v-else class="primary" @click="emit('confirm',json,false)">{{ t('action.copyJson') }}</button></footer>
```

3. Add the left-alignment rule to the `<style scoped>` block:

```css
.dialog .fill-example{margin-right:auto}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ImportDialog.spec.ts`
Expected: PASS — all three ImportDialog tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ImportDialog.vue src/components/ImportDialog.spec.ts
git commit -m "feat: add import fill-example button"
```

---

### Task 7: Full gate

- [ ] **Step 1: Run the frontend suite and typecheck**

Run: `npm run test` then `npm run typecheck`
Expected: vitest all pass; `vue-tsc` exit 0.

- [ ] **Step 2: Run the Rust gates**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --check` then `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1`
Expected: fmt clean; all Rust tests pass (serialized — the bare `cargo test` deadlock and `clippy::type_complexity` error in `secret_store.rs` are pre-existing and out of scope).

- [ ] **Step 3: Manual smoke (optional)**

Run `make dev`, then: verify the "Stop all" button disappears when the selected session's rules are all stopped; verify hovering a disabled "Start all" (no connected session) shows "先连接 SSH 会话"; verify "填入示例" populates the import textarea.

No commit for this task unless a fix is required.
