# Phase 6 Todo

## Objective
Build the Phase 6 developer productivity layer for Sparow: query history and saved-query workflows, a keyboard-first command palette, focus navigation across the shell, AI-friendly local inspection tooling, and browser/test coverage that keeps the new productivity surfaces debuggable by agents.

## Checklist
- [completed] Lock the Phase 6 baseline and record kickoff artifacts
- [completed] Lock Phase 6 contracts, fixtures, guards, IPC, and query-tab state extensions
- [completed] Implement the Rust productivity migration, repository APIs, service layer, state wiring, and commands
- [completed] Implement the frontend query library, saved-query flows, command palette, and keyboard/focus polish
- [completed] Replace Python-dependent query-history inspection with repo-native tooling and update AI docs
- [completed] Add browser harness coverage for command palette and query-library workflows
- [completed] Run final verification and record the exact results

## Blockers And Decisions
- 2026-04-01: Started post-PR conflict resolution for `codex/phase-6`.
  - The branch is locally clean, so the conflict appears to be against the updated `main` branch rather than unresolved local merge markers.
  - Resolution strategy is to merge `origin/main` into `codex/phase-6`, keep the Phase 6 productivity layer intact, and rerun the most relevant checks before pushing the updated branch.
- 2026-03-31: Started Phase 6 implementation from a green baseline.
  - Phase 6 will preserve the current shell grid and add overlay productivity surfaces that can survive the planned UI replacement.
  - Shared contract files (`src/lib/contracts.ts`, `src/lib/guards.ts`, Rust contract structs, fixtures, IPC, commands, app state, and `src/App.tsx`) are treated as serial merge hotspots and must land before deeper feature work.
  - Saved queries will be upgraded in-place with an append-only migration so they can store `connection_profile_id` and `created_at`; existing rows will backfill `created_at` from `updated_at`.
  - Query history remains an accepted-query audit log, not a successful-query-only log.
  - Opening history or saved queries will create a new tab by default so existing editor state is never overwritten implicitly.
  - The Python-dependent SQLite inspection path will be replaced with repo-native tooling during this phase.
- 2026-03-31: When sandboxed execution already has Node `v24.14.0`, Phase 6 verification can run `npm` directly instead of calling `fnm use`, which fails because `fnm` tries to write multishell state outside the workspace.

## Verification
- `npm run typecheck` ✅
  - Ran on 2026-04-01 during post-PR conflict resolution after merging `origin/main` into `codex/phase-6`. TypeScript compilation passed with the merged Phase 6 productivity layer and the updated shell changes from `main`.
- `npm run test -- src/test/app-shell.test.tsx src/test/productivity-workspace.test.tsx src/test/query-workspace-component.test.tsx src/test/schema-browser.test.tsx` ✅
  - Ran on 2026-04-01 during post-PR conflict resolution after merging `origin/main` into `codex/phase-6`. The targeted shell, productivity, query-workspace, and schema-browser slices all passed (33 tests). The longstanding jsdom `flushSync` warnings in `src/test/query-workspace-component.test.tsx` remain unchanged.
- `eval "$(fnm env --shell zsh)" && fnm use && npm run verify` ✅
  - Ran on 2026-03-31 under Node `v24.14.0`. `typecheck`, ESLint, 9 Vitest files / 97 tests, `smoke:foundation`, `smoke:results-browser`, `smoke:shell-browser`, and the Rust workspace all passed. The existing TanStack React Compiler warning in `src/features/query/QueryResultsTable.tsx` and the longstanding jsdom `flushSync` warnings in `src/test/query-workspace-component.test.tsx` remain unchanged.
- `eval "$(fnm env --shell zsh)" && fnm use && npm run test -- src/test/contract-fixtures.test.ts src/test/query-workspace-component.test.tsx` ❌
  - Ran on 2026-03-31. Failed before tests started because sandboxed execution could not create the `fnm` multishell symlink under `/Users/orgoldfus/.local/state/fnm_multishells/...`.
- `cargo test --manifest-path src-tauri/Cargo.toml productivity::service::tests persistence::repository::tests foundation::contracts::tests` ❌
  - Ran on 2026-03-31. Failed immediately because `cargo test` accepts a single positional test filter and rejected the extra filters.
