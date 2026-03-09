# Debugging Playbook

## First Checks
1. Read `todo.md` for the latest task status and most recent verification result.
2. Run `npm run verify` to confirm whether the failure is frontend, backend, or integration-level.
3. Inspect the SQLite file path and log file path shown in the diagnostics panel or returned by `bootstrap_app`.

## If A Contract Fails
- Check `fixtures/contracts/`.
- Check `src/lib/contracts.ts` guards.
- Check the matching Rust struct in `src-tauri/src/foundation/contracts.rs`.
- Run both `npm run test` and `cargo test --manifest-path src-tauri/Cargo.toml`.

## If A Mock Job Fails
- Check `src-tauri/src/foundation/state.rs` for job lifecycle and cancellation flow.
- Confirm the event name still matches `foundation://job-progress` on both sides.
- Inspect recent events in the diagnostics panel before changing the job logic.

## If Persistence Fails
- Inspect `src-tauri/src/persistence/migrations/0001_init.sql`.
- Inspect `src-tauri/src/persistence/migrations/0002_connection_management.sql`.
- Inspect `src-tauri/src/persistence/migrations/0003_schema_browser.sql`.
- Inspect the local SQLite file with `sqlite3 <path> '.tables'`.
- Check repository tests before changing UI logic.

## If Connection Management Fails
- Check `src-tauri/src/connections/service.rs` for connection lifecycle, error normalization, and active-session replacement.
- Check `src-tauri/src/connections/secret_store.rs` for keychain vs. in-memory secret behavior.
- Confirm `fixtures/contracts/` still matches the Rust and TypeScript connection payloads.
- Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- For a real server check, run `npm run smoke:postgres` with the required `SPAROW_PG_*` environment variables.

## If Schema Browsing Fails
- Check `src-tauri/src/schema/service.rs` for scope parsing, refresh orchestration, and PostgreSQL catalog queries.
- Confirm `schema://refresh-progress` still matches on both sides.
- Use the diagnostics panel to inspect the latest schema refresh status, scope path, and correlation id.
- Use `node ./scripts/inspect-schema-cache.mjs --db <sqlite-path> --connection <connection-id> [--scope <scope-path>]` to inspect cached scope rows without opening SQLite manually.
- Root scope uses an empty string in SQLite and `null` in the TypeScript boundary.
- Cache entries older than 2 minutes are treated as stale and should trigger a background refresh.
- For real PostgreSQL validation, run `npm run smoke:postgres`.

## If The Shell Renders Incorrectly
- Run `npm run smoke:foundation`.
- Check `src/test/app-shell.test.tsx` and `src/test/foundation-smoke.test.tsx`.
- Check `src/test/schema-browser.test.tsx` for schema tree, search, and diagnostics expectations.
- Keep layout regions stable; replace content before reshaping the shell grid.
