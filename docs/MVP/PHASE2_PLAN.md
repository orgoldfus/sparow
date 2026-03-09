# Phase 2 Plan: PostgreSQL Connection Management

## Summary
Phase 2 should turn the Phase 1 shell into a real PostgreSQL connection workspace: create, test, save, edit, delete, connect, and disconnect PostgreSQL profiles while keeping secrets out of SQLite and keeping all heavy work in Rust.

The implementation should start with one prerequisite: as of March 9, 2026, `npm run verify` is not green. `vitest` fails with an `ERR_REQUIRE_ESM` worker-start error, and the verification process drops back to Node `20.17.0` even though `.node-version` is `24`. Fix that first, then treat the rest of Phase 2 as the feature work.

Because this turn is still in Plan Mode, `todo.md` was not updated. The first implementation action must be to rewrite `todo.md` for Phase 2, carry over the current verification blocker, and keep updating it throughout the phase.

## Implementation Steps
1. Stabilize the Phase 2 baseline.
- Update `todo.md` with a Phase 2 objective, checklist, blockers, decisions, and a verification section.
- Fix the verification baseline so `fnm use` and `npm run verify` consistently run on Node 24.
- Resolve the Vitest worker issue before adding feature code; do not let Phase 2 start on a broken test harness.
- Parallelization: this step should be owned by one agent alone because it affects every later branch.

2. Lock the connection contracts and fixtures before wiring behavior.
- Replace the placeholder connection contract with explicit public payloads in Rust and TypeScript:
  `ConnectionSummary`, `ConnectionDetails`, `ConnectionDraft`, `SaveConnectionRequest`, `TestConnectionRequest`, `ConnectionTestResult`, `DatabaseSessionSnapshot`, `DeleteConnectionResult`, and `DisconnectSessionResult`.
- Extend `AppBootstrap` to include `savedConnections`, `selectedConnectionId`, and `activeSession`.
- Do not expose raw secret values or raw keychain identifiers to React. The frontend should only receive `hasStoredSecret` and `secretProvider`.
- Add JSON fixtures for every new command request/response and every new bootstrap shape before backend/UI wiring.
- Parallelization: can run in parallel with Step 3 after the payload names and fields are agreed.

3. Add persistence and secret-storage foundations in Rust.
- Keep `saved_connections` as the metadata table and add an append-only migration for Phase 2 fields that are actually needed: `engine` defaulting to `postgresql`, `last_tested_at`, and `last_connected_at`.
- Keep the existing SQLite column name `database_name`; map it to the public `database` field in repository code instead of renaming the schema.
- Introduce a `SecretStore` trait with two implementations:
  OS-backed store for app/runtime use, and deterministic mock/in-memory store for tests and AI workflows.
- Saving a profile must persist only non-secret metadata in SQLite and write the password through the `SecretStore`.
- Editing a profile with a blank password field must keep the existing stored secret unchanged.
- Deleting a profile must remove both the SQLite metadata row and the stored secret, and disconnect first if that profile is active.
- Persist `selectedConnectionId` in `app_settings` so restart restores selection, but do not auto-connect on boot.
- Parallelization: can run in parallel with Step 2 once the payloads are stable.

4. Build the PostgreSQL connection service and single active-session manager in Rust.
- Introduce a `ConnectionService` that orchestrates repository access, secret storage, error normalization, and the live PostgreSQL pool/session.
- Use one saved-profile connect path only: unsaved drafts may be tested, but they may not be connected.
- Use a single active session for Phase 2. Connecting to a different profile must disconnect the current one first, then replace the active session snapshot in app state.
- Back the active session with a small reusable PostgreSQL pool in Rust, not a frontend-held state object. Keep pool sizing internal and conservative.
- Set a default connect timeout of 10 seconds and tag sessions with `application_name = sparow`.
- Normalize failures into stable `AppError` codes at minimum for: missing secret, profile not found, invalid credentials, network unreachable, timeout, and SSL failure.
- `test_connection` should use the draft fields and return a typed result with success/failure, server version, current database, current user, SSL-in-use boolean, and round-trip time.
- `connect_saved_connection` should return a `DatabaseSessionSnapshot`, and `disconnect_active_connection` should clear the session cleanly.
- Log every save/test/connect/disconnect/delete operation with correlation ids and profile ids.
- Parallelization: starts after Steps 2 and 3.

