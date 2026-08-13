# Task 6 Report: SSH authentication editor and secret submission

## Outcome

Implemented the SSH authentication editor with exactly two modes: password and private key. Passwords and optional private-key passphrases remain local drafts until explicitly saved through the existing atomic `save_session_secret` command. Private-key paths are selected with the Tauri 2 native dialog plugin and persisted as normal configuration.

## TDD evidence

All production behavior was driven by a failing App test first.

### Cycle 1: authentication controls and native key selection

- RED command: `npm test -- src/App.spec.ts`
- RED result: 2 failures, 17 passes.
- Expected failures:
  - password mode had no `[aria-label="SSH 密码"]` input;
  - private-key mode had no `[data-testid="choose-private-key"]` action.
- GREEN command: `npm test -- src/App.spec.ts`
- GREEN result: 19 tests passed.

### Cycle 2: selector, credential invalidation, and draft lifecycle

- RED command: `npm test -- src/App.spec.ts`
- RED result: 3 failures, 24 passes.
- Expected failures:
  - no exact password/private-key selector;
  - kind switching could not construct and persist a fresh auth shape;
  - session selection did not clear the local secret draft.
- GREEN command: `npm test -- src/App.spec.ts`
- GREEN result: 27 tests passed.

### Cycle 3: blank-draft success and config-save failure feedback

- RED command: `npm test -- src/App.spec.ts`
- RED result: 2 failures, 27 passes.
- Expected failures:
  - whitespace-only draft remained after a successful config-only save;
  - authentication config failure exposed the generic persistence error instead of a specific retry error.
- GREEN command: `npm test -- src/App.spec.ts`
- GREEN result: 29 tests passed.

### Cycle 4: asynchronous operation origin and save locking

- Independent review identified that reactive selection/draft state was read after awaits.
- RED command: `npm test -- src/App.spec.ts`
- First RED result: 2 failures, 30 passes.
  - a session B draft was submitted with session A's ID while A's config save was pending;
  - a picker opened for session A updated session B after selection changed.
- Snapshotting the initiating session/auth/secret fixed those cases and exposed the remaining mode-change window.
- Final RED result: 1 failure, 32 passes because the auth selector remained enabled while secret submission was pending.
- GREEN command: `npm test -- src/App.spec.ts`
- A final deferred-secret + generic host-edit test failed because ordinary `@change="persist"` events could race the returned secret snapshot. The first guard attempt also failed RED because Vue passes an `Event` as the method's first argument; requiring a literal `true` for the authentication-internal write closed that bypass.
- GREEN result: 34 tests passed.

The final App suite covers the two rendered modes, exact selector choices, one-file picker arguments, null/non-string picker results, path persistence ordering, verbatim secret submission, blank secret suppression, existing ID preservation, kind-switch ID clearing, session/kind draft clearing, success clearing, failure retention, specific failure status, generic field persistence, and deferred config/secret/dialog race cases.

## Implementation notes

- Added `@tauri-apps/plugin-dialog` and `tauri-plugin-dialog`, initialized the Rust plugin, and granted only `dialog:allow-open` to the main window.
- Authentication kind changes synchronously replace the discriminated auth object with a fresh password or private-key shape before saving. Both drafts are cleared, so old IDs and draft values cannot reappear when switching back.
- Password/passphrase inputs use `type="password"` and `autocomplete="new-password"`. Drafts are component-local, never hydrated from saved secret references, and cleared whenever the selected session changes.
- Authentication save persists config first. It calls `saveSessionSecret` only when `draft.trim()` is nonempty, but submits the original untrimmed value. A blank draft never invokes the secret command or overwrites an existing ID.
- Save captures its initiating session ID, auth kind, and exact secret before awaiting. An operation guard spans both config and secret writes, disables the application's persisted-edit controls, rejects ordinary persistence calls during the operation, and avoids clearing a newer/session-specific draft.
- Secret-save success consumes the atomically returned config through the existing store method and clears the draft. Config/secret failures retain nonblank drafts for retry and publish distinct status errors.
- The native picker is called as `open({ multiple: false, directory: false })`; only string results mutate the path. Cancellation and unexpected non-string results are ignored.

## Files changed

