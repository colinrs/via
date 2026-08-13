# Final fix 2 — stale group deletion confirmation

## Change

- Added a generation-bound `ready` event to `ConfirmDialog`.
- The group deletion dialog is keyed by its confirmation generation. A group confirmation is armed only after the newly keyed dialog mounts and reports itself ready.
- A changed deletion scope clears the armed generation before generating the refreshed confirmation. Synchronous queued confirmation events before the re-render are ignored.

## Regression coverage

`src/App.spec.ts` now emits two confirmations back-to-back after a stale scope is detected. It asserts that neither performs `delete_group`, then emits a confirmation from the newly rendered dialog and asserts exactly one deletion.

## Verification

- `npm test -- src/App.spec.ts` — 61 passed
- `npm test` — 104 passed across 14 files
- `npm run typecheck` — passed
- `npm run build` — passed
- `cargo test --manifest-path src-tauri/Cargo.toml` — 44 passed
- `git diff --check` — passed
