# Phase 2 Todo

## Objective
Build the Phase 2 PostgreSQL connection management layer for Sparow: secure saved connections, typed connection contracts, a single active PostgreSQL session in Rust, a native-feeling connection workspace, and AI-friendly verification that does not require a live database by default.

## Checklist
- [completed] Fix Phase 2 regressions in password persistence and TLS-only remote connections
- [completed] Stabilize the Phase 2 verification baseline and runtime selection
- [completed] Lock Phase 2 connection contracts and JSON fixtures
- [completed] Extend SQLite persistence for saved connection metadata and selection state
- [completed] Implement pluggable secret storage with runtime and test adapters
- [completed] Implement PostgreSQL test/connect/disconnect/save/delete services in Rust
- [completed] Replace the placeholder shell with the connection management workspace
- [completed] Add frontend and backend coverage for connection lifecycle flows
- [completed] Add opt-in PostgreSQL smoke coverage and Phase 2 debugging docs
- [completed] Run final Phase 2 verification and record results

## Blockers And Decisions
- Current blocker: none.
- Database engine: PostgreSQL only.
- SSL scope: `disable`, `prefer`, and `require` only for Phase 2.
- Session scope: one active saved-profile-backed PostgreSQL session at a time.
- Secret strategy: pluggable secret store with OS-backed runtime implementation and deterministic test implementation.
- Save and test remain separate actions; unsaved drafts may be tested but not connected.
- Regression decision: saving a connection must forward a typed password whenever the draft contains a new secret, even for unsaved profiles that are not in replacement mode yet.
- TLS compatibility decision: the current basic SSL modes will accept provider-managed certificates and hostnames through the runtime TLS connector until explicit CA-file support exists in a later phase.
- Verification baseline fix: repo scripts now self-pin to `.node-version`, and the frontend test environment uses `happy-dom` because the previous `jsdom` stack failed during Vitest worker startup in this environment.

## Verification
- `node ./scripts/run-with-node-version.mjs node -v` ✅
  - `v24.13.0`
- `node ./scripts/run-with-node-version.mjs npm run test` ✅
- `node ./scripts/run-with-node-version.mjs npm run test -- src/test/app-shell.test.tsx` ✅
- `node ./scripts/run-with-node-version.mjs npm run verify` ✅
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- `cargo test --manifest-path src-tauri/Cargo.toml connections::service::tests` ✅
- `npm run smoke:postgres` not run
  - Requires `SPAROW_PG_HOST`, `SPAROW_PG_DATABASE`, `SPAROW_PG_USERNAME`, and `SPAROW_PG_PASSWORD` at minimum.

## Dependency Notes
- Preferred backend stack for Phase 2: `keyring`, `tokio-postgres`, `deadpool-postgres`, `native-tls`, and `postgres-native-tls` unless compatibility forces a narrower choice.
- Frontend verification baseline now uses `happy-dom 20.8.3` with `vitest 4.0.18`.
- Runtime added for Phase 2: `keyring 3.6.3`, `tokio-postgres 0.7.16`, `deadpool-postgres 0.14.1`, `native-tls 0.2.18`, `postgres-native-tls 0.5.2`, and `time 0.3.47`.
