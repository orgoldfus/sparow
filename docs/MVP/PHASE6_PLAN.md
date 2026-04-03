# Phase 6 Plan: Developer Productivity Layer

## Summary
- Baseline is green as of March 31, 2026: `npm run verify` passed under Node `v24.14.0` with 97 Vitest tests, `smoke:foundation`, `smoke:results-browser`, `smoke:shell-browser`, and the Rust workspace passing with 93 tests green and 2 expected PostgreSQL tests ignored. The existing TanStack React Compiler warning in `QueryResultsTable.tsx` and the jsdom `flushSync` warnings remain unchanged.
- The first implementation action rewrites `todo.md` for Phase 6 and records the kickoff verification result.
- Phase 6 keeps the current shell grid. It adds backend contracts plus overlay productivity surfaces that can survive the upcoming UI replacement: a command palette, a query-library dialog, a save-query dialog, and keyboard/focus polish.

## Implementation Steps
1. Lock the Phase 6 baseline and shared interfaces before behavior work.
2. Extend `SavedQuery`, add history/saved-query request-result contracts, and add query-tab seeding support.
3. Add the productivity migration, repository queries, service layer, state wiring, and Tauri commands.
4. Add the query-library dialog, saved-query metadata flow, and tab seeding/update behavior.
5. Add the command palette, shortcuts, and focus registry across connections, schema, editor, and results.
6. Replace Python-dependent inspection with repo-native tooling and update AI/debug docs.
7. Extend the browser harness and add a productivity smoke flow.
8. Run final verification and record the exact results in `todo.md`.

## Important Interface Changes
- New Tauri commands:
  - `list_query_history(request)`
  - `list_saved_queries(request)`
  - `save_saved_query(request)`
  - `delete_saved_query(id)`
- `SavedQuery` includes `id`, `title`, `sql`, `tags`, `connectionProfileId`, `createdAt`, and `updatedAt`.
- `ListQueryHistoryRequest` and `ListSavedQueriesRequest` support `searchQuery`, `limit`, `offset`, and optional `connectionId`.
- `SaveSavedQueryRequest` supports create and update through `id: string | null`, plus `title`, `sql`, `tags`, and `connectionProfileId`.

## Test Plan
- Contract parity tests for every new history and saved-query payload.
- Migration tests for the saved-query schema upgrade.
- Repository/service tests for history pruning, history search/filter ordering, and saved-query CRUD.
- Frontend tests for query-library flows, save/update behavior, palette behavior, and keyboard focus/shortcuts.
- Browser smoke for command palette, query-library, save/delete flows, and focus retention.
- Final `npm run verify` must stay green, with exact results recorded in `todo.md`.
