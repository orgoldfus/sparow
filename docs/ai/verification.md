# Verification Guide

## Primary Command
- `fnm use`
- `npm run verify`

This runs, in order:
1. frontend typecheck
2. frontend lint
3. frontend tests
4. foundation smoke test
5. result-viewer browser smoke
6. shell browser smoke
7. productivity browser smoke
8. Rust tests

## Focused Commands
- `fnm use`
- `npm run test`
- `npm run smoke:foundation`
- `npm run ui:harness`
- `npm run smoke:results-browser`
- `npm run smoke:productivity-browser`
- `npm run smoke:postgres`
- `node ./scripts/inspect-schema-cache.mjs --db <sqlite-path> --connection <connection-id> [--scope <scope-path>]`
- `node ./scripts/inspect-query-history.mjs --db <sqlite-path> [--connection <connection-id>] [--limit <n>]`
- `node ./scripts/inspect-saved-queries.mjs --db <sqlite-path> [--connection <connection-id>] [--search <query>] [--limit <n>]`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri dev`

The SQLite inspection helpers now shell out to the repo-local Rust binary `sqlite_inspector`, so they require Cargo instead of Python.
The browser smoke requires a one-time `npx playwright install chromium`.

## Expected Outcome
- Frontend fixtures deserialize and validate.
- Shell region tests pass.
- Schema tree, cache search, and refresh diagnostics tests pass.
- Query workspace tab, slicing, autocomplete, and diagnostics tests pass.
- The result viewer harness opens in a browser at `/?harness=results`.
- The browser smoke scrolls the result grid, changes viewer descriptors, starts export, and writes a screenshot artifact.
- The productivity smoke opens the command palette, quick-opens a saved query, saves a new query, deletes a saved query, and verifies results focus routing in the shell harness.
- Smoke boot test passes.
- SQLite migrations and repository tests pass.
- Query execution contracts, direct-result windowing, query-history persistence, and fake-driver Rust tests pass.
- Saved-query CRUD, query-library interactions, command-palette interactions, and shell focus shortcuts pass in frontend tests.
- PostgreSQL smoke can be run explicitly with `SPAROW_PG_HOST`, `SPAROW_PG_DATABASE`, `SPAROW_PG_USERNAME`, `SPAROW_PG_PASSWORD`, and optional `SPAROW_PG_PORT` / `SPAROW_PG_SSL_MODE`.
- The schema cache inspection script can print cached scopes and nodes when given the SQLite path shown in diagnostics.
- The query-history inspection script can print recent accepted SQL statements when given the same SQLite path.
- The saved-query inspection script can print saved-query metadata and SQL for the same SQLite path.
- Query history should never exceed 2,000 retained rows after inserts.
- `todo.md` is updated with the final results.
