# Session management and local credentials design

## Goal

Make group and forwarding-rule deletion reliable, let every SSH session use either password or private-key authentication, and establish a recoverable local credential vault for SSH passwords and private-key passphrases.

## Scope

This change covers the desktop application's Vue UI, Tauri commands, SQLite-backed configuration repository, and encrypted local secret store. SSH host-key trust, tunnel forwarding behavior, and configuration import/export formats remain compatible with the current application.

## Deletion behavior

### Forwarding rules

Clicking a rule's delete control opens the application-owned `ConfirmDialog`, rather than relying on `window.confirm`. The dialog identifies the target as a forwarding rule. Confirming deletes exactly that rule through a dedicated backend command, stops the rule first when it is running, then removes it from the current UI state. A backend failure leaves the rule visible and reports an actionable error.

### Groups

Each group has a delete action in the sidebar. Before deletion, the app counts the group's sessions and all forwarding rules under those sessions. The confirmation copy explicitly states both counts. Confirming stops affected sessions/rules as best effort, invokes a dedicated backend group deletion command, and removes the group, its sessions, and their rules from UI state. The repository deletion uses the existing foreign-key cascade, so no orphaned sessions or rules can remain. The selected session changes to the first remaining session, or to the empty workspace.

## SSH authentication editing

The session editor exposes an authentication-method selector with exactly two choices:

- **Password:** shows a password field for the SSH account password.
- **Private key:** shows a native file picker for the private-key path and a password field for an optional private-key passphrase.

The private-key path remains ordinary local configuration and is included in exports as it is today. SSH passwords and private-key passphrases are never exported. On saving a populated secret, the backend encrypts it in the local secret store and returns an opaque secret ID that is persisted in the session's `AuthConfig`. Switching methods clears the no-longer-used secret reference from the session configuration; the old encrypted record may remain until a future vault-cleanup feature, but it is no longer reachable or exported.

The app must not send a secret back to the renderer after saving it. On subsequent edits, a populated password input means “replace the saved secret”; an empty password input means “keep the existing saved secret.”

## Local credential initialization and recovery

### First-run setup

After loading configuration on startup, the renderer queries whether the secret store has been initialized. If not, it blocks normal workspace interaction with a setup dialog that requires entering and confirming a new local-credential master password. Completion initializes the encrypted vault and immediately displays ten generated recovery codes exactly once. The user must acknowledge that the codes have been stored before accessing the workspace.

### Normal unlock

When an initialized vault is locked, the existing unlock action asks for the master password. A successful unlock enables SSH connections that require saved credentials.

### Recovery

The unlock dialog has a recovery path. The user supplies one recovery code and a new, confirmed local-credential master password. In one database transaction, the backend verifies and consumes the matching recovery-code hash, replaces the vault verifier using the new master password, and creates ten replacement recovery codes. The response includes the replacement codes only once, for immediate display and acknowledgement. The code used for recovery and every prior code become invalid.

Recovery retains access to previously saved SSH passwords and private-key passphrases: the secret-encryption data key is rewrapped from the old master-password-derived key to the new one without decrypting values in the renderer. Recovery does not alter any SSH session configuration or remote credentials.

### Storage and security constraints

- Store only salted hashes of recovery codes, never the codes themselves.
- Generate cryptographically random, human-enterable codes; generate ten per setup or recovery.
- Use a separate random data-encryption key for saved SSH secrets; encrypt that data key with a key derived from the local master password.
- Keep the data-encryption key only in process memory while unlocked and zeroize it when locking.
- Reject blank master passwords, confirmation mismatches, malformed recovery codes, and invalid/previously consumed codes without altering the vault.
- Existing configured vaults retain their current unlock capability. Schema migration adds recovery metadata on first successful unlock if absent, then displays codes once.

## Backend boundaries

`ConfigRepository` owns atomic deletion of groups and rules. `SecretStore` owns vault initialization state, encrypted secret persistence, recovery-code lifecycle, master-password verification, and master-password replacement. Tauri commands expose narrow operations for querying setup state, setting/replacing a session secret, initializing the vault, unlocking, and recovering; the frontend store wraps these commands and maintains only opaque IDs and configuration state.

## Error handling

The UI displays operation-specific errors and preserves visible state on failures. Destructive commands are idempotent from the renderer's perspective: a rule/group missing at confirmation time returns a clear error and triggers a configuration reload. Secret-store errors must never include master passwords, SSH passwords, passphrases, plaintext recovery codes, encryption keys, or encrypted payloads.

## Testing

Rust tests cover repository deletion cascades, rule deletion, first-time vault setup, recovery-code single use and rotation, rejected recovery, changed-master-password unlock, and access to a pre-existing encrypted SSH secret after recovery. Vue tests cover authentication-field switching, secret-save behavior, native confirmation dialogs for rule/group deletion, deletion state updates, first-run setup blocking, recovery validation, and one-time recovery-code display. Existing import/export tests ensure secret IDs and secret values remain absent from exported data.
