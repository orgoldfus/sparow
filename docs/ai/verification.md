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
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri dev`

## Expected Outcome
- Frontend fixtures deserialize and validate.
- Shell region tests pass.
- Schema tree, cache search, and refresh diagnostics tests pass.
- Smoke boot test passes.
- SQLite migrations and repository tests pass.
- PostgreSQL smoke can be run explicitly with `SPAROW_PG_HOST`, `SPAROW_PG_DATABASE`, `SPAROW_PG_USERNAME`, `SPAROW_PG_PASSWORD`, and optional `SPAROW_PG_PORT` / `SPAROW_PG_SSL_MODE`.
- The schema cache inspection script can print cached scopes and nodes when given the SQLite path shown in diagnostics.
- `todo.md` is updated with the final results.
