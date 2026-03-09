# Phase 3 Plan: Schema Browser And Metadata Cache

## Summary
- Phase 3 turns the Phase 2 connection workspace into an active-session-driven PostgreSQL schema browser with a local metadata cache.
- Current baseline as of March 9, 2026: `npm run verify` passes, so implementation can start from feature work rather than test-harness repair.
- `todo.md` was not updated in this turn because Plan Mode does not allow repo mutations. The first implementation action must rewrite `todo.md` for Phase 3 and keep updating it throughout the phase.

## Implementation Steps
1. Kick off Phase 3 and lock the baseline. Serial.
- Update `todo.md` with a Phase 3 objective, checklist, blockers, decisions, and a verification section.
- Run `fnm use` and `npm run verify` immediately and record exact outcomes in `todo.md`.
- Keep all Phase 2 connection flows working; Phase 3 adds schema browsing and cache behavior, it does not replace connection management.

2. Lock the schema contracts and fixtures before behavior. Serial.
- Add matching Rust and TypeScript contracts for:
  - `SchemaNode`
  - `ListSchemaChildrenRequest`
  - `ListSchemaChildrenResult`
  - `RefreshSchemaScopeRequest`
  - `SchemaRefreshAccepted`
  - `SchemaRefreshProgressEvent`
  - `SchemaSearchRequest`
  - `SchemaSearchResult`
- `SchemaNode` should be an explicit union for `schema`, `table`, `view`, `column`, and `index`.
- Every `SchemaNode` must include `id`, `connectionId`, `kind`, `name`, `path`, `parentPath`, `schemaName`, `relationName`, `hasChildren`, and `refreshedAt`.
- Kind-specific fields must be explicit:
  - columns: `dataType`, `isNullable`, `ordinalPosition`
  - indexes: `columnNames`, `isUnique`
  - tables/views: `schemaName`, `relationName`
- Do not preload schema data in `AppBootstrap`; load it through dedicated schema IPC so boot remains small and explicit.
- Add JSON fixtures and fixture-backed tests for every new request, response, and event before backend or UI wiring.

3. Build the Rust schema subsystem. Starts after Step 2. Parallel branch A.
- Create a dedicated `src-tauri/src/schema/` module.
- Add a `SchemaIntrospectionDriver` trait.
- Add a real PostgreSQL implementation that uses the currently active Rust-owned session/pool.
- Add a deterministic fake driver for unit tests and default verification.
- Live schema browsing is allowed only for the active session. If the frontend requests another `connectionId`, return a stable `AppError`.
- Implement three introspection scopes:
  - root: user-visible schemas only, excluding `pg_catalog`, `information_schema`, temp schemas, and toast schemas
  - schema: tables and views only
  - relation: columns first, then indexes
- Refresh policy:
  - read cached children first
  - mark cache older than 2 minutes as stale
  - start a background refresh for stale or missing scopes
  - if live refresh fails but cache exists, return cached nodes marked stale and surface the failure in diagnostics
  - if live refresh fails and cache does not exist, return the error
- Deduplicate refresh jobs by `(connectionId, scopePath)` so repeated expansions do not spawn overlapping work.

4. Extend SQLite for a queryable, debuggable cache. Starts after Step 2. Parallel branch B.
- Add append-only migration `0003_schema_browser.sql`.
- Keep the existing `schema_cache` table, but extend it with:
  - `display_name`
  - `parent_path`
  - `schema_name`
  - `relation_name`
  - `position`
  - `has_children`
- Add a new `schema_cache_scopes` table keyed by `(connection_profile_id, scope_path)` with:
  - `scope_kind`
  - `refreshed_at`
  - `refresh_status`
- Persist the root scope as an empty string in SQLite. Use `null` only at the TypeScript boundary.
- Add indexes for `(connection_profile_id, parent_path)`, `(connection_profile_id, display_name)`, and `(connection_profile_id, scope_path)`.
- Repository methods must support:
  - replace one scope transactionally
  - list cached children by parent
  - search cached nodes for one connection
  - read scope freshness
  - clear cache for one connection on demand

5. Build the frontend schema workspace on mocked IPC first. Starts after Step 2. Parallel branch C.
- Add a dedicated `src/features/schema/` feature module instead of extending the Phase 2 connection components directly.
- Evolve the left rail into two stacked sections:
  - compact saved-connections switcher at the top
  - schema browser below it
