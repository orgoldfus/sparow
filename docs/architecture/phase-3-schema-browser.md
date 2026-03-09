# Phase 3 Schema Browser Architecture

## Purpose
Phase 3 adds an active-session-driven schema browser without moving heavy metadata work into React. The browser reads cached metadata first, refreshes in Rust, and exposes every state transition through typed commands or events.

## Runtime Rules
- React never queries PostgreSQL catalogs directly.
- Rust owns scope parsing, cache freshness, PostgreSQL introspection, and cache writes.
- The schema browser only operates against the currently active saved connection.
- Schema refresh events use `schema://refresh-progress` and are separate from the Phase 1 mock job channel.

## Scope Model
- `root`: visible user schemas
- `schema/<name>`: tables and views in one schema
- `table/<schema>/<name>` or `view/<schema>/<name>`: columns first, then indexes

## Cache Model
- `schema_cache` stores one row per cached node plus denormalized columns for querying and debugging.
- `schema_cache_scopes` stores one row per scope with freshness metadata.
- SQLite persists the root scope as an empty string. The frontend uses `null`.
- Cached scopes older than 2 minutes are stale and should trigger a background refresh.

## PostgreSQL Catalog Queries
- Root scope reads `pg_namespace`, excluding `pg_catalog`, `information_schema`, `pg_toast%`, and `pg_temp_%`.
- Schema scope reads `pg_class` joined with `pg_namespace`, limited to tables and views.
- Relation scope reads `pg_attribute` for columns and `pg_index` / `pg_class` for indexes.
