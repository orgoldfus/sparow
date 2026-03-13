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
- 2026-03-13: Started a follow-up CodeRabbit autofix pass after one new CSV export review comment landed on `codex/phase-5`.
- 2026-03-13: Started another CodeRabbit autofix pass on `codex/phase-5` to clear any newly unresolved review threads before the final commit/push.
- 2026-03-12: Started a full local CI reproduction pass for the current branch to match `.github/workflows/ci.yml`, fix any failing step (currently suspected `cargo clippy`), and re-verify before handling remaining review feedback.
- 2026-03-12: Started a second CodeRabbit unresolved-thread pass after CI stabilization so the branch ends with both CI and PR review state aligned.
- 2026-03-12: Started a CodeRabbit autofix pass on `codex/phase-5` to resolve unresolved PR review threads against the current branch state.
- 2026-03-12: Started a CI follow-up to fix a failing `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` run and verify the Rust workspace formatting state locally.
- 2026-03-12: Started Phase 5 implementation. `docs/MVP/PHASE5_PLAN.md` is present as an untracked file; it is being left untouched because it is not part of the current tracked baseline.
- 2026-03-12: Phase 5 keeps the current shell layout and upgrades the results region instead of starting the broader shell redesign.
- 2026-03-12: Phase 5 uses a Rust/SQLite cached result store rather than a React-held full-row buffer so large-result behavior stays inspectable and bounded.
- 2026-03-12: Sort and filter semantics are viewer-only over the cached result set. There is no SQL rewriting in this phase.
- 2026-03-12: CSV export will use the cached result set plus the current viewer descriptors rather than rerunning the SQL.
- 2026-03-12: Prefer repo-local scripts and docs for AI/browser automation in this phase. Add a new skill only if the existing `agent-browser` workflow proves insufficient during implementation.
- 2026-03-12: Rust command/state/service wiring now targets cached result windows and export jobs. The next gate is focused Rust verification to flush out compile errors and any SQLite/streaming regressions before the frontend result viewer is replaced.

## Verification
- `eval "$(fnm env --shell zsh)" && fnm use && npm run verify` ✅
  - The final follow-up verification passed under Node `v24.13.0`: `npm run verify` stayed green with typecheck, ESLint, 76 Vitest tests, both smoke suites, and the Rust workspace finishing with 75 passing tests plus 4 expected ignored PostgreSQL smoke tests.
- `eval "$(fnm env --shell zsh)" && fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml --locked csv_field_for_cell_sanitizes_formula_prefixes_before_escaping` ✅
  - The CSV export follow-up verification passed under Node `v24.13.0`: Rust formatting stayed clean, `clippy -D warnings` passed, and the updated CSV sanitization unit test confirmed formula hardening still applies to string cells without mutating negative numeric exports.
- `eval "$(fnm env --shell zsh)" && fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings && npm run verify` ✅
  - The final autofix verification passed under Node `v24.13.0`: Rust formatting stayed clean, `clippy -D warnings` passed, `npm run verify` passed with 76 Vitest tests plus both smoke suites green, and the Rust workspace finished with 75 tests passed and 4 expected PostgreSQL smoke tests ignored.
- `eval "$(fnm env --shell zsh)" && fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml --locked csv_field_for_cell_sanitizes_formula_prefixes_before_escaping && npm run test -- src/test/contract-fixtures.test.ts && npm run lint` ✅
  - The focused autofix verification passed under Node `v24.13.0`: Rust formatting stayed clean, the new CSV sanitization unit test passed, the contract-fixture suite passed with the tightened result guards, and ESLint stayed green.
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
  - The harness smoke completed after the teardown fix and wrote [artifacts/result-viewer-smoke.png](artifacts/result-viewer-smoke.png).
- `npm run verify` ✅
  - Phase 5 full verification passed with frontend typecheck, lint, 76 Vitest tests, `smoke:foundation`, `smoke:results-browser`, and Rust tests green.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Re-ran after silencing the cached-result metadata warning. The Rust suite stayed green with 70 passed tests and 4 expected ignored PostgreSQL smoke tests.