- Keep the current central connection editor for Phase 3 so Phase 2 management flows remain available.
- Repurpose the bottom panel to show selected schema-node details and latest refresh state.
- Schema browser behavior:
  - disabled with a clear empty state until a saved profile is actively connected
  - dense tree rows with explicit icons for schema/table/view/column/index
  - per-node loading, stale, and error states
  - root refresh action plus refresh for the selected schema or relation
  - keyboard navigation: up/down moves selection, right expands or loads, left collapses
- Search behavior:
  - search only the local cache for the active connection
  - debounce by about 150 ms
  - selecting a result expands its cached ancestor chain and focuses the matching node
- Frontend code must continue talking to Tauri only through `src/lib/ipc.ts`.

6. Integrate background refresh events and diagnostics. Serial integration after Steps 3-5.
- Add a dedicated schema refresh event channel instead of reusing the Phase 1 mock-job event.
- Subscribe to both event streams in the app shell and surface schema refresh activity in diagnostics.
- Diagnostics should show `correlationId`, `scopePath`, refresh status, and the latest schema error.
- When the active session changes or disconnects, clear only in-memory schema UI state. Do not wipe SQLite cache automatically.

7. Add AI-friendly debug tooling and docs. Starts once interfaces are stable. Parallel branch D.
- Extend `docs/ai/debugging-playbook.md` and `docs/ai/verification.md` with a schema-browser section.
- Add a small script such as `scripts/inspect-schema-cache.mjs` that prints cached scopes and nodes for a connection id and optional scope path.
- If the PostgreSQL catalog SQL becomes non-trivial, add a short architecture note documenting which catalogs are queried and why.
- Do not add a new repo skill unless Phase 3 exposes repeated schema-debug work that docs and scripts cannot cover cleanly.

## Important Interface Changes
- New IPC commands:
  - `list_schema_children(request) -> ListSchemaChildrenResult`
  - `refresh_schema_scope(request) -> SchemaRefreshAccepted`
  - `search_schema_cache(request) -> SchemaSearchResult`
- New event:
  - `schema://refresh-progress -> SchemaRefreshProgressEvent`
- `ListSchemaChildrenResult` must include:
  - `nodes`
  - `cacheStatus: 'empty' | 'fresh' | 'stale'`
  - `refreshInFlight: boolean`
  - `refreshedAt: string | null`
- `SchemaRefreshProgressEvent` must include:
  - `connectionId`
  - `scopePath`
  - `scopeKind`
  - `status`
  - `nodesWritten`
  - `timestamp`
  - `lastError`
- New stable `AppError` codes should cover at minimum:
  - no active session
  - wrong connection selected
  - refresh already running
  - introspection query failed
  - cache read failed
  - cache write failed

## Test Plan
- Contract tests fail if schema fixtures drift from Rust or TypeScript types.
- Repository tests cover migration `0003`, scope replacement, scope freshness, search behavior, and per-connection cache isolation.
- Rust service tests cover:
  - root/schema/relation mapping from fake metadata
  - stale-cache fallback when live refresh fails
  - browsing without an active session
  - duplicate refresh dedupe
- Frontend tests cover:
  - disconnected empty state
  - expand schema -> show cached children -> receive refresh update
  - stale badge and manual retry
  - search result selection expands ancestors
  - keyboard tree navigation
  - diagnostics rendering schema refresh failures with correlation ids
- Extend `npm run smoke:postgres` so a real PostgreSQL database can verify:
  - list schemas
  - expand one schema
  - load one table’s columns
- `npm run verify` must remain green without a real database; default tests use the fake schema driver.

## Assumptions And Defaults
- Phase 3 supports only the active PostgreSQL session; browsing saved-but-disconnected profiles is out of scope.
- Scope is limited to schemas, tables, views, columns, and indexes.
- Sequences, functions, triggers, materialized views, and system schemas are out of scope for Phase 3.
- Schema search is cache-backed only; there is no live global catalog search in this phase.
- The shell grid stays stable; Phase 3 adds schema browsing and metadata detail states without introducing the SQL editor yet.
- `todo.md` must be updated throughout implementation, but that work begins only when Plan Mode ends.
