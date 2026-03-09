# Sparow

A fast, clean desktop database client built for developers who are tired of slow, bloated tools.

Sparow replaces heavyweight clients like DBeaver and DataGrip with something that starts instantly, stays responsive, and gets out of your way.

## Why

Most database clients carry years of accumulated features, legacy UI decisions, and heavy architectures. The result: slow startup, sluggish tables, cluttered interfaces.

Sparow is the opposite — a developer tool that prioritizes **speed**, **clarity**, and **keyboard-first workflows**.

## Current Status

**Early development — PostgreSQL only.**

| Phase | Status |
|-------|--------|
| Foundation (shell, contracts, persistence, diagnostics) | ✅ Done |
| Connection management (save, test, connect, keychain) | ✅ Done |
| Schema browser (tree, metadata cache, search, refresh) | ✅ Done |
| Query editor & results viewer | 🔜 Next |

## Tech Stack

- **Desktop shell** — [Tauri v2](https://v2.tauri.app) (small binary, native performance)
- **Backend** — Rust (async query execution, connection pooling, schema introspection, credential handling)
- **Frontend** — React 19, TypeScript, Vite, Tailwind CSS v4
- **Local storage** — SQLite (query history, cached metadata, saved connections)
- **Credentials** — OS keychain via `keyring` crate (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **Testing** — Vitest + Testing Library (frontend), `cargo test` (backend), JSON contract fixtures (boundary)

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js 24+](https://nodejs.org/) — managed via [fnm](https://github.com/Schniz/fnm)
- Platform dependencies for Tauri — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Setup

```sh
fnm use              # switch to the project's Node version
npm install          # install frontend dependencies
```

### Run

```sh
npm run tauri dev    # start the app in development mode
```

### Verify

```sh
npm run verify       # typecheck → lint → test → smoke → cargo test
```

### Other Commands

```sh
npm run test              # frontend tests (Vitest)
npm run lint              # ESLint
npm run typecheck         # TypeScript type checking
npm run smoke:foundation  # foundation smoke test
npm run smoke:postgres    # PostgreSQL smoke (requires env vars — see below)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
```

#### PostgreSQL Smoke Test

The PostgreSQL smoke test requires these environment variables:

```sh
SPAROW_PG_HOST=...
SPAROW_PG_DATABASE=...
SPAROW_PG_USERNAME=...
SPAROW_PG_PASSWORD=...
# Optional:
SPAROW_PG_PORT=5432
SPAROW_PG_SSL_MODE=prefer
```

## Project Structure

```
src/                  React frontend (shell, features, IPC client, tests)
src-tauri/src/        Rust backend (commands, services, persistence, schema)
fixtures/contracts/   Shared JSON fixtures for IPC boundary payloads
scripts/              Dev tooling (verify, smoke tests, cache inspection)
docs/                 Architecture docs, MVP plans, AI/agent guides
```

### Architecture at a Glance

Sparow uses a **typed IPC boundary** between frontend and backend. Every payload that crosses the boundary has:

1. A Rust struct with `Serialize`/`Deserialize`
2. A TypeScript type with a runtime guard
3. A shared JSON fixture in `fixtures/contracts/`

The frontend never calls Tauri's `invoke` directly from components — all IPC goes through `src/lib/ipc.ts`, which validates responses against typed contracts.

Heavy work (database queries, schema introspection, credential storage) happens in Rust. React handles presentation and state orchestration only.

## License

TBD
