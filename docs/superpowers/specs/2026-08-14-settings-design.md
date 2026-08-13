# Settings design

## Goal

Provide a persistent application settings dialog for language, font size, theme, and local credential master-password changes.

## Settings dialog

The title bar gets a Settings entry that opens an application-owned modal dialog. The dialog has three sections:

- **Appearance:** language, font size, and theme controls.
- **Local credentials:** a change-master-password form.
- **About:** a brief explanation that application settings and encrypted local credentials are device-local and excluded from configuration import/export.

Settings changes use explicit select controls and apply immediately after a successful local save. The dialog remains open on a save error and shows an operation-specific message. It must remain usable while no SSH session is selected, after the local credential vault has been initialized and workspace gating has completed.

## Persistent preferences

Store a single preferences record in the existing local SQLite database, separate from `AppConfig` and the encrypted secret-store tables. The record contains:

```text
language: system | zh-CN | en
fontSize: small | medium | large
theme: system | light | dark
```

Defaults are `system`, `medium`, and `system`. Missing records are treated as defaults and created only when the user changes a preference. Invalid stored values are rejected by the backend and the renderer falls back to defaults with an error rather than applying an unknown value. Preferences never appear in exported/imported SSH configuration JSON and do not contain any secret data.

The renderer loads preferences as part of startup, applies them to the document root, and updates them immediately upon each saved change:

- Language selects `navigator.language` when set to `system`; `zh*` resolves to Simplified Chinese and all other system languages resolve to English.
- Font size sets a root CSS scale/token for `small`, `medium`, or `large`.
- Theme uses `prefers-color-scheme` when set to `system`; light/dark values override it. A system-theme media-query change updates the UI live while the selection remains `system`.

## Internationalization

The first release supports Simplified Chinese and English. All user-visible application copy moves to a central typed translation catalog; components use a translation function rather than embedded Chinese or English literals. This includes dialogs, buttons, labels, validation/errors, empty states, status messages, titles, placeholders, aria labels, and confirmation copy. Existing machine-oriented values such as SSH host names, ports, fingerprints, and exported JSON keys remain unchanged.

The language selector itself must be understandable in both languages. There must be no mixed Chinese/English application UI after selecting either explicit language.

## Master-password change

The Local credentials section offers a form with current master password, new master password, and confirmation. Submission requires nonblank matching new passwords and a configured, currently unlocked vault.

The backend verifies the current master password, decrypts the vault data key using its current master-password wrapping, and rewraps that same data key with a wrapping key derived from the new master password. It updates the verifier and wrapped data key in one SQLite transaction. Saved SSH passwords and private-key passphrases remain encrypted with the unchanged data key and therefore remain usable. The recovery-code records are deliberately not changed: each recovery code independently wraps the same data key and remains valid after a normal master-password change.

The operation is fail-safe: wrong current password, blank input, confirmation mismatch, locked vault, or a storage error must leave existing verifier, master-password wrapping, recovery codes, and saved secrets unchanged. On success, the in-memory data key remains unlocked; the user can continue using SSH credentials without re-unlocking. The renderer clears every form field on success, cancel, dialog close, and after a failed request only when the user explicitly closes it. Neither current nor new master password is returned, persisted in renderer state, included in errors, or exported.

## Backend boundaries

`ConfigRepository` owns preferences schema, validation, and load/save operations. `SecretStore` owns `change_master_password(current, new)`, including current-password verification and atomic metadata replacement. Tauri commands expose narrow `load_preferences`, `save_preferences`, and `change_master_password` operations. The frontend store wraps these commands, exposes only validated preference values, and never owns master-password values.

## Error handling and tests

Backend tests cover preference defaults, validation, persistence, and export exclusion; master-password success, wrong-current-password rollback, recovery-code continuity, and continued secret access. Vue tests cover preference loading/application, language catalog use, system-theme updates, preference save failures, settings dialog behavior, password form validation/clearing, command arguments, and errors. Full frontend typecheck/build and Rust test/check/lint remain required.