- `npm run verify` ✅
  - Re-ran after the final result-grid accessibility pass. The full stack stayed green with 76 frontend tests, `smoke:foundation`, `smoke:results-browser`, and the Rust suite all passing.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Rust verification is green again after the Phase 5 backend wiring pass: 70 tests passed, 4 PostgreSQL smoke tests remained ignored as expected, and the service/contract suite now builds against cached result summaries plus export commands.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` ✅
  - CI formatting drift was reproduced locally, corrected with `cargo fmt --manifest-path src-tauri/Cargo.toml`, and the Rust workspace now passes the formatter check again.
- `npm run test -- src/test/contract-fixtures.test.ts src/test/query-workspace.test.tsx` ✅
  - The targeted frontend contract and workspace tests passed after the cached-result status contract switched from `isComplete` to explicit terminal states.
- `cargo test --manifest-path src-tauri/Cargo.toml` ❌
  - The first Rust verification pass failed on a missing `QueryResultStatus` import in the foundation contract tests and a borrow-lifetime issue in the transactional `load_query_result_window` rewrite. Both are being corrected before retrying.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - The Rust suite passed after the contract-test import fix and the transactional window-read lifetime cleanup, with 72 tests green and 4 PostgreSQL smoke tests still ignored as expected.
- `npm run verify` ✅
  - Full verification passed after the CodeRabbit autofix pass: frontend typecheck, lint, 76 Vitest tests, `smoke:foundation`, `smoke:results-browser`, and the Rust suite all stayed green with the new cached-result status contract and export/runtime fixes.
- `fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings` ❌
  - `fnm use` resolved `Using Node v24.13.0` with the same shell-path warning, `cargo fmt --check` passed, and `cargo clippy` failed on `clippy::let_and_return` in `src-tauri/src/persistence/repository.rs` within the cached-row decode path. Fixing that lint before rerunning the Rust CI steps.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml --locked` ✅
  - The Rust CI sequence now passes locally after removing the unnecessary `let`/return binding in the cached-row decode path. `clippy` is clean under `-D warnings`, and the locked Rust suite passed with 72 tests green plus the same 4 ignored PostgreSQL smoke tests.
- `eval "$(fnm env --shell zsh)" && fnm use && npm ci && npm run typecheck && npm run lint && npm run test && npm run build` ✅
  - The frontend CI sequence passed under the repo-pinned Node `v24.13.0` and npm `11.6.2`, which matches the workflow expectations better than the machine-default Node `20.17.0`. Typecheck, ESLint, 76 Vitest tests, and the production Vite build all completed cleanly.
- `eval "$(fnm env --shell zsh)" && fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml --locked persistence::repository::tests::preserves_requested_result_sets_when_clearing_a_tab_cache query::service::tests::records_query_history_after_accepting_a_query && npm run test -- src/test/contract-fixtures.test.ts && npm run lint` ❌
  - The targeted follow-up verification failed immediately on `cargo fmt --check` because the new repository/query-service edits needed Rust formatting. Running `cargo fmt --manifest-path src-tauri/Cargo.toml` before retrying the targeted checks.
- `eval "$(fnm env --shell zsh)" && fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml --locked persistence::repository::tests::preserves_requested_result_sets_when_clearing_a_tab_cache query::service::tests::records_query_history_after_accepting_a_query && npm run test -- src/test/contract-fixtures.test.ts && npm run lint` ❌
  - Rust formatting succeeded, but the targeted command itself was invalid because `cargo test` only accepts a single name filter per invocation. Retrying with separate Rust test commands before treating this as an application failure.
- `eval "$(fnm env --shell zsh)" && fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml --locked preserves_requested_result_sets_when_clearing_a_tab_cache && cargo test --manifest-path src-tauri/Cargo.toml --locked records_query_history_after_accepting_a_query && npm run test -- src/test/contract-fixtures.test.ts && npm run lint` ✅
  - The targeted regression checks passed after formatting: the new repository preservation test passed, the existing query-history service test stayed green, the frontend contract-fixture suite passed, and ESLint stayed clean. That run also exposed a now-unused `delete_query_result_set` helper, which is being removed before the next `clippy -D warnings` pass.
- `eval "$(fnm env --shell zsh)" && fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml --locked && npm ci && npm run typecheck && npm run lint && npm run test && npm run build` ❌
  - The post-fix full CI rerun failed at `cargo clippy` on `dead_code`: `Repository::delete_query_result_set` is no longer used after the tab cleanup switched to one transactional delete. Removing that helper before rerunning the entire workflow.
- `eval "$(fnm env --shell zsh)" && fnm use && cargo fmt --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml --locked && npm ci && npm run typecheck && npm run lint && npm run test && npm run build` ✅
  - The full CI workflow now passes locally on the current tree under Node `v24.13.0`: Rust format, `clippy -D warnings`, and 74 Rust tests (plus 4 expected ignored PostgreSQL smoke tests) all passed; `npm ci`, typecheck, ESLint, 76 Vitest tests, and the production Vite build also completed successfully.
