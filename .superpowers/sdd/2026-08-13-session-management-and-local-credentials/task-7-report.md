# Task 7 report: app-level vault lifecycle integration

## Scope

- Integrated first-run secret-store setup, one-time recovery-code acknowledgement, normal/legacy unlock, and recovery into `App.vue`.
- Added app lifecycle and reentrancy coverage in `App.spec.ts`.
- Documented master passwords and recovery-code behavior in Chinese and English in `README.md`.
- Did not implement or modify the separate general settings feature.

## RED

Command:

```text
npm test -- src/App.spec.ts
```

Observed before production changes:

```text
Test Files  1 failed (1)
Tests       7 failed | 41 passed (48)
```

The failures were the intended missing behaviors: no first-run setup dialog/gate, workspace visible during startup, no recovery-code presentation after setup or legacy unlock, duplicate unlock invocation, no recovery command route, and no recovery-specific failure reporting.

Independent review later identified a pending-recovery interaction concern. A candidate regression test failed because the child dialog can process synthetic clicks on descendants of a disabled fieldset; the authorized App-level implementation now disables the whole application fieldset during secret operations, while App handlers independently reject duplicate synthetic emits.

## GREEN

Focused command after implementation:

```text
npm test -- src/App.spec.ts
```

Observed:

```text
Test Files  1 passed (1)
Tests       48 passed (48)
```

Final required command:

```text
npm test && npm run typecheck && npm run build && cargo test --manifest-path src-tauri/Cargo.toml && cargo check --manifest-path src-tauri/Cargo.toml
```

Observed:

```text
Vitest: 14 files passed, 87 tests passed
vue-tsc --noEmit: exit 0
Vite: 51 modules transformed, build completed
Rust: config_repository 17 passed; forwarder 2 passed; host_trust 1 passed; models 2 passed; secret_store 14 passed; tunnel_manager 6 passed; doc tests passed
cargo check: exit 0
```

`git diff --check` also exited successfully with no output.

## Self-review

- Workspace/sidebar and the header unlock action render only when backend initialization is ready, the store is not unconfigured, and no recovery-code acknowledgement is pending.
- Setup success relies on the store contract to set `secretStoreConfigured = true`, then keeps codes only in an App-local ref until the acknowledged close clears them.
- Legacy unlock codes use the same gate; normal unlock closes without opening the code dialog.
- Recovery failure keeps the recovery dialog open and reports a fixed recovery-specific message; success closes it beneath the replacement-code dialog.
- Initialization, unlock, and recovery share an App-level in-flight guard, so synthetic duplicate emits cannot invoke backend commands twice.
- Fixed status messages do not interpolate backend errors, master passwords, or recovery inputs.
- Recovery-code acknowledgement tests use the real checkbox and close button rather than directly emitting the child close event.
- The listener-failure fixture reaches listener registration rather than failing earlier at secret-store status.

## Concerns

- Recovery codes necessarily live in a local reactive `ref` while displayed. They are never written to the shared store or status error and are cleared immediately after acknowledgement, as required.

## Review round 1/5

### RED

Focused review command:

```text
npm test -- src/stores/via.spec.ts src/components/RecoveryCodesDialog.spec.ts src/components/SecretUnlockDialog.spec.ts src/App.spec.ts
```

Initial review regressions produced the expected failures:

```text
Test Files  4 failed (4)
Tests       11 failed | 67 passed (78)
```

They demonstrated malformed status reaching ready state, malformed/short code sets being accepted, generic close clearing pending codes, missing App unlock-mode context, and missing unload protection. A second focused RED for a synthetic mode change during an in-flight recovery failed 1/1 because it allowed a later unlock command.

### GREEN

After the fixes:

```text
npm test -- src/stores/via.spec.ts src/components/RecoveryCodesDialog.spec.ts src/components/SecretUnlockDialog.spec.ts src/App.spec.ts
Test Files  4 passed (4)
Tests       80 passed (80)

npm run typecheck
exit 0
```

### Review fixes and self-review

- `secret_store_status` now accepts only an object containing a boolean `configured`; malformed data fails initialization, and workspace access requires the exact value `true`.
- Store command results now require exactly 10 unique, nonblank strings for setup/recovery and legacy unlock; unlock accepts `null` as its only non-code success result.
- Recovery-code UI emits an explicit `acknowledge(true)` only from its checked action. App owns acknowledgement state, ignores generic close, and clears its local codes only after that explicit signal.
- App validates setup/unlock/recovery against the active modal and App-owned unlock mode, rejects all secret events while codes are pending, and ignores context/mode changes while a secret operation is in flight.
- The pending-code screen includes a persistent close warning. App registers a `beforeunload` handler that requests confirmation only while codes are pending and removes it on unmount.

### Close lifecycle decision

The implementation uses the browser/Tauri webview `beforeunload` path because it is deterministic in the current Vue surface and does not require adding a Tauri window plugin/API. It cannot promise that every OS-level forced termination will be interceptable, so the UI and README conservatively instruct users not to close the app until the one-time codes are saved and acknowledged. Codes remain non-dismissible in-app without that acknowledgement.

### Final round verification

```text
npm test
14 files passed, 98 tests passed

npm run typecheck
exit 0

npm run build
51 modules transformed; exit 0

cargo test --manifest-path src-tauri/Cargo.toml
config_repository 17, forwarder 2, host_trust 1, models 2, secret_store 14, tunnel_manager 6; all passed

cargo check --manifest-path src-tauri/Cargo.toml
exit 0
```

## Review round 2/5

### RED

```text
npm test -- src/App.spec.ts -t "non-boolean acknowledgement|may be generating|warns during recovery"
Test Files  1 failed (1)
Tests       3 failed | 56 skipped (59)
```

The failures proved that a synthetic string acknowledgement cleared pending codes, and `beforeunload` did not warn while deferred setup or recovery/unlock commands could be generating or rotating one-time codes.

### GREEN

```text
npm test -- src/App.spec.ts -t "non-boolean acknowledgement|may be generating|warns during recovery"
3 passed | 56 skipped

npm test -- src/App.spec.ts
59 passed

npm run typecheck
exit 0
```

### Review fixes and self-review

- App treats the acknowledgement event as untrusted runtime input and clears pending codes only when `acknowledged === true`.
- `credentialOperationMayProduceCodes` is set immediately before setup, unlock, and recovery commands and is cleared in `finally` only after their result or failure state is stored.
- The unload guard warns while that flag is set or while codes remain pending. Deferred setup and recovery/legacy-unlock tests cover the race; a normal unlock returning `null` clears the warning once complete.
- Ordinary authentication/configuration and private-key operations do not set the code-generation flag.

### Final round verification

```text
npm test
14 files passed, 101 tests passed

npm run typecheck
exit 0

npm run build
51 modules transformed; exit 0

cargo test --manifest-path src-tauri/Cargo.toml
all suites passed

cargo check --manifest-path src-tauri/Cargo.toml
exit 0
```