- `package.json`
- `package-lock.json`
- `src/App.vue`
- `src/App.spec.ts`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/src/main.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/gen/schemas/acl-manifests.json`
- `src-tauri/gen/schemas/capabilities.json`
- `src-tauri/gen/schemas/desktop-schema.json`
- `src-tauri/gen/schemas/macOS-schema.json`

The Tauri generated schemas/manifests changed as a direct result of adding the dialog plugin and permission and are included with the generated lockfiles.

## Verification

- `npm test && npm run typecheck && npm run build`
  - 14 test files passed;
  - 73 tests passed;
  - Vue typecheck exited 0;
  - Vite production build completed successfully (45 modules transformed).
- `cargo test --all-targets`
  - exited 0;
  - native plugin compiled;
  - 42 Rust integration tests passed across configuration, forwarding, host trust, models, secret storage, and tunnel management.
- `git diff --check`
  - exited 0 with no whitespace errors.

## Security and UX self-review

- Secret material is not copied into configuration, rendered from existing secrets, logged, or trimmed before encryption submission.
- Blank input cannot erase an existing secret reference.
- Changing authentication mode explicitly clears the previous mode's reference and both transient drafts.
- Private-key selection exposes only a narrow open-file capability; directory selection and multiple selection are disabled.
- Readonly path display prevents accidental manual drift from the native selection result.
- Save failures retain retryable secret text while giving a specific status message; successful saves remove it from the input.
- All persisted-edit controls are disabled while the two-step authentication save is in flight, and the persistence handler independently rejects non-authentication writes. This prevents the returned atomic snapshot from racing a newer auth shape, rule, import, or generic session edit.
- Existing host/name/port/user change persistence remains covered and functional.

## Concerns / limitations

- The native dialog was verified through its JavaScript boundary and by compiling/testing the registered Rust plugin and generated permission manifests. This environment did not perform an interactive packaged-app picker smoke test.
- The application briefly locks persisted interactions during authentication submission. This favors credential/config consistency over concurrent editing for the duration of the two local IPC calls.
- An ancillary repository-wide `cargo fmt --check` is blocked by pre-existing formatting in untouched `src-tauri/build.rs`; the Task 6 Rust edit is already rustfmt-compatible. Required Rust tests and native compilation pass.

## Formal review fix: picker/save serialization and dialog failure

### RED/GREEN evidence

- RED command: `npm test -- src/App.spec.ts`
- RED result: 3 failures, 34 passes, plus 1 expected unhandled rejection.
- Expected failures:
  - authentication saving remained enabled while the native picker was pending;
  - a repeated click started a second picker operation;
  - a rejected native picker promise was unhandled and showed no picker-specific status.
- GREEN command: `npm test -- src/App.spec.ts`
- First GREEN result: 37 tests passed.
- A mutation check then identified that a failed picker `save_config` left the unpersisted path visible.
- Second RED command: `npm test -- src/App.spec.ts`
- Second RED result: 1 failure, 37 passes; the path remained `/new/key` instead of returning to `/old/key` after persistence failure.
- Final GREEN command: `npm test -- src/App.spec.ts`
- Intermediate GREEN result: 38 tests passed.
- Independent fix review then identified that ordinary config writes could still race picker persistence in either direction.
- Third RED command: `npm test -- src/App.spec.ts`
- Third RED result: 2 failures, 38 passes:
  - persisted controls remained enabled and a generic config write could start while the picker was pending;
  - a picker could start while an earlier generic `save_config` remained pending.
- Final GREEN command: `npm test -- src/App.spec.ts`
- Intermediate GREEN result: 40 tests passed.
- Re-review identified that the initial config-write lock discarded later ordinary saves instead of preserving settings durability.
- Fourth RED command: `npm test -- src/App.spec.ts`
- Fourth RED result: 1 failure, 40 passes; after two ordinary edits during a deferred first save, only one `save_config` reached the backend.
- Final GREEN command: `npm test -- src/App.spec.ts`
- Final GREEN result: 41 tests passed.

### Fix notes

- Added an `authenticationPicking` lock that starts before opening the native dialog and remains active through private-key path persistence. Authentication kind changes, repeated picker clicks, and authentication saving are ignored while this lock is active, and the corresponding controls are disabled.
- Each picker captures its originating session and auth object plus an operation generation. Session selection changes invalidate the generation, preventing a stale result from mutating a session even if the user switches away and back before the dialog resolves.
- Native picker rejection is caught, the existing path remains unchanged, and the status bar shows `选择私钥文件失败，请重试。`.
- If selected-path persistence fails, only the still-current originating auth object is rolled back to its previous path, so the UI never advertises an unpersisted selection.
- Config writes now use a shared FIFO queue. Authentication operations cannot begin until queued config writes drain, ordinary persistence cannot begin during picker/authentication operations, and persisted controls are disabled for the full picker/path-save window. Ordinary edits made while an earlier config write is pending are serialized and send their latest state rather than being dropped.
- Existing immediate picker-success tests now wait for picker persistence before exercising the subsequent save action, matching the disabled UI and preserving their config-before-secret ordering coverage.

### Post-fix verification

- `npm test && npm run typecheck && npm run build`
  - 14 test files passed;
  - 80 tests passed;
  - Vue typecheck exited 0;
  - Vite production build completed successfully (45 modules transformed).
- `cargo test --all-targets && cargo check`
  - exited 0;
  - 42 Rust integration tests passed;
  - native development check completed successfully.
