# Session Management and Local Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably delete groups and forwarding rules, configure SSH password/private-key authentication, and initialize and recover the encrypted local credential vault.

**Architecture:** Give `ConfigRepository` narrow, atomic deletion operations and give `SecretStore` exclusive ownership of encrypted secret writes, master-password setup, and recovery-code rotation. Expose those operations through Tauri commands; the Vue store keeps only configuration and opaque secret IDs while dialogs collect plaintext only long enough to submit it.

**Tech Stack:** Vue 3 + TypeScript + Vitest, Tauri 2, Rust, SQLite/rusqlite, Argon2, XChaCha20-Poly1305, zeroize, Tauri dialog plugin.

## Global Constraints

- Do not export any SSH password, private-key passphrase, secret ID, recovery-code hash, encrypted payload, or encryption key.
- Generate ten recovery codes per vault setup and per successful recovery; show each set exactly once.
- A recovery code is single-use; successful recovery invalidates the entire previous set.
- Recovery must preserve access to already stored SSH secrets while replacing the master password.
- Group deletion cascades through sessions and forwarding rules and the confirmation copy includes both counts.
- Use application confirmation dialogs, never `window.confirm`.
- Use test-first red/green/refactor cycles; run focused tests before each implementation step.

---

### Task 1: Atomic repository deletion APIs

**Files:**
- Modify: `src-tauri/src/storage/config_repository.rs`
- Modify: `src-tauri/tests/config_repository.rs`

**Interfaces:**
- Produces: `ConfigRepository::delete_group(group_id: Uuid) -> Result<(), ViaError>`
- Produces: `ConfigRepository::delete_rule(rule_id: Uuid) -> Result<(), ViaError>`

- [ ] **Step 1: Write failing repository tests for direct rule deletion and group cascade**

```rust
#[test]
fn deleting_one_rule_keeps_its_session_and_other_rules() {
    let repository = seeded_repository_with_two_rules();
    let (deleted_rule_id, retained_rule_id, session_id) = seeded_ids();

    repository.delete_rule(deleted_rule_id).unwrap();

    let config = repository.load().unwrap();
    assert_eq!(config.sessions.iter().map(|session| session.id).collect::<Vec<_>>(), vec![session_id]);
    assert_eq!(config.rules.iter().map(|rule| rule.id).collect::<Vec<_>>(), vec![retained_rule_id]);
}

#[test]
fn deleting_a_group_cascades_to_its_sessions_and_rules_only() {
    let repository = seeded_repository_with_two_groups();
    let deleted_group_id = seeded_ids().deleted_group_id;

    repository.delete_group(deleted_group_id).unwrap();

    let config = repository.load().unwrap();
    assert_eq!(config.groups.len(), 1);
    assert!(config.sessions.iter().all(|session| session.group_id != deleted_group_id));
    assert!(config.rules.iter().all(|rule| config.sessions.iter().any(|session| session.id == rule.session_id)));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test config_repository deleting_one_rule_keeps_its_session_and_other_rules deleting_a_group_cascades_to_its_sessions_and_rules_only`

Expected: FAIL because `delete_rule` and `delete_group` do not exist.

- [ ] **Step 3: Add the narrow deletion methods**

```rust
pub fn delete_group(&self, group_id: Uuid) -> Result<(), ViaError> {
    self.connection()?.execute(
        "DELETE FROM session_groups WHERE id = ?1",
        [group_id.to_string()],
    ).map_err(database_error)?;
    Ok(())
}

pub fn delete_rule(&self, rule_id: Uuid) -> Result<(), ViaError> {
    self.connection()?.execute(
        "DELETE FROM local_forward_rules WHERE id = ?1",
        [rule_id.to_string()],
    ).map_err(database_error)?;
    Ok(())
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test config_repository`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/storage/config_repository.rs src-tauri/tests/config_repository.rs
git commit -m "feat: add atomic group and rule deletion"
```

### Task 2: Recovery-capable secret-store format

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/storage/secret_store.rs`
- Modify: `src-tauri/src/domain/errors.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/secret_store.rs`

**Interfaces:**
- Produces: `SecretStore::initialize(master_password: &str) -> Result<Vec<String>, ViaError>`
- Produces: `SecretStore::is_configured() -> Result<bool, ViaError>`
- Produces: `SecretStore::recover(recovery_code: &str, new_master_password: &str) -> Result<Vec<String>, ViaError>`
- Produces: `SecretStore::put(value: impl Into<String>) -> Result<Uuid, ViaError>`
- Produces: `ViaError::InvalidRecoveryCode`

