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
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri dev`

## Expected Outcome
- Frontend fixtures deserialize and validate.
- Shell region tests pass.
- Smoke boot test passes.
- SQLite migrations and repository tests pass.
- `todo.md` is updated with the final results.
