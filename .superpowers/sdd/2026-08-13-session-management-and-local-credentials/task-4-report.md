# Task 4 Report: Store Bridge and Credential Dialogs

## Outcome

Implemented the typed Vue store bridge for vault setup, status, unlock, recovery, and atomic session-secret persistence. Added focused setup and recovery-code dialogs and expanded the unlock dialog with recovery mode. Secret inputs remain component-local and are cleared on dialog lifecycle transitions and after submission.

Also added the `deleteGroup` and `deleteRule` bridge wrappers required by Task 5.

## RED evidence

- `npm test -- src/stores/via.spec.ts`
  - 6 expected failures before the store implementation: missing `secretStoreConfigured`, `refreshSecretStoreStatus`, `initializeSecrets`, `recoverSecrets`, and `saveSessionSecret`, plus `unlockSecrets` discarding migration codes.
- After adding the Task 5 bridge-contract tests, the same command produced 8 expected failures; the two additional failures were the absent `deleteGroup` and `deleteRule` wrappers.
- `npm test -- src/components/SecretSetupDialog.spec.ts src/components/SecretUnlockDialog.spec.ts src/components/RecoveryCodesDialog.spec.ts`
  - Setup and recovery-code suites failed because their components did not exist.
  - All five unlock tests failed against the old component because recovery mode, focused action selectors, and secret clearing did not exist.

All failures were caused by the intended missing production behavior, not test syntax or unrelated errors.

## GREEN evidence

- Focused verification:
  - `npm test -- src/stores/via.spec.ts src/components/SecretSetupDialog.spec.ts src/components/SecretUnlockDialog.spec.ts src/components/RecoveryCodesDialog.spec.ts`
  - Result: 4 files passed, 24 tests passed.
- Full frontend verification:
  - `npm test`
  - Result: 14 files passed, 40 tests passed.
  - `npm run typecheck`
  - Result: exit 0.
  - `npm run build`
  - Result: exit 0; Vite production bundle built successfully.
  - `git diff --check`
  - Result: no whitespace errors.

## Files

- Modified `src/stores/via.ts`
- Modified `src/stores/via.spec.ts`
- Created `src/components/SecretSetupDialog.vue`
- Created `src/components/SecretSetupDialog.spec.ts`
- Modified `src/components/SecretUnlockDialog.vue`
- Created `src/components/SecretUnlockDialog.spec.ts`
- Created `src/components/RecoveryCodesDialog.vue`
- Created `src/components/RecoveryCodesDialog.spec.ts`

## Self-review

- `refreshSecretStoreStatus` honors the requested `Promise<string[] | null>` interface, invokes `secret_store_status`, updates `secretStoreConfigured`, and returns `null` because the backend status command has no recovery-code payload.
- `unlockSecrets` returns `string[] | null`, preserving optional legacy-migration recovery codes for Task 7.
- `saveSessionSecret` replaces all local config collections from the backend response so the newly persisted auth secret ID is reflected atomically.
- No password, recovery code, or SSH secret is added to reactive global store state.
- Setup and recovery validation rejects blank or mismatched new passwords.
- Inputs use `current-password`, `new-password`, and `one-time-code` autocomplete hints.
- Setup/unlock secret refs clear on open, close, mode switches, and successful emit.
- Recovery codes are selectable text, disappear from the DOM when closed, and closing requires an explicit acknowledgement that resets after use.

## Concerns / handoff notes

- `initialize()` now treats a failed `secret_store_status` call as initialization failure. This keeps config and vault readiness as one coherent startup contract and matches Task 7's gating requirement.
- `RecoveryCodesDialog` intentionally does not copy codes into local state. Task 7 must clear its owning one-time code array in response to `close`; the component itself renders only the supplied prop.
