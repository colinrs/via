# Repository Guidelines

## Project Structure & Module Organization

Via is a macOS SSH forwarding manager built with Tauri 2. The Vue 3/TypeScript frontend lives in `src/`: components are in `src/components/`, state in `src/stores/via.ts`, DTOs in `src/types/`, and translations in `src/i18n/`. Frontend tests are colocated as `*.spec.ts`.

The Rust backend is under `src-tauri/src/`. Keep IPC handlers in `commands/`, models and errors in `domain/`, persistence in `storage/`, and tunnel behavior in `services/`. Rust integration tests belong in `src-tauri/tests/`. Product constraints are in `prd/`; design and implementation notes are in `docs/superpowers/`.

## Build, Test, and Development Commands

- `make install`: install pinned frontend dependencies with `npm ci`.
- `make dev`: launch the Vite server and Tauri desktop window.
- `make check`: run TypeScript checks plus Rust `check` and Clippy.
- `make lint`: static-check TypeScript (Prettier, typecheck) and Rust (`cargo fmt --check`, Clippy) without running tests.
- `make test`: run Vitest, type checking, `cargo fmt --check`, Clippy with warnings denied, and Rust tests.
- `make build`: build the frontend and Rust binary.
- `make format`: format TypeScript (Prettier) and Rust (`cargo fmt`).
- `npx vitest run src/App.spec.ts`: run one frontend spec.
- `cargo test --manifest-path src-tauri/Cargo.toml <name>`: run selected Rust tests.

Use Node.js 22+, stable Rust, Xcode Command Line Tools, and Tauri CLI 2.

After finishing development, run `make format`, `make lint`, and `make build` before committing.

## Coding Style & Naming Conventions

TypeScript uses strict mode, two-space indentation, single quotes, and extensionless imports. Vue components use PascalCase filenames; functions and variables use camelCase. Let `vue-tsc` enforce frontend types.

Format Rust with `cargo fmt`; use `snake_case` for modules/functions and PascalCase for types. Rust DTOs exposed to TypeScript use `#[serde(rename_all = "camelCase")]`; keep both sides synchronized. New Tauri commands must also be registered in `main.rs`, permissions, and the default capability.

## Testing Guidelines

Use Vitest and Vue Test Utils for UI/store behavior. Name specs `ComponentName.spec.ts` and mock Tauri boundaries through the existing bridge patterns. Add Rust unit or integration coverage for domain, storage, security, and tunnel changes. Run `make test` before submission; no numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

Follow the English Conventional Commit style visible in history: `feat:`, `fix:`, `test:`, or `docs:` plus a concise imperative summary. Keep commits focused. Pull requests should explain behavior and motivation, list verification commands, link relevant issues/specs, and include screenshots for UI changes. Call out database, permission, or security-impacting changes explicitly.

## Security & Configuration

Preserve core invariants: tunnels bind only to `127.0.0.1`; exports and logs never contain credentials or private keys; changed SSH host keys must block connection. Do not commit generated bundles, local databases, secrets, or build artifacts.
