# Task 2 report: settings commands, permissions, and store contracts

## Implemented

- Added `load_preferences` and `save_preferences` Tauri commands backed by `ConfigRepository`.
- Added `change_master_password` Tauri command backed by `SecretStore`.
- Registered all three commands in the main invoke handler and Tauri command manifest.
- Granted the three narrow command permissions in the main-window capability and included regenerated permission manifests and schemas.
- Added a typed `AppPreferences` store contract with safe defaults, strict exact-shape/value validation, explicit load/save methods, and a password-change bridge method that keeps neither password in reactive state.
- Preference loading remains explicit; `initialize()` does not load preferences.

## Red

After adding the new store-contract tests, `npm test -- src/stores/via.spec.ts` failed as expected because `loadPreferences` and `changeMasterPassword` did not yet exist. The failures were `TypeError: store.loadPreferences is not a function` and `TypeError: store.changeMasterPassword is not a function`.

## Green / verification

- `npm run typecheck` — passed.
- `npm test -- src/stores/via.spec.ts` — passed: 20 tests.
- `cargo check --manifest-path src-tauri/Cargo.toml` — passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` — passed after formatting.
- `git diff --check` — passed.

## Review fix round 1

### Red

The added regressions failed before the fix because `savePreferences` retained the caller object reference and both unit-returning commands accepted `undefined` as success.

### Green

- `validatePreferences` now returns a new canonical plain object before state assignment.
- `save_preferences` and `change_master_password` invoke as `unknown` and accept only JSON `null`; malformed values throw without applying a preference save.
- Regressions cover input mutation after save, invalid save input without IPC, malformed response shapes and values, rejected saves, malformed unit responses, and the guarantee that `initialize()` does not invoke `load_preferences`.
- `npm test -- src/stores/via.spec.ts` — passed: 25 tests.
- `npm run typecheck` — passed.
