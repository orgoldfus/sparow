# Phase 6 Productivity Layer

## Scope
Phase 6 adds a developer-productivity layer on top of the existing shell without changing the shell grid:

- query history listing and search
- saved-query CRUD
- a query library dialog with `History` and `Saved` tabs
- a metadata-only save-query dialog
- a command palette that merges static actions with backend search
- keyboard focus routing across connections, schema, editor, and results
- AI-friendly SQLite inspection commands and browser smoke coverage

The productivity layer is intentionally overlay-first so the upcoming UI replacement can keep the same data contracts and focus model.

## Frontend Structure
- `src/features/productivity/useProductivityWorkspace.ts` owns dialog state, debounced backend searches, save/delete flows, and command-palette item assembly.
- `src/features/productivity/useShellFocusRegistry.ts` owns explicit focus callbacks for shell zones. Components register their own focus targets; the app never guesses DOM structure.
- `src/features/productivity/QueryLibraryDialog.tsx`, `src/features/productivity/SaveQueryDialog.tsx`, and `src/features/productivity/CommandPalette.tsx` are presentation components that can be reused by the app and harnesses.
- `src/features/query/useQueryWorkspace.ts` now tracks `savedQueryId` on each tab and exposes `openQueryTab(...)` plus `updateTabMetadata(...)` so saved-query actions can create or relink tabs explicitly.

## Backend Structure
- `src-tauri/src/productivity/service.rs` owns history listing, saved-query listing, saved-query validation, save/update, and delete flows.
- `src-tauri/src/persistence/migrations/0007_productivity_layer.sql` upgrades `saved_queries` with `connection_profile_id` and `created_at`, backfills existing rows, and adds recency/search indexes.
- `src-tauri/src/persistence/repository.rs` prunes `query_history` to the newest 2,000 rows after each insert.
- New Tauri commands:
  - `list_query_history`
  - `list_saved_queries`
  - `save_saved_query`
  - `delete_saved_query`

## UX Rules
- Opening from history or saved queries always creates a new tab by default.
- `Run` is the only action allowed to auto-connect a referenced saved connection before execution.
- `Mod+S` opens the save-query dialog. If the tab already belongs to a saved query, the primary action updates that query and the dialog exposes `Save as new`.
- `Mod+K` and `Mod+Shift+P` open the command palette.
- `Mod+1/2/3/4` focus connections, schema, editor, and results respectively.
- `Ctrl+Tab` and `Ctrl+Shift+Tab` cycle tabs.
- `Mod+W` closes the active idle tab.

## Debugging Notes
- Query history is an accepted-query audit log, not a success-only log.
- Saved-query metadata edits never mutate SQL inside the dialog; SQL always comes from the active editor tab or the selected saved-query record.
- Local SQLite inspection is handled by `src-tauri/src/bin/sqlite_inspector.rs`, which is wrapped by:
  - `node ./scripts/inspect-query-history.mjs`
  - `node ./scripts/inspect-saved-queries.mjs`
  - `node ./scripts/inspect-schema-cache.mjs`
