# Phase 5 Todo

## Objective
Build the Phase 5 streamed results workflow for Sparow: Rust-owned result caching, virtualized result browsing, exact CSV export from cached results, agent-visible browser harness coverage, and AI-friendly diagnostics that keep large-result handling debuggable without a human in the loop.

## Checklist
- [completed] Lock the Phase 5 baseline and record kickoff verification results
- [completed] Lock result-viewer contracts, fixtures, guards, and IPC surface
- [completed] Implement the Rust result cache, streaming query path, and cleanup rules
- [completed] Implement result-window fetches, cached sort/filter semantics, and CSV export in Rust
- [completed] Build the frontend virtualized result viewer, diagnostics updates, and query-state integration
- [completed] Add the browser harness, browser smoke automation, and Phase 5 AI/debug docs
- [completed] Run final verification and record the exact results

## Blockers And Decisions
- 2026-03-12: Started Phase 5 implementation. `docs/MVP/PHASE5_PLAN.md` is present as an untracked file; it is being left untouched because it is not part of the current tracked baseline.
- 2026-03-12: Phase 5 keeps the current shell layout and upgrades the results region instead of starting the broader shell redesign.
- 2026-03-12: Phase 5 uses a Rust/SQLite cached result store rather than a React-held full-row buffer so large-result behavior stays inspectable and bounded.
- 2026-03-12: Sort and filter semantics are viewer-only over the cached result set. There is no SQL rewriting in this phase.
- 2026-03-12: CSV export will use the cached result set plus the current viewer descriptors rather than rerunning the SQL.
- 2026-03-12: Prefer repo-local scripts and docs for AI/browser automation in this phase. Add a new skill only if the existing `agent-browser` workflow proves insufficient during implementation.
- 2026-03-12: Rust command/state/service wiring now targets cached result windows and export jobs. The next gate is focused Rust verification to flush out compile errors and any SQLite/streaming regressions before the frontend result viewer is replaced.

## Verification
- `fnm use` ✅
  - Warning about shell initialization is unchanged; the command still resolved to `Using Node v24.13.0`.
- `npm run verify` ✅
  - Typecheck, lint, Vitest, `smoke:foundation`, and `cargo test --manifest-path src-tauri/Cargo.toml` all passed at the Phase 5 kickoff, with 69 frontend tests, 63 Rust tests, and 4 expected ignored PostgreSQL smoke tests green.
- `cargo test --manifest-path src-tauri/Cargo.toml` ❌
  - Failed before compilation because `tokio-postgres 0.7.16` does not expose the `with-bigdecimal-0_4` feature. The dependency config was corrected before the next verification run.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Rust backend compiled and passed after the Phase 5 service/driver integration, with 70 tests green and the same 4 PostgreSQL-dependent tests still ignored.
- `npm run typecheck` ✅
  - TypeScript compiled after the query workspace moved to cached result summaries, result windows, and export job state.
- `node ./scripts/run-with-node-version.mjs vitest run src/test/query-workspace.test.tsx src/test/query-workspace-component.test.tsx src/test/app-shell.test.tsx` ❌
  - The wrapper could not resolve `vitest` directly in PATH on this machine, so the targeted frontend run was retried through `npm run test -- ...` instead of treating this as an application failure.
- `npm run test -- src/test/query-workspace.test.tsx src/test/query-workspace-component.test.tsx src/test/app-shell.test.tsx` ✅
  - The query workspace, query editor component, and app-shell integration tests all passed after the cached-result viewer state and listener mocks were updated.
- `npm run smoke:results-browser` ❌
  - The harness booted and the browser reached the page, but the smoke assertion matched a hidden scenario `<option>` containing the word `running` instead of the visible export-status badge. The script was tightened before retrying.
- `npm run verify` ❌
  - Typecheck passed, but lint failed on a missing result-grid effect dependency and several harness lint issues. Those were fixed before the next full verification run.
- `npm run smoke:results-browser` ✅
  - The harness smoke completed after the teardown fix and wrote [artifacts/result-viewer-smoke.png](/Users/orgoldfus/Workspace/personal/sparow/artifacts/result-viewer-smoke.png).
- `npm run verify` ✅
  - Phase 5 full verification passed with frontend typecheck, lint, 76 Vitest tests, `smoke:foundation`, `smoke:results-browser`, and Rust tests green.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Re-ran after silencing the cached-result metadata warning. The Rust suite stayed green with 70 passed tests and 4 expected ignored PostgreSQL smoke tests.
- `npm run verify` ✅
  - Re-ran after the final result-grid accessibility pass. The full stack stayed green with 76 frontend tests, `smoke:foundation`, `smoke:results-browser`, and the Rust suite all passing.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Rust verification is green again after the Phase 5 backend wiring pass: 70 tests passed, 4 PostgreSQL smoke tests remained ignored as expected, and the service/contract suite now builds against cached result summaries plus export commands.
