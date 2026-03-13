# Phase 5 Plan: Streamed Result Viewer, Exact CSV Export, And Agent-Visible UI Harness

## Summary
- `todo.md` shows Phase 4 green as of March 11, 2026. Because this turn stayed in Plan Mode, `todo.md` was not updated; the first implementation action must rewrite it for Phase 5 and then keep updating it when work starts, completes, blocks, and after every verification run.
- Phase 5 should not begin the full shell redesign. Keep the current shell layout, but replace the result-preview surface with a dense desktop-style grid that feels native inside the existing frame.
- Chosen direction: use a Rust/SQLite cached result store rather than a React-held full-row buffer, and add a browser-accessible UI harness so agents can inspect and drive the result viewer with `agent-browser` or Playwright-style automation.

## Implementation Steps
1. Kick off the phase and lock the baseline. Serial.
- Rewrite `todo.md` for Phase 5, run `fnm use` and `npm run verify`, and record the exact output summary.
- Preserve all Phase 4 connection, schema, and query flows until the new row-result path is fully integrated.
- Add a short Phase 5 architecture note before coding starts so later agents have one source of truth for result streaming, cache ownership, sort/filter semantics, export behavior, and cleanup rules.

2. Lock the contracts and fixtures before behavior. Serial gate for all later work.
- Replace the preview-row result model with a result-set summary model for row-returning queries.
- Keep `query://execution-progress` for query lifecycle only; add one new result-stream event channel and one new export-progress event channel.
- Add matching Rust types, TypeScript types, runtime guards, and JSON fixtures for `QueryResultSetSummary`, `QueryResultColumn`, `QueryResultStreamEvent`, `QueryResultWindowRequest`, `QueryResultWindow`, `QueryResultSort`, `QueryResultFilter`, `QueryResultExportRequest`, `QueryResultExportAccepted`, `QueryResultExportProgressEvent`, and `CancelQueryResultExportResult`.
- Row cells must cross the IPC boundary only as JSON-safe scalars: `string | number | boolean | null`. Unsupported PostgreSQL values should be serialized to strings in Rust. Command-only queries keep the existing command-result path and do not create row caches.

3. Build the Rust result cache and streaming driver. Parallel branch A after Step 2.
- Add append-only migration `0004_result_viewer.sql` with `query_result_sets` for result metadata and `query_result_rows` for cached row payloads keyed by `result_set_id` plus `row_index`.
- Switch row-returning execution away from `simple_query` to a real streaming path that does not materialize the full result before progress is visible. Use `execute` for command statements and a streaming row API for row statements.
- Persist columns once, then buffer rows in fixed batches, write them transactionally to SQLite, and emit `rows-buffered` events after each committed batch.
- Track `resultSetId`, `jobId`, `tabId`, `connectionId`, original SQL, column metadata, rows buffered, final row count, status, created time, completed time, and terminal error for every cached result set.
- Cleanup is required and explicit: purge leftover cached results on startup, drop the previous result set when the same tab runs again, and drop a tab’s cached result when that tab closes.
- Add `scripts/inspect-result-cache.mjs` so agents can inspect cached columns, counts, and row windows from the SQLite path shown in diagnostics.

4. Build Rust windowing, sort/filter, and CSV export. Parallel branch B after Step 2.
- Add `get_query_result_window`. The request must include `resultSetId`, `offset`, `limit`, `sort`, `filters`, and `quickFilter`. The response must include `rows`, `offset`, `limit`, `visibleRowCount`, `bufferedRowCount`, `totalRowCount`, and `isComplete`.
- Window fetches must run only against the SQLite result cache, never against the live PostgreSQL session.
- Phase 5 result-view semantics are fixed: single-column sort only, text quick filter across all visible columns, optional per-column `contains` filter, no SQL rewriting, no multi-column sort, no regex filters, and no numeric/date range builders.
- While a query is still streaming, sort and filter apply only to the rows already cached. The backend response must say whether the underlying result is still incomplete so the UI can label that state honestly.
- Add `start_query_result_export` and `cancel_query_result_export`. Export must read from the cached result set, apply the same active sort and filter descriptors as the viewer, and write incrementally in Rust without rerunning the SQL.
- Add the Tauri dialog/filesystem capability work needed for save-file selection and writes. The browser harness must stub the file-picker path so automation can run outside Tauri.

