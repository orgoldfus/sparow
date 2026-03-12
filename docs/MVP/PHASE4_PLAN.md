# Phase 4 Plan: SQL Workspace And Query Execution

## Summary
- Baseline as of March 10, 2026: `fnm use` resolves to Node `v24.13.0`, and `npm run verify` is green. Phase 4 can start from feature work, not harness repair.
- Because this turn is still in Plan Mode, [todo.md](/Users/orgoldfus/Workspace/personal/sparow/todo.md) was not updated. The first implementation action must rewrite it for Phase 4, then keep updating it when work starts, when a step finishes, when a blocker appears, and after every verification run.
- Preserve the current shell grid in Phase 4. The new work replaces the placeholder workspace content inside the existing regions instead of starting the broader UI redesign now.
- Keep the current single active backend session. Each SQL tab stores a target connection id, but Run is enabled only when that tab already matches the currently connected saved profile.
- Phase 4 delivers real execution, cancellation, status, and a capped result preview. Full streaming, virtualization, CSV export, and large-result performance work remain Phase 5.

## Implementation Steps
1. Kick off the phase and lock the baseline. Serial.
Update [todo.md](/Users/orgoldfus/Workspace/personal/sparow/todo.md) with the Phase 4 objective, checklist, blockers, decisions, and verification log. Re-run `fnm use` and `npm run verify` immediately and record the exact output summary.

2. Lock the query contracts and fixtures before behavior. Serial gate for all later branches.
Add matching Rust and TypeScript contracts plus JSON fixtures for `QueryExecutionRequest`, `QueryExecutionAccepted`, `QueryExecutionProgressEvent`, `QueryExecutionResult`, `QueryResultColumn`, and `CancelQueryExecutionResult`. Add a new event channel `query://execution-progress`, add runtime guards on the frontend, and add fixture-backed tests on both sides before wiring the UI or backend logic.

3. Build the Rust query subsystem. Parallel branch A after Step 2.
Create a dedicated query module in Rust that owns execution jobs, cancellation tokens, result mapping, and history recording. `start_query_execution` must reject requests when there is no active session, when the request connection id does not match the active session, when SQL is empty, or when the frontend marks the payload as multi-statement. Support one in-flight query per tab, allow concurrent runs across different tabs when they target the same active session, and return an accepted handle immediately while progress and completion arrive through events. Record every executed statement into the existing `query_history` table for debugging and future Phase 6 history UI; do not add a new migration unless implementation proves the existing table is insufficient.

4. Build the frontend SQL workspace. Parallel branch B after Step 2.
Add a dedicated query feature module with in-memory tab state, not persistence. Each tab should store `id`, derived title, SQL text, target connection id, dirty state, last execution summary, and current execution state. Replace the placeholder workspace header with a real tab rail, a `New Tab` action, connection-target status, Run, and Cancel. Default the first tab to the selected saved connection or active session when available. Closing a tab should never discard a running query silently; either block close until terminal state or require an explicit cancel first.

5. Add editor behavior and autocomplete. Parallel branch C after Step 2.
Integrate Monaco as the editor. Use a small, local, deterministic execution-slice helper: if there is a non-empty selection, run the trimmed selection; otherwise compute the current statement around the cursor, ignoring semicolons inside strings and SQL comments; if the helper cannot isolate exactly one statement, return a stable validation error instead of guessing. Register a PostgreSQL-flavored completion provider that merges local SQL keywords/snippets with cached schema names from Phase 3. Autocomplete should be schema-cache-backed only, use a short debounce, and degrade cleanly when the cache is empty or stale.

6. Integrate the branches into the app shell. Serial after Steps 3 to 5.
Keep the left rail as the connection-plus-schema workspace and replace the center area with the SQL editor. Repurpose the bottom panel from schema details to query status and last-result preview, but keep schema details reachable in the diagnostics area or a secondary panel so Phase 3 debugging stays intact. Running a query should update only the owning tab’s execution state. The diagnostics surface should show the latest query event, job id, correlation id, target connection, and terminal error if one occurred. The UI must stay interactive while queries run or cancel.

