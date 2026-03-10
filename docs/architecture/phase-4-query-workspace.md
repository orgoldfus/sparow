# Phase 4 Query Workspace Architecture

## Purpose
Phase 4 adds a native-feeling SQL workspace on top of the existing shell without moving execution logic into React. React owns tabs, editor state, and event-driven rendering. Rust owns execution jobs, cancellation, PostgreSQL I/O, result shaping, and query-history persistence.

## Runtime Rules
- React never talks to PostgreSQL directly.
- Rust accepts queries only for the currently active saved connection.
- Each tab stores its own target connection id, SQL text, dirty state, and last execution summary.
- Only one query may run per tab at a time. Different tabs may run concurrently if they target the same active session.
- Query lifecycle events use `query://execution-progress`.

## Command And Event Flow
1. React resolves the execution slice from Monaco.
2. React calls `start_query_execution` through `src/lib/ipc.ts`.
3. Rust validates the request, records query history, creates a cancellable job, and returns `QueryExecutionAccepted`.
4. Rust emits `queued`, `running`, and terminal query events through `query://execution-progress`.
5. React updates only the owning tab from those events and renders the latest result preview in the bottom panel.
6. Cancel calls `cancel_query_execution(jobId)`, which triggers the same terminal event flow with a cancelled status.

## Frontend Responsibilities
- `src/features/query/useQueryWorkspace.ts` owns tab state and query-event reduction.
- `src/features/query/QueryWorkspace.tsx` renders the tab rail, target selector, Monaco editor, and run/cancel controls.
- `src/features/query/sqlStatement.ts` resolves one executable statement at a time and rejects ambiguous cursor placement.
- `src/features/query/sqlAutocomplete.ts` merges static PostgreSQL suggestions with schema-cache search results.

## Backend Responsibilities
- `src-tauri/src/query/service.rs` owns request validation, per-tab in-flight locking, job registration, cancellation, and history recording.
- `src-tauri/src/query/driver.rs` owns PostgreSQL execution, cancel-token wiring, and result normalization.
- `src-tauri/src/persistence/repository.rs` persists query-history rows for debugging and future history UI work.

## Result Model
- `rows` results contain `columns`, `previewRows`, `previewRowCount`, and `truncated`.
- `command` results contain `commandTag` and `rowsAffected`.
- Preview cells are serialized as display-safe scalars so fixtures stay deterministic and readable.

## Debugging Surfaces
- The diagnostics panel shows recent query events, including status, job id, connection id, correlation id, and terminal error codes.
- `query_history` in SQLite records every accepted query statement with its saved connection id.
- `scripts/inspect-query-history.mjs` prints recent query-history rows without opening SQLite manually.
