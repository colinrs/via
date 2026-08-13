# Final whole-branch review fix report

Date: 2026-08-14

## Scope

Implemented only the final review findings for destructive deletion safety and backend/frontend configuration divergence. No settings functionality was added.

## Changes

- Replaced the group dialog's count-only snapshot with a stable signature containing the group ID and sorted affected session/rule IDs.
- When the current group signature differs at confirmation time, the app now refreshes the displayed counts, shows `分组内容已变化，请确认新的删除范围。`, and returns before any disconnect or delete backend call. A second confirmation is required for the refreshed scope.
- Added `ViaError::NotFound(&'static str)`. `ConfigRepository::delete_group` and `delete_rule` now inspect the SQLite affected-row count and return clear target-specific errors when no row exists.
- Added `ViaStore.reloadConfig()`, which invokes only `load_config` and atomically replaces groups, sessions, and rules without registering another runtime listener or touching secret-store status.
- Rule/group deletion error paths reload backend configuration before showing the deletion error, tolerate reload and runtime cleanup failures, and reconcile stale pending/selected IDs with the reloaded state.
- Strengthened the group cascade repository test to assert the exact retained rule ID list.

## Strict TDD evidence

RED was observed before implementation:

- Frontend: four focused failures for missing `reloadConfig`, absent rule/group error reload, and the first stale group confirmation deleting immediately.
- Rust: the missing-target tests failed to compile because `ViaError::NotFound` did not yet exist.

GREEN after the minimal implementation:

- `npm test -- --run src/stores/via.spec.ts src/App.spec.ts`: 78 passed.
- `cargo test --test config_repository deleting_a_missing -- --nocapture`: 2 passed.
- `cargo test --test config_repository deleting_a_group_cascades_to_its_sessions_and_rules_only -- --nocapture`: 1 passed.

## Full verification

- `npm test`: 14 files, 104 tests passed.
- `cargo test --all-targets`: 44 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `cargo check --all-targets`: passed.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `rustfmt --edition 2024 --check src/domain/errors.rs src/storage/config_repository.rs tests/config_repository.rs`: passed.
- `git diff --check`: passed.
