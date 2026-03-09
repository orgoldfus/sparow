# Sparow Agent Guide

## Objective
Build the fastest possible path to a responsive desktop database client without hiding behavior behind magic. Phase 1 establishes the shell, contracts, persistence, diagnostics, and verification habits that later phases extend.

## Non-Negotiable Rules
- Update `todo.md` when work starts, when a task completes, when a blocker appears, and after every verification run.
- Keep React focused on typed presentation and state orchestration. Heavy work, persistence, and future database logic stay in Rust.
- Add new frontend/backend boundary payloads in both languages explicitly. Then add JSON fixtures and tests before wiring UI behavior.
- Keep migrations append-only and written as plain SQL.
- Prefer deterministic mocks before real integrations.

## Canonical Commands
- `fnm use`
- `npm run verify`
- `npm run smoke:foundation`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri dev`

## Repo Layout
- `.node-version`: Node runtime target for `fnm`.
- `src/`: React shell, IPC client, diagnostics UI, tests.
- `src-tauri/src/`: Rust commands, state, logging, jobs, and persistence.
- `fixtures/contracts/`: Shared JSON fixtures for boundary payloads.
- `docs/architecture/`: Architecture and module-boundary rules.
- `docs/ai/`: Verification, debugging, and dependency policy notes.

## Common Extension Workflow
1. Add or update a contract in Rust and TypeScript.
2. Add or update the matching JSON fixture.
3. Add runtime validation or deserialization tests on both sides.
4. Implement the backend behavior behind a typed command or event.
5. Wire the frontend through `src/lib/ipc.ts`, not directly from components.
6. Run `npm run verify`.