7. Add AI-friendly docs, scripts, and final verification. Parallelizable once interfaces are stable; final verification is serial.
Write a Phase 4 architecture note and extend the AI debugging/verification docs with a query-execution section: where query events come from, how cancellation works, which error codes to expect, how to inspect `query_history`, and which smoke commands to run. Add a small script to print recent query-history rows from SQLite for a chosen database path. Extend `smoke:postgres` to cover connect, open a tab, run a fast query, and cancel a long-running query. Keep `npm run verify` green without a live PostgreSQL server by default through fake drivers and mocked IPC.

## Important Interface Changes
- New Tauri commands:
  `start_query_execution(request) -> QueryExecutionAccepted`
  `cancel_query_execution(jobId) -> CancelQueryExecutionResult`
- New Tauri event:
  `query://execution-progress -> QueryExecutionProgressEvent`
- `QueryExecutionRequest` should include `tabId`, `connectionId`, `sql`, and `origin: 'selection' | 'current-statement'`.
- `QueryExecutionProgressEvent` should include `jobId`, `correlationId`, `tabId`, `connectionId`, `status`, `elapsedMs`, `message`, `startedAt`, `finishedAt`, `lastError`, and `result`.
- `QueryExecutionResult` should be an explicit union:
  `rows` result with `columns`, `previewRows`, `previewRowCount`, and `truncated`
  `command` result with `commandTag` and `rowsAffected`
- `QueryResultColumn` should include `name` and PostgreSQL type name. Preview cell values should be serialized as display-safe scalars so fixtures stay readable and deterministic.
- New stable `AppError` codes must cover at minimum: no active session, tab target mismatch, empty query, ambiguous current statement, multi-statement execution rejected, SQL execution failed, and query cancelled.

## Test Plan
- Contract tests fail when Rust, TypeScript, and fixture payloads drift for any query command or event.
- Frontend unit tests cover tab creation, switching, independent tab state, target-connection mismatch, dirty indicators, run/cancel button rules, and prevention of silent close on running tabs.
- Editor helper tests cover selection-first execution, cursor-based current-statement extraction, comments/quoted-semicolon handling, and ambiguous multi-statement rejection.
- Autocomplete tests cover keyword suggestions, cached schema suggestions, empty-cache fallback, and stale async response handling.
- Rust tests cover accepted job creation, per-tab in-flight locking, same-connection concurrent execution across tabs, active-session mismatch rejection, cancellation, and query-history recording.
- Rust result-mapping tests cover row-returning queries, command-only queries, null handling, and predictable column metadata.
- App-shell tests cover query event subscription, diagnostics rendering, and bottom-panel result preview updates.
- `npm run verify` stays green without a live database.
- `npm run smoke:postgres` verifies: connect, run a simple `select`, confirm preview rendering, start a long-running query, cancel it, and confirm the UI returns to an idle or terminal cancelled state.
- Final [todo.md](/Users/orgoldfus/Workspace/personal/sparow/todo.md) state must include the exact last verification results.

## Assumptions And Defaults
- Phase 4 does not begin the broad shell redesign; it makes the new SQL workspace feel native inside the existing layout.
- Single-statement execution only. A non-empty selection wins; otherwise run the current statement. Multi-statement selections are rejected with a stable, explicit error.
- One active backend session remains the rule in Phase 4. Tabs can point at other saved connections, but they cannot run until that target is the connected profile.
- Result handling is intentionally limited to a capped preview and command summaries. Streaming, virtualization, export, and large-result tuning are deferred to Phase 5.
- Query history may be recorded now for debugging and forward compatibility, but the user-facing history and saved-query workflows remain Phase 6.
- Prefer docs and scripts over a new repo skill in this phase; create a dedicated skill only if query debugging becomes repetitive enough that the docs are no longer sufficient.