- [ ] **Step 1: Write failing secret-store tests for setup codes and recovery**

```rust
#[test]
fn setup_returns_ten_codes_and_each_code_is_not_stored_as_plaintext() {
    let store = SecretStore::new(temp_secret_path());
    let codes = store.initialize("master password").unwrap();

    assert_eq!(codes.len(), 10);
    let database = std::fs::read_to_string(store.path()).unwrap_or_default();
    assert!(codes.iter().all(|code| !database.contains(code)));
}

#[test]
fn recovery_rotates_codes_changes_master_password_and_keeps_secrets_readable() {
    let store = SecretStore::new(temp_secret_path());
    let codes = store.initialize("old master password").unwrap();
    let secret_id = store.put("ssh-password").unwrap();
    store.lock();

    let replacement_codes = store.recover(&codes[0], "new master password").unwrap();

    assert_eq!(replacement_codes.len(), 10);
    store.lock();
    assert!(store.unlock("old master password").is_err());
    store.unlock("new master password").unwrap();
    assert_eq!(store.get(secret_id).unwrap(), "ssh-password");
    assert!(store.recover(&codes[0], "another password").is_err());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test secret_store`

Expected: FAIL because `initialize` and `recover` do not exist.

- [ ] **Step 3: Replace single-key metadata with a wrapped data-key design and hashed recovery codes**

Implement these SQLite records in `SecretStore::connection`:

```sql
CREATE TABLE IF NOT EXISTS secret_store_metadata (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  version INTEGER NOT NULL,
  salt BLOB NOT NULL,
  verifier_nonce BLOB NOT NULL,
  verifier_ciphertext BLOB NOT NULL,
  wrapped_data_key_nonce BLOB NOT NULL,
  wrapped_data_key_ciphertext BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY NOT NULL,
  salt BLOB NOT NULL,
  verifier BLOB NOT NULL,
  wrapped_data_key_nonce BLOB NOT NULL,
  wrapped_data_key_ciphertext BLOB NOT NULL
);
```

Add `subtle = "2"` for constant-time verifier comparison. Derive a wrapping key from the master password and metadata salt; generate a random 32-byte data key, encrypt that data key with the wrapping key, and encrypt every SSH secret with the data key. For each generated recovery code, use Argon2 with a unique random salt to derive 64 bytes: store the first 32 bytes as its verifier and use the other 32 bytes only as an XChaCha20-Poly1305 key that encrypts a separate copy of the data key. `recover` derives both halves from the submitted code, finds the verifier using `subtle::ConstantTimeEq`, unwraps that record's copy of the data key, re-encrypts the data key with the new master-password wrapping key, deletes all old recovery rows, inserts ten newly generated recovery records, and updates memory only after the transaction commits. This makes recovery possible while the vault is locked and the old master password is unavailable. Add a version-1 migration that, on successful legacy unlock, decrypts legacy secrets with the old key, introduces the random data key, re-encrypts the secrets, writes version-2 wrapping metadata, and returns a newly generated recovery-code set exactly once.

- [ ] **Step 4: Add rejection and legacy-migration tests**

```rust
#[test]
fn invalid_recovery_code_does_not_change_the_existing_master_password() {
    let store = SecretStore::new(temp_secret_path());
    store.initialize("old master password").unwrap();

    assert!(store.recover("bad-code", "new master password").is_err());
    store.lock();
    store.unlock("old master password").unwrap();
}

#[test]
fn successful_legacy_unlock_migrates_the_vault_and_generates_recovery_codes() {
    let store = legacy_v1_store_with_secret("legacy password");

    let codes = store.unlock_and_migrate("legacy password").unwrap();

    assert_eq!(codes.unwrap().len(), 10);
}
```

- [ ] **Step 5: Run the complete secret-store suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test secret_store`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/storage/secret_store.rs src-tauri/src/domain/errors.rs src-tauri/src/lib.rs src-tauri/tests/secret_store.rs
git commit -m "feat: add recoverable local credential vault"
```

### Task 3: Tauri commands, permissions, and session-secret persistence

**Files:**
- Modify: `src-tauri/src/commands/config.rs`
- Modify: `src-tauri/src/commands/security.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tests/config_repository.rs`

