# Session feedback refinements design

## Goal

Refine the SSH session page feedback introduced in the previous design: disabled action buttons must explain why they are disabled, the "Stop all" bulk action is hidden when it has nothing to do, the import dialog offers a fill-in example JSON, and four deferred cleanups from the prior work are applied.

## Disabled-button tooltips

Every action button that can be disabled gets a native hover tooltip explaining why. Because disabled form controls do not reliably fire hover events, each button is wrapped in a `<span class="button-wrap" :title="hint">` (`.button-wrap { display: inline-flex; }`) so the tooltip renders on the wrapper. The `title` is empty when the button is enabled.

Hint mapping (title non-empty only while disabled):

- **Connect and start**: `isConnected` → "Session already connected" / "会话已连接"; a session operation in flight → "Operation in progress" / "操作进行中，请稍候".
- **Disconnect**: `!isConnected` → "Session not connected" / "会话未连接"; operation in flight → in-progress hint.
- **Reconnect tunnels**: operation in flight → in-progress hint.
- **Start all**: `!sessionConnected` → "Connect the SSH session first" / "先连接 SSH 会话"; `bulkBusy` → in-progress hint.
- **Stop all**: `bulkBusy` → in-progress hint.

New translation keys (both `en` and `zh-CN`): `hint.operationInProgress`, `hint.sessionConnected`, `hint.sessionNotConnected`, `hint.connectSessionFirst`.

## Stop-all visibility

The "Stop all" toolbar button renders only when the selected session has at least one rule in a non-`stopped` runtime state (`active`, `starting`, `reconnecting`, `conflict`, or `failed`) — `v-if="rules.some((rule) => rule.runtimeState !== 'stopped')"`. This keeps it available while a rule is reconnecting or starting, so a user can still manually stop it, and hides it only when there is nothing to stop.

## Import example

The import dialog gains a "Fill example" button (import mode only, left-aligned in the footer) that fills the textarea with a demo configuration. The demo is a valid, credentials-stripped config matching the export format (a real import is possible); `auth` uses the `kind`-tagged shape (`{ "kind": "password" }`), ids are valid UUIDs, and the `schemaVersion` is `1`. New translation key `action.fillExample`.

```json
{
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
}
```

## Deferred cleanups

1. **Deterministic session ordering.** `TunnelManager::snapshot()` sorts `connected_session_ids` before returning it (`Uuid` implements `Ord`).
2. **Strict `connectedSessionIds` validation.** `parseRuntimeSnapshot` rejects a `connectedSessionIds` entry that is not a string (symmetry with the rule-entry rejection), instead of silently filtering it out.
3. **Hoist `String(error)`.** `applyConnectFailure` computes `const value = String(error)` once and passes it to `hostTrustRequest` (whose parameter type becomes `string`); the `error.disconnect` translation key is moved out of the `state.*` block into the `error.*` block of the catalog.
4. **Missing App-level coverage.** Add App tests for (a) the bulk start-all button being disabled while a bulk operation is in flight, and (b) the reconnect button showing its in-progress label while reconnect is pending.

## Error handling and tests

Vue tests cover: the correct tooltip `title` per disabled state and an empty title when enabled; stop-all visibility across rule runtime states; the fill-example button populating the textarea and appearing only in import mode. Rust tests cover the sorted `connected_session_ids` order. Store tests cover the non-string `connectedSessionIds` rejection. Full frontend typecheck/build and Rust test/check/lint remain required.