- `npm run test -- src/test/contract-fixtures.test.ts src/test/query-workspace-component.test.tsx` ✅
  - Ran on 2026-03-31 under Node `v24.14.0`. `src/test/contract-fixtures.test.ts` and `src/test/query-workspace-component.test.tsx` both passed (58 tests). The existing jsdom `flushSync` warnings in `src/test/query-workspace-component.test.tsx` remain unchanged.
- `cargo test --manifest-path src-tauri/Cargo.toml` ❌
  - Ran on 2026-03-31. Compilation failed in `src-tauri/src/persistence/repository.rs` because the new repository test module was missing imports for `params!`, `Connection`, `MIGRATIONS`, `HISTORY_RETENTION_LIMIT`, and `SaveSavedQueryRecord`.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Ran on 2026-03-31 after fixing the new repository test-module imports. The Rust workspace passed with 107 tests green and 2 expected PostgreSQL tests ignored.
- `npm run typecheck` ❌
  - Ran on 2026-03-31 during frontend productivity integration. Failed on one unused import: `cn` in `src/features/productivity/QueryLibraryDialog.tsx`.
- `npm run test -- src/test/app-shell.test.tsx src/test/query-workspace-component.test.tsx src/test/schema-browser.test.tsx` ✅
  - Ran on 2026-03-31 under Node `v24.14.0`. `src/test/app-shell.test.tsx`, `src/test/query-workspace-component.test.tsx`, and `src/test/schema-browser.test.tsx` all passed (29 tests). The longstanding jsdom `flushSync` warnings in `src/test/query-workspace-component.test.tsx` remain unchanged.
- `npm run typecheck` ✅
  - Ran on 2026-03-31 after removing the unused `cn` import from `src/features/productivity/QueryLibraryDialog.tsx`.
- `npm run test -- src/test/productivity-workspace.test.tsx src/test/app-shell.test.tsx src/test/query-workspace-component.test.tsx src/test/schema-browser.test.tsx` ❌
  - Ran on 2026-03-31. `src/test/productivity-workspace.test.tsx` exposed three frontend issues: the save-query dialog defaulted `connectionProfileId` to `null` for the active tab, the command-palette assertion needed to wait for the saved-query row itself, and `Mod+4` could not focus the disabled results quick filter.
- `npm run test -- src/test/productivity-workspace.test.tsx src/test/app-shell.test.tsx src/test/query-workspace-component.test.tsx src/test/schema-browser.test.tsx` ❌
  - Ran again on 2026-03-31 after fixing the command-palette assertion and results focus target. The remaining failure was the active-tab save path still submitting `connectionProfileId: null` when the dialog opened before the tab/connection state had converged.
- `npm run typecheck` ❌
  - Ran on 2026-03-31 after adding the productivity harness and inspector tooling. Failed on one unused state setter: `setHistoryEntries` in `src/features/shell/ShellHarness.tsx`.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Ran on 2026-03-31 after adding the `sqlite_inspector` binary. The Rust workspace passed with 107 tests green, 2 expected PostgreSQL tests ignored, and the new `sqlite_inspector` binary compiled successfully under test.
- `npm run typecheck` ✅
  - Ran on 2026-03-31 after fixing the harness productivity wiring.
- `npm run test -- src/test/productivity-workspace.test.tsx src/test/app-shell.test.tsx src/test/query-workspace-component.test.tsx src/test/schema-browser.test.tsx` ✅
  - Ran on 2026-03-31 under Node `v24.14.0`. The productivity, shell, query-workspace, and schema-browser slices all passed (33 tests). The longstanding jsdom `flushSync` warnings in `src/test/query-workspace-component.test.tsx` remain unchanged.
- `npm run smoke:productivity-browser` ❌
  - Ran on 2026-03-31. The harness smoke failed before app assertions because Playwright Chromium hit a macOS permission error during launch: `bootstrap_check_in ... Permission denied (1100)`. This appears environment-related and needs an escalated rerun.
- `npm run typecheck` ✅
  - Ran on 2026-03-31 after adding stable productivity launcher/dialog test IDs and improving the productivity smoke diagnostics.
- `npm run test -- src/test/productivity-workspace.test.tsx src/test/app-shell.test.tsx src/test/query-workspace-component.test.tsx src/test/schema-browser.test.tsx` ✅
  - Ran on 2026-03-31 under Node `v24.14.0`. The productivity, shell, query-workspace, and schema-browser slices all passed again (33 tests). The longstanding jsdom `flushSync` warnings in `src/test/query-workspace-component.test.tsx` remain unchanged.
