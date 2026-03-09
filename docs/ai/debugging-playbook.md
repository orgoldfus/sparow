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
- Inspect the local SQLite file with `sqlite3 <path> '.tables'`.
- Check repository tests before changing UI logic.

## If The Shell Renders Incorrectly
- Run `npm run smoke:foundation`.
- Check `src/test/app-shell.test.tsx` and `src/test/foundation-smoke.test.tsx`.
- Keep layout regions stable; replace content before reshaping the shell grid.
