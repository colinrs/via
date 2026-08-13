# Final fix 3 — group confirmation provenance

## Root cause

`ConfirmDialog` reported its generation when mounted but emitted `confirm` without a generation. `App.vue` therefore authorized group deletion using only the globally current and armed generations. A delayed confirmation callback captured from generation A could run after a changed scope mounted and armed generation B, then be mistaken for B's confirmation.

## Change

- Added the optional, defaulted `generation` value to the `ConfirmDialog` confirmation payload while preserving existing rule and session consumers.
- Stored the generation on each pending group-deletion snapshot and passed that exact value to the keyed group dialog.
- Required an emitted confirmation generation to equal both the current pending generation and the armed generation before scope refresh or deletion can occur.
- Kept the existing busy guards and fresh-scope confirmation flow unchanged.

## Regression coverage

- Captures generation A's component confirmation callback, changes the group cascade so generation B remounts and arms, then proves the delayed A callback cannot disconnect sessions or delete the group. B still confirms exactly one deletion.
- Proves missing, string, and `NaN` generation payloads cannot delete; the current valid generation still can.
- Verifies the dialog action emits its configured generation.

The new tests were observed failing before the implementation: the dialog emitted no payload, the delayed A callback deleted after B armed, and a missing generation deleted the group. The focused suite then passed with 64 tests.

## Verification

- `npm test -- src/components/ConfirmDialog.spec.ts src/App.spec.ts` — 64 passed across 2 files
- `npm test` — 105 passed across 14 files
- `npm run typecheck` — passed
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — passed
- `cargo test --manifest-path src-tauri/Cargo.toml` — 44 passed
- `make build` — frontend production build and Rust build passed
- `git diff --check` — passed

`make test` reached green frontend tests and typecheck, then stopped at `cargo fmt --check` because the committed, unchanged `src-tauri/build.rs` is not rustfmt-formatted. `git diff --exit-code HEAD -- src-tauri/build.rs` confirmed this task did not modify that file.