- `npm run smoke:productivity-browser` ❌
  - Ran on 2026-03-31 with Chromium outside the sandbox. The new diagnostics showed the harness page was crashing after opening the command palette with a browser-only `Maximum update depth exceeded` loop inside Radix Presence/ref composition, before any productivity assertions could run.
- `npm run typecheck` ✅
  - Ran on 2026-03-31 after converting the dialog primitive wrappers to proper ref-forwarding components for browser-safe Radix mounting.
- `npm run test -- src/test/productivity-workspace.test.tsx src/test/app-shell.test.tsx` ✅
  - Ran on 2026-03-31 after the dialog wrapper ref fix. The productivity and shell slices both passed (21 tests).
- `npm run smoke:productivity-browser` ❌
  - Ran again on 2026-03-31 with Chromium outside the sandbox after the dialog wrapper ref-forwarding change. The same browser-only `Maximum update depth exceeded` loop remained when opening the command palette, which confirmed the issue lived in the shared dialog primitive rather than in a single productivity dialog.
- `npm run typecheck` ✅
  - Ran on 2026-03-31 after replacing the shared dialog primitive with a repo-local modal implementation that avoids the Radix dialog ref loop in real browsers.
- `npm run test -- src/test/productivity-workspace.test.tsx src/test/app-shell.test.tsx src/test/foundation-smoke.test.tsx` ✅
  - Ran on 2026-03-31 after the dialog primitive replacement. The productivity, shell, and foundation smoke slices all passed (22 tests).
- `npm run typecheck` ✅
  - Ran on 2026-03-31 after disabling unused TanStack pagination resets in `QueryResultsTable` and tightening the productivity smoke selector.
- `npm run test -- src/test/query-workspace-component.test.tsx src/test/productivity-workspace.test.tsx src/test/app-shell.test.tsx` ✅
  - Ran on 2026-03-31 after the result-table pagination change. The query-workspace, productivity, and shell slices all passed (28 tests). The longstanding jsdom `flushSync` warnings in `src/test/query-workspace-component.test.tsx` remain unchanged.
- `npm run smoke:productivity-browser` ✅
  - Ran on 2026-03-31 after tightening the browser-only selectors. The productivity harness smoke completed successfully and wrote `/Users/orgoldfus/Workspace/personal/sparow/artifacts/productivity-harness-smoke.png`.
- `npm run verify` ❌
  - Ran on 2026-03-31. The full verify failed in the lint step on new React rules in the productivity code: the command palette reset effect used synchronous `setState`, `useProductivityWorkspace` called `useEffectEvent` helpers from non-effect code, and the harness command-palette `useMemo` violated the repo’s React Compiler preservation rules.
- `npm run lint` ✅
  - Ran on 2026-03-31 after restructuring the new productivity code around `useCallback`/plain render-time derivation. ESLint passed; the existing TanStack React Compiler warning in `src/features/query/QueryResultsTable.tsx` remains unchanged.
- `npm run test -- src/test/productivity-workspace.test.tsx src/test/app-shell.test.tsx` ✅
  - Ran on 2026-03-31 after the lint-oriented productivity refactor. The productivity and shell slices both passed (21 tests).
- `npm run verify` ❌
  - Ran on 2026-03-31 inside the default sandbox. The repo checks passed through typecheck, lint, Vitest, and `smoke:foundation`, but `smoke:results-browser` failed on the known macOS Chromium permission error (`bootstrap_check_in ... Permission denied (1100)`), so the full verify needed an escalated rerun.
- `npm run verify` ✅
  - Ran on 2026-03-31 outside the sandbox so the browser smokes could launch Chromium. `typecheck`, `eslint`, 10 Vitest files / 109 tests, `smoke:foundation`, `smoke:results-browser`, `smoke:shell-browser`, `smoke:productivity-browser`, and the Rust workspace all passed. The existing TanStack React Compiler warning in `src/features/query/QueryResultsTable.tsx` and the longstanding jsdom `flushSync` warnings in `src/test/query-workspace-component.test.tsx` remain unchanged.
- `npm run smoke:postgres` skipped
  - Ran decision on 2026-03-31. The required PostgreSQL smoke environment variables (`SPAROW_PG_HOST`, `SPAROW_PG_DATABASE`, `SPAROW_PG_USERNAME`, `SPAROW_PG_PASSWORD`) were not present in this shell, so the optional Phase 6 PostgreSQL smoke was not executed.