**Interfaces:**
- Produces: `delete_group(groupId: String) -> Result<(), String>`
- Produces: `delete_rule(ruleId: String) -> Result<(), String>`
- Produces: `secret_store_status() -> Result<SecretStoreStatus, String>` where `SecretStoreStatus { configured: bool }`
- Produces: `initialize_secrets(masterPassword: String) -> Result<Vec<String>, String>`
- Changes: `unlock_secrets(masterPassword: String) -> Result<Option<Vec<String>>, String>` so a successful legacy migration can return its one-time code set.
- Produces: `recover_secrets(recoveryCode: String, newMasterPassword: String) -> Result<Vec<String>, String>`
- Produces: `save_session_secret(sessionId: String, secret: String) -> Result<AppConfig, String>`

- [ ] **Step 1: Write failing command-level tests around replacement of an auth secret ID**

Extract a testable helper from the command that replaces the session's correct `AuthConfig` field and saves the updated configuration:

```rust
#[test]
fn setting_a_password_secret_updates_only_that_sessions_secret_id() {
    let config = config_with_password_and_private_key_sessions();
    let next = replace_auth_secret(config, password_session_id(), Uuid::new_v4()).unwrap();

    assert!(matches!(find_session(&next, password_session_id()).auth, AuthConfig::Password { secret_id: Some(_) }));
    assert!(matches!(find_session(&next, private_key_session_id()).auth, AuthConfig::PrivateKey { .. }));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test config_repository setting_a_password_secret_updates_only_that_sessions_secret_id`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement narrow commands and register them**

Parse UUIDs at command boundaries. `save_session_secret` calls `SecretStore::put`, updates only `Password.secret_id` or `PrivateKey.passphrase_secret_id`, and writes the amended config through `ConfigRepository::save`. Add command handlers to `generate_handler!` and add matching `allow-*` permissions. Keep plaintext secret values out of all responses and errors.

- [ ] **Step 4: Run backend tests and compile the Tauri command surface**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/config.rs src-tauri/src/commands/security.rs src-tauri/src/main.rs src-tauri/capabilities/default.json src-tauri/tests/config_repository.rs
git commit -m "feat: expose deletion and credential vault commands"
```

### Task 4: Store bridge and dialog components

**Files:**
- Create: `src/components/SecretSetupDialog.vue`
- Modify: `src/components/SecretUnlockDialog.vue`
- Create: `src/components/RecoveryCodesDialog.vue`
- Modify: `src/stores/via.ts`
- Modify: `src/stores/via.spec.ts`
- Create: `src/components/SecretSetupDialog.spec.ts`
- Create: `src/components/SecretUnlockDialog.spec.ts`
- Create: `src/components/RecoveryCodesDialog.spec.ts`

**Interfaces:**
- Produces: `ViaStore.secretStoreConfigured: boolean | null`
- Produces: `ViaStore.refreshSecretStoreStatus(): Promise<string[] | null>`
- Produces: `ViaStore.initializeSecrets(masterPassword: string): Promise<string[]>`
- Produces: `ViaStore.recoverSecrets(recoveryCode: string, newMasterPassword: string): Promise<string[]>`
- Produces: `ViaStore.saveSessionSecret(sessionId: string, secret: string): Promise<void>`
- Produces: `SecretSetupDialog` events `setup: [password: string]`, `close: []`
- Produces: `SecretUnlockDialog` events `unlock: [password: string]`, `recover: [code: string, password: string]`, `close: []`

- [ ] **Step 1: Write failing store tests for the new bridge operations**

```ts
it('records that initial setup is required after config loading', async () => {
  const invoke = vi.fn().mockImplementation((command) => command === 'load_config'
    ? { schemaVersion: 1, groups: [], sessions: [], rules: [] }
    : command === 'secret_store_status' ? { configured: false } : undefined)
  const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

  await store.initialize()

  expect(store.secretStoreConfigured).toBe(false)
})

it('sends a recovery code and replacement master password without retaining either', async () => {
  const store = createViaStore(fakeBridgeReturning(['A1-B2']))
  await expect(store.recoverSecrets('old-code', 'new password')).resolves.toEqual(['A1-B2'])
  expect(fakeInvoke).toHaveBeenCalledWith('recover_secrets', { recoveryCode: 'old-code', newMasterPassword: 'new password' })
})
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run: `npm test -- src/stores/via.spec.ts`

Expected: FAIL because the state and methods do not exist.

- [ ] **Step 3: Implement store methods and focused dialogs**

`SecretSetupDialog` requires nonblank matching password fields. `SecretUnlockDialog` toggles between master-password and recovery forms; the recovery form requires a code plus matching new password fields. `RecoveryCodesDialog` renders codes in selectable text, warns that they are shown once, and only emits close after acknowledgement. Do not put secret values in reactive global state.

