# Verification Guide

## Primary Command
- `fnm use`
- `npm run verify`

This runs, in order:
1. frontend typecheck
2. frontend lint
3. frontend tests
4. foundation smoke test
5. Rust tests

## Focused Commands
- `fnm use`
- `npm run test`
- `npm run smoke:foundation`
- `npm run smoke:postgres`
- `node ./scripts/inspect-schema-cache.mjs --db <sqlite-path> --connection <connection-id> [--scope <scope-path>]`
- `node ./scripts/inspect-query-history.mjs --db <sqlite-path> [--connection <connection-id>] [--limit <n>]`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri dev`

The schema cache and query-history inspection helpers require `python3` on `PATH`.

## Expected Outcome
- Frontend fixtures deserialize and validate.
- Shell region tests pass.
- Schema tree, cache search, and refresh diagnostics tests pass.
- Query workspace tab, slicing, autocomplete, and diagnostics tests pass.
- Smoke boot test passes.
- SQLite migrations and repository tests pass.
- Query execution contracts, query-history persistence, and fake-driver Rust tests pass.
- PostgreSQL smoke can be run explicitly with `SPAROW_PG_HOST`, `SPAROW_PG_DATABASE`, `SPAROW_PG_USERNAME`, `SPAROW_PG_PASSWORD`, and optional `SPAROW_PG_PORT` / `SPAROW_PG_SSL_MODE`.
- The schema cache inspection script can print cached scopes and nodes when given the SQLite path shown in diagnostics.
- The query-history inspection script can print recent accepted SQL statements when given the same SQLite path.
- `todo.md` is updated with the final results.
