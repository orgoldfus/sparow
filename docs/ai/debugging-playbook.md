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
- Inspect `src-tauri/src/persistence/migrations/0007_productivity_layer.sql` for the saved-query upgrade, recency indexes, and history-retention assumptions.
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
- The schema-cache inspector now shells out to the repo-local Rust CLI (`sqlite_inspector`), not Python.
- Root scope uses an empty string in SQLite and `null` in the TypeScript boundary.
- Cache entries older than 2 minutes are treated as stale and should trigger a background refresh.
- For real PostgreSQL validation, run `npm run smoke:postgres`.

## If Query Execution Fails
- Check `src/features/query/sqlStatement.ts` first for selection-vs-cursor execution and ambiguous-current-statement validation.
- Check `src/features/query/useQueryWorkspace.ts` for per-tab state reduction and event ownership.
- Check `src-tauri/src/query/service.rs` for request validation, per-tab locking, history recording, and event emission.
- Check `src-tauri/src/query/driver.rs` for PostgreSQL execution, cancel-token wiring, and result mapping.
- Confirm `query://execution-progress` still matches on both sides.
- Use the diagnostics panel to inspect the latest query status, job id, connection id, correlation id, elapsed time, and terminal error code.
- Use `node ./scripts/inspect-query-history.mjs --db <sqlite-path> [--connection <connection-id>] [--limit <n>]` to inspect accepted query-history rows without opening SQLite manually.
- Query history is retained locally as the newest 2,000 accepted statements; older rows are pruned after inserts.
- Use `node ./scripts/inspect-saved-queries.mjs --db <sqlite-path> [--connection <connection-id>] [--search <query>] [--limit <n>]` to inspect saved-query metadata and SQL text.
- The query-history and saved-query inspectors shell out to the repo-local Rust CLI (`sqlite_inspector`), not Python.
- Backend query error codes currently include `query_no_active_session`, `query_tab_target_mismatch`, `query_empty_sql`, `query_multi_statement_selection`, `query_tab_already_running`, `query_job_missing`, `query_sql_execution_failed`, `query_cancel_failed`, and `query_cancelled`.
- Productivity-layer error codes also include `saved_query_empty_title`, `saved_query_empty_sql`, `saved_query_invalid_connection`, `saved_query_missing`, `query_history_invalid_limit`, and `saved_queries_invalid_limit`.
- Ambiguous cursor placement is a frontend validation failure from the SQL slicing helper, not a Rust `AppError`.
- For real PostgreSQL validation, run `npm run smoke:postgres`.

## If The Shell Renders Incorrectly
- Run `npm run smoke:foundation`.
- Run `npm run smoke:productivity-browser` to validate the command palette, query library, save-query flow, delete flow, and focus routing in the harness.
- Check `src/test/app-shell.test.tsx` and `src/test/foundation-smoke.test.tsx`.
- Check `src/test/productivity-workspace.test.tsx` for command-palette, query-library, save-dialog, and focus-shortcut expectations.
- Check `src/test/schema-browser.test.tsx` for schema tree, search, and diagnostics expectations.
- Check `src/test/query-workspace.test.tsx`, `src/test/query-execution-slice.test.ts`, `src/test/sql-statement.test.ts`, and `src/test/sql-autocomplete.test.ts` for Phase 4 workspace expectations.
- Keep layout regions stable; replace content before reshaping the shell grid.

## If Productivity Flows Fail
- Check `src/features/productivity/useProductivityWorkspace.ts` first for debounce timing, save/delete flows, and pending run requests.
- Check `src/features/productivity/useShellFocusRegistry.ts` when shortcuts focus the wrong surface or stop working after refactors.
- Check `src/features/productivity/QueryLibraryDialog.tsx`, `src/features/productivity/SaveQueryDialog.tsx`, and `src/features/productivity/CommandPalette.tsx` before changing shell layout code.
- `Mod+1/2/3/4` should focus connections, schema, editor, and results in that order.
- `Mod+K` and `Mod+Shift+P` should open the command palette.
- `Ctrl+Tab` and `Ctrl+Shift+Tab` should cycle editor tabs even after the productivity overlays were added.