5. Build the frontend result viewer. Parallel branch C after Step 2.
- Replace the current card-like preview with a dense desktop-style data grid in the results panel. Keep the shell layout stable; only the contents of the results region change in Phase 5.
- Use virtualization with fixed row height, sticky headers, a row-number gutter, overscan, and lazy window fetches. React state must hold only the active `resultSetSummary`, the current sort/filter descriptors, a small window cache for the active view, export state, and minimal selection/focus state. Do not store the full result set in React.
- The results toolbar must show rows buffered versus total rows, streaming/completed/cancelled/failed state, quick filter, single-column sort, per-column filter entry points, export, and explicit copy that the current view is based on the cached result while streaming is still in progress.
- The messages tab remains the place for execution messages and errors. The results tab becomes the real grid surface with clear empty, loading, streaming, failed, and cancelled states.
- Make the UI native-feeling without starting the global redesign: compact spacing, minimal card chrome, subtle separators, strong keyboard focus, dense typography, sticky status strips, and no modal-heavy result interactions.
- Add stable `data-testid` values plus ARIA grid roles so browser automation and AI agents can interact with the surface reliably.

6. Add agent-visible browser automation. Parallel branch D after Step 2.
- Standardize a repo-local browser harness command, preferably `npm run ui:harness`, even if some developers already have an ad hoc browser-open script outside the repo.
- The harness must render the real result-viewer components against deterministic mocked IPC scenarios, not a throwaway demo.
- Include fixed scenarios for command results, small completed row results, large mid-stream results, completed large results with sort/filter, query failure, query cancellation, export running, and export failure.
- Add a browser smoke path, preferably `npm run smoke:results-browser`, that opens the harness, scrolls the virtualized grid, changes sort/filter state, starts export, and captures at least one screenshot artifact.
- Extend the AI docs with a result-viewer UI loop: how to launch the harness, drive it with `agent-browser` or Playwright MCP, inspect screenshots, and debug virtualization/export failures.
- Prefer docs and scripts over a new repo-local skill in Phase 5, since the session already includes `agent-browser`.

7. Integrate and verify. Serial after branches A through D land.
- Update diagnostics so recent result-stream and export events show `resultSetId`, job id, rows buffered, active sort/filter state, output path, and terminal errors.
- Extend PostgreSQL smoke coverage to include a multi-thousand-row query that streams visibly, scrolling into later windows, cached-result sort/filter, CSV export from the captured result, and export cancellation.
- Final verification must include `npm run verify`, the new browser smoke, targeted Rust tests, and the live PostgreSQL smoke path. Every run must be recorded in `todo.md`.

## Important Interface Changes
- `QueryExecutionProgressEvent.result` must stop carrying preview rows for row-returning queries. It should carry either a command result or a `QueryResultSetSummary`.
- New commands: `get_query_result_window(request) -> QueryResultWindow`, `start_query_result_export(request) -> QueryResultExportAccepted`, and `cancel_query_result_export(jobId) -> CancelQueryResultExportResult`.
- New events: `query://result-stream -> QueryResultStreamEvent` and `query://result-export-progress -> QueryResultExportProgressEvent`.
- `QueryResultColumn` should grow `semanticType` and `isNullable` so the grid can align and sort values predictably without guessing.

## Test Plan
- Contract tests must fail if Rust, TypeScript, or fixtures drift for any new result-stream, window, or export payload.
- Rust tests must cover row-stream batching, cache writes, startup cleanup, tab-close cleanup, pagination boundaries, sort/filter correctness against cached rows, export success, export cancellation, export failure, and command queries bypassing the row-cache path.
- Frontend tests must cover streaming badges, window fetch on scroll, virtualization rendering only visible rows, sort/filter state updates, export button rules, export progress rendering, and diagnostics updates for result/export events.
- Browser smoke must cover opening the harness, scrolling to later rows, filtering, sorting, starting export, and capturing a screenshot.
- Real PostgreSQL smoke must cover a large `select generate_series(...)`, stable scrolling after several chunk writes, and CSV export from that captured result.
- `todo.md` must end the phase with the exact latest verification results.

## Assumptions And Defaults
- Phase 5 upgrades the result viewer inside the current shell; the broader shell redesign stays out of scope.
- PostgreSQL remains the only engine and query execution remains single-statement only.
- Sort and filter are viewer semantics over the cached result set only; there is no SQL-aware rewrite in this phase.
- Export uses the cached result set and current viewer descriptors, not a rerun of the query.
- The cached result tables are runtime artifacts for responsiveness and inspectability, not long-term user data that should survive across sessions.
