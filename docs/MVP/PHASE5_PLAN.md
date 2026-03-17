# Phase 5 Plan: Result Viewer, Direct Query Windows, And CSV Export

## Current Direction
- Phase 5 keeps the dense result viewer, export flow, and browser harness, but does not use a SQLite result cache.
- Row-returning queries now follow two execution paths:
  - Replayable SQL stores lightweight Rust metadata and reruns directly against PostgreSQL for result windows and export.
  - Non-replayable row-returning SQL falls back to an in-memory Rust buffer so behavior stays deterministic without persisting rows to SQLite.
- `query://execution-progress` remains the lifecycle event for query execution. There is no separate result-stream event.

## Result Semantics
- `QueryExecutionProgressEvent.result` carries either a command result or a `QueryResultSetSummary`.
- `get_query_result_window` returns windowed rows for the active result set using the current sort and filter descriptors.
- Sort and filter remain viewer semantics. Replayable queries apply them through SQL rewrite against PostgreSQL; buffered queries apply them in Rust against the in-memory rows.
- `start_query_result_export` and `cancel_query_result_export` export the current viewer shape without writing row caches to SQLite.

## Persistence Scope
- SQLite remains the local persistence layer for app state such as connections, schema cache, and query history.
- Query result rows are no longer persisted in SQLite.
- The append-only migration `0006_drop_query_result_cache.sql` removes the old `query_result_sets` and `query_result_rows` tables for upgraded installs.

## Verification Focus
- Contract tests must cover the result summary, result window, and export payloads.
- Rust tests must cover direct replay windowing, buffered fallback behavior, export success and cancellation, and command-query behavior.
- Frontend tests must cover query workspace state, result loading, filtering, sorting, export progress, and diagnostics updates.
- Browser smoke should continue to exercise the harness and the dense result grid.

## Historical Note
- Earlier Phase 5 planning explored a SQLite-backed result cache and a separate result-stream event. That approach was removed on March 16, 2026 after repeated reliability issues around cache lifecycle and correctness.
