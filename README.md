# Sparow

A fast, clean desktop database client built for developers who are tired of slow, bloated tools.

Sparow replaces heavyweight clients like DBeaver and DataGrip with something that starts instantly, stays responsive, and gets out of your way.

## Why

Most database clients carry years of accumulated features, legacy UI decisions, and heavy architectures. The result: slow startup, sluggish tables, cluttered interfaces.

Sparow is the opposite — a developer tool that prioritizes **speed**, **clarity**, and **keyboard-first workflows**.

## Current Status

**Early development, PostgreSQL-first, through Phase 4.**

Implemented today:

- Foundation shell, typed IPC contracts, persistence, diagnostics
- Saved connection management with test/connect/disconnect flows
- Schema browser with local cache, search, and background refresh
- Monaco-based SQL workspace with multi-tab editing
- Single-statement execution and cancellation against the active session
- Schema-cache-backed SQL autocomplete
- Capped result previews and query-history persistence

Still intentionally deferred:

- Streaming result sets
- Virtualized large-result browsing
- CSV export
- Saved queries, query-history UI, command palette, and keyboard productivity layer

## Tech Stack

- **Desktop shell** — [Tauri v2](https://v2.tauri.app) (small binary, native performance)
- **Backend** — Rust (async query execution, connection/session management, schema introspection, credential handling)
- **Frontend** — React 19, TypeScript, Vite, Tailwind CSS v4
- **Editor** — Monaco Editor
- **Local storage** — SQLite (saved connections, schema cache, query history)
- **Credentials** — OS keychain via `keyring` crate (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **Testing** — Vitest + Testing Library (frontend), `cargo test` (backend), JSON contract fixtures (boundary)

## Product Constraints

- PostgreSQL is the only supported database engine in the current MVP.
- Phase 4 keeps one active backend session at a time.
- Each SQL tab stores a target connection id, but Run is enabled only when that tab matches the active saved connection.
- Query execution is single-statement only.
- Result rendering is intentionally limited to command summaries and capped previews until Phase 5.

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
node ./scripts/inspect-schema-cache.mjs --db <sqlite-path> --connection <connection-id> [--scope <scope-path>]
node ./scripts/inspect-query-history.mjs --db <sqlite-path> [--connection <connection-id>] [--limit <n>]
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

`npm run smoke:postgres` currently runs ignored Rust smoke tests for:

- PostgreSQL connection lifecycle
- Schema refresh against a live database
- Query execution
- Query cancellation

## Project Structure

```text
src/                  React frontend (shell, query workspace, schema browser, connection UI)
src-tauri/src/        Rust backend (commands, query service, connections, persistence, schema)
fixtures/contracts/   Shared JSON fixtures for IPC boundary payloads
scripts/              Dev tooling (verify, smoke tests, SQLite inspection helpers)
docs/                 Architecture docs, MVP plans, AI/agent guides
```

### Architecture at a Glance

Sparow uses a **typed IPC boundary** between frontend and backend. Every payload that crosses the boundary has:

1. A Rust struct with `Serialize`/`Deserialize`
2. A TypeScript type with a runtime guard
3. A shared JSON fixture in `fixtures/contracts/`

The frontend never calls Tauri's `invoke` directly from components — all IPC goes through `src/lib/ipc.ts`, which validates responses against typed contracts.

Heavy work (database queries, schema introspection, query cancellation, credential storage, history persistence) happens in Rust. React handles presentation, local tab state, and event-driven state orchestration only.

## Query Execution Model

Phase 4 introduces a typed query lifecycle:

1. React resolves the execution slice from Monaco.
2. React calls `start_query_execution` through `src/lib/ipc.ts`.
3. Rust validates the request, records query history, and returns an accepted job handle.
4. Rust emits `query://execution-progress` events for queued, running, completed, cancelled, or failed states.
5. React updates only the owning tab and renders the latest result preview in the bottom panel.

This keeps the UI responsive while preserving explicit, debuggable state transitions.

## Debugging And Docs

- Architecture note: [docs/architecture/phase-4-query-workspace.md](docs/architecture/phase-4-query-workspace.md)
- AI debugging guide: [docs/ai/debugging-playbook.md](docs/ai/debugging-playbook.md)
- Verification guide: [docs/ai/verification.md](docs/ai/verification.md)
- Current implementation log: [todo.md](todo.md)

## License

TBD
