# Phase 3 Todo

## Objective
Build the Phase 3 PostgreSQL schema browser and metadata cache for Sparow: active-session-driven schema exploration, a queryable SQLite metadata cache, dedicated schema refresh events, and AI-friendly debugging and verification that stay green without a live database by default.

## Checklist
- [completed] Review the current unresolved CodeRabbit feedback, verify each finding against the latest code, and apply only still-valid fixes
- [completed] Verify and fix swallowed `persist_refresh_failure` task/repository errors in the schema service
- [completed] Fix cross-connection schema cache ID collisions that block remote PostgreSQL schema refreshes
- [completed] Review unresolved CodeRabbit feedback, verify each finding against current code, and apply only still-valid fixes
- [completed] Preserve failed schema scope refresh status through cache loads and retry classification
- [completed] Investigate and fix schema expansion hanging on column deserialization panic
- [completed] Stabilize the Phase 3 baseline and record verification results
- [completed] Lock schema contracts, JSON fixtures, and runtime guards in Rust and TypeScript
- [completed] Extend SQLite with Phase 3 schema cache tables, indexes, and repository methods
- [completed] Implement the Rust schema subsystem with runtime and fake drivers
- [completed] Add schema commands, refresh events, diagnostics integration, and app-state wiring
- [completed] Build the frontend schema workspace while preserving Phase 2 connection flows
- [completed] Add frontend and backend coverage for schema browsing, refresh, and cache fallback flows
- [completed] Extend smoke coverage, debugging docs, and schema cache inspection tooling
- [completed] Run final Phase 3 verification and record results

## Blockers And Decisions
- Current blocker: none.
- Database engine: PostgreSQL only.
- Schema browser scope: active saved-profile-backed PostgreSQL session only.
- Metadata scope: schemas, tables, views, columns, and indexes only.
- Search scope: cached metadata only; no live global catalog search in Phase 3.
- Cache freshness: cached schema scopes become stale after 2 minutes and should refresh in the background.
- Root scope persistence: SQLite stores the root scope path as an empty string; the TypeScript boundary uses `null`.
- Schema cache identity: `schema_cache.id` is globally unique in SQLite, so generated schema node IDs must be namespaced by connection.
- Testing strategy: default verification uses a deterministic fake schema driver; real PostgreSQL schema smoke remains opt-in.

## Verification
- `cargo test --manifest-path src-tauri/Cargo.toml schema::service::tests::persist_refresh_failure_returns_repository_errors -- --exact` ✅
  - The schema service now returns repository/join failures from `persist_refresh_failure` instead of swallowing the `spawn_blocking` outcome.
- `npm run verify` ✅
  - Typecheck, lint, Vitest, foundation smoke, and Rust tests all passed after closing the remaining CodeRabbit findings in the schema parser, contract guards, and cache inspection script.
- `npm run verify` ❌
  - Frontend checks passed, but Rust failed because the new schema path helpers in `src-tauri/src/schema/service.rs` referenced `SchemaNodeKind` without importing it.
- `npm run verify` ❌
  - Typecheck, lint, Vitest, foundation smoke, and Rust tests all passed after namespacing schema cache IDs by connection for cross-database safety.
- `cargo test --manifest-path src-tauri/Cargo.toml schema::service::tests::schema_node_ids_are_namespaced_by_connection -- --exact` ✅
  - The new schema ID regression test passed after namespacing generated cache IDs by connection.
- `npm run verify` ✅
  - Typecheck, lint, Vitest, foundation smoke, and Rust tests all passed after the CodeRabbit autofixes and regression coverage updates.
- `cargo test --manifest-path src-tauri/Cargo.toml persistence::repository::tests::replaces_schema_scope_by_clearing_descendant_cache_rows -- --exact` ✅
  - The recursive subtree cleanup regression test passed after switching scope deletion from string-prefix matching to graph-based descendant traversal.
- `npm run verify` ❌
  - Frontend checks passed, but Rust failed in `persistence::repository::tests::replaces_schema_scope_by_clearing_descendant_cache_rows`; the first subtree cleanup patch used string-prefix scope matching, which does not cover kind-prefixed descendant scope paths like `table/public/users`.
- `npm run verify` ❌
  - Failed in lint on `src/test/contract-fixtures.test.ts` because the new invalid-schema-node test kept an unused `_kind` binding.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Full Rust suite passed after preserving schema scope `refresh_status` on cache loads and retry classification.
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Full Rust suite passed, including the new schema refresh panic regression test.
- `npm run verify` ✅
  - Typecheck, lint, Vitest, foundation smoke, and Rust tests all passed after the schema refresh panic guard and PostgreSQL `relkind::text` fix.
- `cargo test --manifest-path src-tauri/Cargo.toml schema::service::tests::releases_in_flight_refresh_when_driver_panics -- --exact` ✅
  - Added panic-regression coverage for schema refresh cleanup; the new backend test passed.
- `fnm use` ✅
  - `Using Node v24.13.0`
- `npm run verify` ✅
  - Frontend typecheck, lint, tests, foundation smoke, and Rust tests all passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` ❌
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
  - Phase 3 backend contracts, repository tests, and schema service tests passed.
- `npm run verify` ❌
  - Failed in lint on `src/features/schema/useSchemaBrowser.ts` (`useEffectEvent` called outside effects/effect events) and `src/test/schema-browser.test.tsx` (`async` test callback without `await`).
- `npm run verify` ❌
  - Failed in test run after lint fixes because `useSchemaBrowser` referenced `loadScope` before initialization, breaking the app shell and schema browser tests.
- `npm run test` ✅
  - Frontend contract, shell, foundation smoke, and schema browser tests all passed after fixing the schema hook dependency regression.
- `npm run verify` ✅
  - Typecheck, lint, Vitest, `smoke:foundation`, and Rust tests all passed after the schema hook and repository cleanup fixes.

## Dependency Notes
- Keep the current Node 24 baseline and `happy-dom` frontend test environment unless a concrete Phase 3 compatibility issue forces a change.
- Reuse the existing PostgreSQL runtime stack for schema introspection unless implementation uncovers a real blocker.