5. Replace the placeholder shell with a native-feeling connection workspace.
- Keep the existing shell grid and move away from modal-heavy flows. The UI should behave like a desktop tool: persistent list/detail panes, compact controls, inline validation, and keyboardable actions.
- Left rail becomes the saved-connections list with selection, active-state badge, and “New Connection”.
- Main workspace becomes the connection editor: General section, Security section, and footer actions for `Test`, `Save`, `Connect`, `Disconnect`, and `Delete`.
- Password inputs must never be prefilled on edit. Show a stored-secret status row and a deliberate “Replace password” path instead.
- Allow save without a successful test so users can stage profiles offline; show `Never tested` or last-tested metadata clearly.
- Keep diagnostics visible in development mode, but move the Phase 1 mock-job controls out of the primary product path.
- Results/status region should show active session details and the latest connection test result until later phases replace it with query output.
- Extract the connection UI into a dedicated feature module instead of growing `App.tsx`; the frontend should still talk to Tauri only through `src/lib/ipc.ts`.
- Parallelization: can start after Step 2 with mocked IPC responses, then finish after Step 4 lands.

6. Add AI-friendly verification, smoke coverage, and debugging docs for Phase 2.
- Keep `npm run verify` deterministic and self-contained: contract tests, frontend tests, and Rust tests must pass without requiring a real PostgreSQL server or a real OS keychain.
- Add backend tests for repository mapping, migration application, secret-store behavior, active-session replacement, and error normalization.
- Add frontend tests for list/detail rendering, edit-without-password replacement, action enable/disable rules, and active-session status rendering.
- Add an opt-in real integration path such as `npm run smoke:postgres`, gated by environment variables, to test save/test/connect/disconnect/delete against a real PostgreSQL instance.
- Extend the AI docs with a short connection debugging playbook: where secrets live, how to inspect saved metadata, expected error codes, how to run the real smoke flow, and how to interpret connection logs.
- Prefer docs and scripts over creating a new repo skill in this phase; a dedicated skill is unnecessary unless connection work becomes repetitive across later phases.

## Important Public Interfaces
- `bootstrap_app() -> AppBootstrap` now returns saved connection summaries, selected connection id, active session snapshot, and diagnostics.
- `list_saved_connections() -> ConnectionSummary[]`
- `get_saved_connection(id) -> ConnectionDetails`
- `save_connection(request: SaveConnectionRequest) -> ConnectionDetails`
- `test_connection(request: TestConnectionRequest) -> ConnectionTestResult`
- `connect_saved_connection(id) -> DatabaseSessionSnapshot`
- `disconnect_active_connection() -> DisconnectSessionResult`
- `delete_saved_connection(id) -> DeleteConnectionResult`

Public type defaults:
- `ConnectionSummary` is list-safe and includes no secret reference details.
- `ConnectionDetails` includes editable metadata plus `hasStoredSecret`.
- `DatabaseSessionSnapshot` represents one active PostgreSQL session only.
- `sslMode` scope for Phase 2 is only `disable | prefer | require`.

## Test Plan
- Fresh app bootstrap shows saved profiles from SQLite and no plaintext secret material.
- Creating a new draft, testing it, saving it, reconnecting after restart, and deleting it all work without UI freezes.
- Editing metadata without entering a new password preserves the existing secret.
- Replacing a password updates the secret store and does not leak the old value into logs, fixtures, or SQLite.
- Connecting to profile B while profile A is active cleanly disconnects A and leaves only one active session.
- Bad credentials return a stable auth error, unreachable hosts return a stable network/timeout error, and SSL negotiation failures return a stable SSL error.
- `npm run verify` passes without a live PostgreSQL server.
- `npm run smoke:postgres` passes when PostgreSQL env vars are provided.
- `todo.md` is updated when each task starts/completes and after every verification run.

## Assumptions And Defaults
- PostgreSQL is still the only supported engine.
- Phase 2 supports only basic SSL modes now; CA files and client cert/key support are deferred.
- The app restores the last selected profile on boot but does not auto-connect on boot.
- Save and test are separate actions; saving does not require a successful live test.
- Unsaved drafts can be tested but cannot be connected.
- Preferred backend stack for this phase is `keyring` for OS/mock secret storage, `tokio-postgres` for the async PostgreSQL client, `deadpool-postgres` for pooled sessions, and `postgres-native-tls` for TLS support, unless implementation uncovers a concrete compatibility issue. Sources: [keyring](https://docs.rs/crate/keyring/latest), [tokio-postgres](https://docs.rs/tokio-postgres/latest/tokio_postgres/), [deadpool-postgres](https://docs.rs/deadpool-postgres/latest/deadpool_postgres/), [postgres-native-tls](https://docs.rs/postgres-native-tls/latest/postgres_native_tls/).
