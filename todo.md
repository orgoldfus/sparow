# Phase 4 Todo

## Objective
Build the Phase 4 SQL workspace and query execution flow for Sparow: Monaco-based multi-tab editing, single-statement execution and cancellation against the active PostgreSQL session, schema-cache-backed autocomplete, capped result previews, and AI-friendly diagnostics that stay green without a live database by default.

## Checklist
- [completed] Lock the Phase 4 baseline and record initial verification results
- [completed] Lock query execution contracts, fixtures, and runtime guards in Rust and TypeScript
- [completed] Implement the Rust query subsystem with execution jobs, cancellation, result mapping, and query-history recording
- [completed] Build the frontend SQL workspace with in-memory tabs, tab targeting, run/cancel controls, and result/status presentation
- [completed] Integrate Monaco, execution-slice helpers, and schema-cache-backed autocomplete
- [completed] Wire query events, diagnostics updates, and shell integration while preserving the existing layout regions
- [completed] Extend smoke coverage, AI docs, and query-history inspection tooling
- [completed] Run final Phase 4 verification and record results

## Blockers And Decisions
- 2026-03-10: `README.md` was refreshed after Phase 4 completion so the repo landing page now matches the implemented SQL workspace, query execution model, debugging helpers, and verification flow.
- 2026-03-10: Phase 4 keeps the current shell grid and replaces the placeholder workspace content instead of starting the broader shell redesign.
- 2026-03-10: One active backend session remains the rule in Phase 4. Tabs store a target connection id, but Run is enabled only when the tab target matches the active saved connection.
- 2026-03-10: Execution scope is single statement only. A non-empty selection wins; otherwise the app runs the current statement around the cursor. Multi-statement selections must fail with a stable error.
- 2026-03-10: Result handling is limited to command summaries and capped row previews. Streaming, virtualization, CSV export, and large-result tuning stay in Phase 5.
- 2026-03-10: Prefer docs and scripts over creating a new repo skill for query debugging in this phase.
- 2026-03-10: `npm run verify` failed once at lint because Monaco's `onMount` callback was inferred as an unsafe error-typed value in `src/features/query/QueryWorkspace.tsx`; the callback is being retyped explicitly before the final rerun.
- 2026-03-10: The second `npm run verify` rerun exposed a Rust test-only import break after removing a `foundation` re-export. `src-tauri/src/query/service.rs` now imports `QueryExecutionOrigin` from `foundation::contracts` directly before the next rerun.
- 2026-03-10: The direct `foundation::contracts` import failed because the module is private. The correct fix is to restore the `QueryExecutionOrigin` re-export with an explicit `#[allow(unused_imports)]` and keep the tests on the public `foundation` surface.

## Verification
- `fnm use` ✅
  - `Using Node v24.13.0`
- `npm run verify` ✅
  - Typecheck, lint, Vitest, `smoke:foundation`, and Rust tests all passed before Phase 4 feature work started.
- `npm run test -- src/test/contract-fixtures.test.ts` ✅
  - The new query request, accepted, progress, and cancel fixtures validated successfully on the TypeScript side.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - The full Rust suite passed after adding the query execution contracts, runtime driver, cancellation flow, and query-service coverage.
- `npm run test -- src/test/sql-statement.test.ts src/test/app-shell.test.tsx src/test/schema-browser.test.tsx` ✅
  - The narrowed frontend rerun passed after fixing the SQL statement helper, restoring explicit SSL state in diagnostics, and aligning shell expectations with the Phase 4 UI copy.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - 63 tests passed, 4 PostgreSQL smoke tests were ignored as expected, and the warning-free rerun is now ready for the final `npm run verify` pass.
- `npm run verify` ❌
  - Typecheck passed, but lint failed on `src/features/query/QueryWorkspace.tsx` because Monaco's `onMount` callback parameters were inferred unsafely. The callback has been retyped explicitly and `npm run verify` must be rerun.
- `npm run verify` ❌
  - Typecheck, lint, Vitest, and `smoke:foundation` passed, but the Rust test leg failed because `src-tauri/src/query/service.rs` was still importing `QueryExecutionOrigin` from a removed `foundation` re-export. The test module now imports it directly from `foundation::contracts` and verification must be rerun.
- `cargo test --manifest-path src-tauri/Cargo.toml` ❌
  - The direct `foundation::contracts::QueryExecutionOrigin` import failed because `contracts` is a private module. The fix is to restore the `foundation` re-export and rerun.
- `npm run verify` ❌
  - Typecheck, lint, Vitest, and `smoke:foundation` passed again, but the Rust test leg still failed for the same private-module import issue. The `foundation` re-export has now been restored and verification must be rerun.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - The final rerun passed cleanly after restoring the `QueryExecutionOrigin` re-export with an explicit `#[allow(unused_imports)]` for the internal test surface.
- `npm run verify` ✅
  - Typecheck passed, lint passed, Vitest passed with 8 files / 64 tests, `smoke:foundation` passed, and `cargo test --manifest-path src-tauri/Cargo.toml` passed with 63 tests and 4 expected ignored PostgreSQL smoke tests.