- [ ] **Step 4: Write and run component tests**

```ts
it('does not emit setup until matching nonblank passwords are supplied', async () => {
  const wrapper = mount(SecretSetupDialog, { props: { open: true } })
  await wrapper.get('[aria-label="主密码"]').setValue('one')
  await wrapper.get('[aria-label="确认主密码"]').setValue('two')
  expect(wrapper.get('[data-testid="setup-secrets-action"]').attributes('disabled')).toBeDefined()
})

it('emits recovery input only from recovery mode', async () => {
  const wrapper = mount(SecretUnlockDialog, { props: { open: true } })
  await wrapper.get('[data-testid="show-recovery"]').trigger('click')
  await wrapper.get('[aria-label="恢复码"]').setValue('code')
  await wrapper.get('[aria-label="新主密码"]').setValue('new password')
  await wrapper.get('[aria-label="确认新主密码"]').setValue('new password')
  await wrapper.get('[data-testid="recover-secrets-action"]').trigger('click')
  expect(wrapper.emitted('recover')).toEqual([['code', 'new password']])
})
```

Run: `npm test -- src/stores/via.spec.ts src/components/SecretSetupDialog.spec.ts src/components/SecretUnlockDialog.spec.ts src/components/RecoveryCodesDialog.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/via.ts src/stores/via.spec.ts src/components/SecretSetupDialog.vue src/components/SecretSetupDialog.spec.ts src/components/SecretUnlockDialog.vue src/components/SecretUnlockDialog.spec.ts src/components/RecoveryCodesDialog.vue src/components/RecoveryCodesDialog.spec.ts
git commit -m "feat: add credential setup and recovery dialogs"
```

### Task 5: Group and rule deletion UI

**Files:**
- Modify: `src/components/SessionSidebar.vue`
- Modify: `src/components/SessionSidebar.spec.ts`
- Modify: `src/components/TunnelGrid.spec.ts`
- Modify: `src/App.vue`
- Modify: `src/App.spec.ts`

**Interfaces:**
- Produces: `SessionSidebar` event `deleteGroup: [id: string]`
- Uses: `ViaStore.deleteGroup(groupId: string): Promise<void>` and `ViaStore.deleteRule(ruleId: string): Promise<void>`
- Uses: `ConfirmDialog` for pending rule or group deletion.

- [ ] **Step 1: Write failing component and app tests**

```ts
it('emits the group id from its delete control without toggling the group', async () => {
  const wrapper = mount(SessionSidebar, { props: { groups, selectedSessionId: '' } })
  await wrapper.get('[data-testid="delete-group-group-a"]').trigger('click')
  expect(wrapper.emitted('deleteGroup')).toEqual([['group-a']])
  expect(wrapper.get('[data-testid="group-toggle-group-a"]').attributes('aria-expanded')).toBe('true')
})

it('opens an application confirmation dialog before deleting a forwarding rule', async () => {
  const wrapper = await mountAppWithRule()
  await wrapper.get('[title="删除规则"]').trigger('click')
  expect(wrapper.get('[role="dialog"]').text()).toContain('删除转发规则')
  expect(invoke).not.toHaveBeenCalledWith('delete_rule', expect.anything())
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/SessionSidebar.spec.ts src/components/TunnelGrid.spec.ts src/App.spec.ts`

Expected: FAIL because group delete controls and application-owned rule confirmation are absent.

- [ ] **Step 3: Add delete controls and pending-delete state to the application**

Extend `SessionSidebar` with an accessible delete button that uses `@click.stop`. In `App.vue`, replace `window.confirm` with `pendingRuleId` state and `ConfirmDialog`. Add `pendingGroupId`, derive session/rule counts before opening its dialog, stop affected tunnels best effort, invoke the corresponding narrow store operation, and update only the affected reactive arrays after success. If any backend deletion fails, retain UI state and show a specific error.

- [ ] **Step 4: Run the focused UI suite**

Run: `npm test -- src/components/SessionSidebar.spec.ts src/components/TunnelGrid.spec.ts src/App.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionSidebar.vue src/components/SessionSidebar.spec.ts src/components/TunnelGrid.spec.ts src/App.vue src/App.spec.ts
git commit -m "feat: confirm and persist group and rule deletion"
```

