# Via

> A macOS desktop SSH local port-forwarding manager for centrally managing, recording, and running SSH local port-forwarding tunnels.

## Why Via

At work I rely on SSH remote forwarding to reach internal services through a bastion host. I used to start all these tunnels with bash scripts, but I couldn't find a tool that let me centrally manage and keep track of them. So I built Via — a desktop app for unified SSH local forwarding and management.

## How It Works

Via does one thing well: forward a local port to a remote internal address through an authenticated SSH session.

```
local client ──► 127.0.0.1:local_port ──► SSH session (bastion) ──► target_host:target_port
```

1. Via binds a TCP listener on `127.0.0.1:<local_port>`.
2. For each accepted local connection it opens a `direct-tcpip` channel over the authenticated SSH session.
3. The SSH server connects to `target_host:target_port` on the remote network.
4. Via copies bytes bidirectionally between the local connection and the SSH channel, so a local port transparently reaches a service only accessible from the SSH server.

Every tunnel binds only to `127.0.0.1` and is never exposed to the LAN.

## Scope

- SSH Local Forwarding only: `127.0.0.1:local_port → SSH session → target_host:target_port`.
- Password, private-key, and encrypted private-key passphrase authentication.
- Credentials are stored locally only; encrypted when a master password is set, never persisted otherwise.
- JSON import/export carries only groups, non-sensitive session fields, and forward rules — never passwords, key passphrases, private keys, or the master password.
- Port-conflict isolation, single/bulk start-stop, and automatic reconnect.

V1 does not provide remote forwarding, dynamic/SOCKS5, a terminal, SFTP, cloud sync, or cross-platform support.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop | Tauri 2 + Rust |
| Frontend | Vue 3, TypeScript, Vite |
| SSH | russh (password / private-key auth) |
| Encryption | Argon2 + XChaCha20-Poly1305 AEAD |
| Storage | SQLite (single `via.db` database) |
| Runtime | Rust manages config, encryption, SSH, listeners, state, and reconnect |

## Requirements

- macOS 13+
- Node.js 22+
- Rust stable (Rust 2024 edition)
- Xcode Command Line Tools: `xcode-select --install`
- Tauri CLI: `cargo install tauri-cli --version "^2"`

## Quick Start

```bash
make install
make dev
```

`make dev` launches the Vite dev server and the Tauri desktop window. The first Rust build may need to download and compile dependencies.

## Commands

```bash
make help       # list all commands
make install    # install pinned frontend deps
make dev        # start the desktop dev environment
make format     # format TypeScript (Prettier) and Rust (cargo fmt)
make build      # build frontend + Rust binary
make test       # full test gate
make check      # fast static checks
make package    # build + ad-hoc-sign the macOS .app
make clean      # remove build artifacts
make clean-all  # also remove installed JS deps
```

`make package` builds and ad-hoc-signs the `.app` locally so it can be verified and run in development. Re-sign with an Apple Developer ID and notarize before distributing; this command uploads or publishes nothing.

## Project Structure

```text
src/                          Vue frontend
src/types/via.ts              shared DTOs
src-tauri/src/domain/         domain models
src-tauri/src/storage/        storage & encryption
src-tauri/tests/              Rust integration tests
```

## Security

- Tunnels bind only to `127.0.0.1`, never to the LAN.
- Exported configs never contain credentials.
- Passwords and key passphrases are written only as encrypted BLOBs in the local SQLite DB.
- Logs must never record passwords, key passphrases, or private keys.
- First-time SSH connections require host-key fingerprint approval; changed fingerprints block the connection.

### Master password and recovery codes

Via requires a master password to protect locally stored SSH credentials. Ten recovery codes are generated once and shown once; an unused code can reset the master password. Recovery only restores access to the local encrypted credential copy — it cannot recover credentials from remote SSH servers.

## Development

Run before committing:

```bash
make test
make format
make build
```