### Task 6: SSH authentication editor and secret submission

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/App.vue`
- Modify: `src/App.spec.ts`

**Interfaces:**
- Uses: `open` from `@tauri-apps/plugin-dialog` to select one private-key file.
- Uses: `ViaStore.saveSessionSecret(sessionId, secret)`.
- Persists: `AuthConfig` with `{ kind: 'password', secretId }` or `{ kind: 'private_key', path, passphraseSecretId }`.

- [ ] **Step 1: Install the dialog plugin and write failing authentication-editor tests**

```ts
it('shows SSH password input when password authentication is selected', async () => {
  const wrapper = await mountAppWithSession({ auth: { kind: 'password', secretId: null } })
  expect(wrapper.get('[aria-label="SSH 密码"]')).toBeTruthy()
  expect(wrapper.find('[aria-label="私钥文件"]').exists()).toBe(false)
})

it('opens the private-key picker and persists an optional passphrase as a secret', async () => {
  open.mockResolvedValue('/Users/me/.ssh/id_ed25519')
  const wrapper = await mountAppWithSession({ auth: { kind: 'private_key', path: '', passphraseSecretId: null } })
  await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
  await wrapper.get('[aria-label="私钥口令"]').setValue('key passphrase')
  await wrapper.get('[data-testid="save-authentication"]').trigger('click')
  expect(invoke).toHaveBeenCalledWith('save_session_secret', { sessionId: 'session-1', secret: 'key passphrase' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/App.spec.ts`

Expected: FAIL because no auth controls or plugin integration exists.

- [ ] **Step 3: Wire native key selection and safe auth saving**

Add `tauri-plugin-dialog` and `@tauri-apps/plugin-dialog`, register `tauri_plugin_dialog::init()`, and add its dialog permission. In `App.vue`, maintain local, component-scoped password/passphrase draft refs. Changing auth kind constructs the proper auth shape and clears the other secret ID before saving configuration. A nonempty password/passphrase is submitted through `saveSessionSecret` after the configuration with the selected method/path is saved; empty input never overwrites an existing secret. Clear draft refs after success and never populate them from saved secrets.

- [ ] **Step 4: Run all frontend checks**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/src/main.rs src-tauri/capabilities/default.json src/App.vue src/App.spec.ts
git commit -m "feat: configure SSH password and private key authentication"
```

### Task 7: App-level vault lifecycle integration and final verification

**Files:**
- Modify: `src/App.vue`
- Modify: `src/App.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Uses: `ViaStore.secretStoreConfigured`, `initializeSecrets`, `unlockSecrets`, and `recoverSecrets`.
- Uses: `SecretSetupDialog`, `SecretUnlockDialog`, and `RecoveryCodesDialog`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('blocks workspace use with setup until an unconfigured vault has a master password', async () => {
  const wrapper = await mountAppWithSecretStatus({ configured: false })
  expect(wrapper.get('[aria-label="初始化本地凭据"]').isVisible()).toBe(true)
  expect(wrapper.find('[data-testid="session-sidebar"]').exists()).toBe(false)
})

it('shows replacement recovery codes only after a successful recovery', async () => {
  const wrapper = await mountAppWithSecretStatus({ configured: true })
  await openRecoveryAndSubmit(wrapper, 'one-time-code', 'new master password')
  expect(wrapper.get('[aria-label="保存恢复码"]').text()).toContain('A1-B2')
})
```

- [ ] **Step 2: Run the lifecycle tests to verify they fail**

Run: `npm test -- src/App.spec.ts`

Expected: FAIL because the app does not gate initialization or render recovery codes.

- [ ] **Step 3: Integrate setup, unlock, migration, recovery, and acknowledgement flow**

After store initialization, fetch vault status. Render setup as the only initial modal when `configured === false`; on successful setup, display returned codes and only reveal the workspace after acknowledgement. Display the optional one-time code set returned by a successful legacy-vault unlock in the same acknowledgement flow. Route normal unlock and recovery outcomes through the existing status error handling, retaining dialogs on failure. Add a short README section explaining that recovery codes are generated once, rotate after use, and never recover remote SSH credentials themselves; they restore access to the locally encrypted copies.

- [ ] **Step 4: Run all tests and production checks**

Run: `npm test && npm run typecheck && npm run build && cargo test --manifest-path src-tauri/Cargo.toml && cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS with no type errors or test failures.

- [ ] **Step 5: Inspect the final diff and commit**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only Task 7 files staged.

```bash
git add src/App.vue src/App.spec.ts README.md
git commit -m "feat: require and recover local credential vault"
```
