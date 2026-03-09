# MVP Delivery Plan

## Summary
Build the MVP in 7 implementation phases, each small enough for a single AI agent to own end-to-end. The plan stays strict to the PostgreSQL-first MVP while adding the minimum North Star enablers required for speed, responsiveness, security, and a clean keyboard-first workflow.

## Important Interfaces And Core Models
The MVP should standardize these internal contracts early so later phases can build on them without redesign:
- `ConnectionProfile`: name, host, port, database, username, SSL mode, non-secret options, secret reference.
- `SecretRef` / credential adapter: keychain-backed secret lookup, write, update, delete.
- `DatabaseSession`: active connection identity, pooled client handle, status, last-used metadata.
- `SchemaNode`: schema, table, view, column, index metadata with lazy-load fields.
- `QueryTab`: tab id, title, SQL text, connection target, dirty state, execution state.
- `QueryRequest` / `QueryJobHandle`: execute, cancel, stream rows, report progress and errors.
- `ResultColumn` / `ResultChunk`: typed column metadata plus streamed row batches.
- `HistoryEntry` and `SavedQuery`: persisted query text, connection reference, timestamps, optional title/tags.

## Phase 1: Foundation And App Shell
- Goal: establish the Tauri + React + TypeScript + Rust baseline and the architectural boundaries that protect UI responsiveness.
- Requirements: create the desktop shell, frontend app shell, Rust command layer, shared typing strategy, local persistence choice, error handling, logging, and a minimal layout that can host connections, schema, editor, and results.
- Requirements: define the rule that heavy work stays in Rust/background tasks and the UI only consumes typed state and streamed updates.
- Deliverables: runnable desktop app, base navigation/layout, typed IPC contract, local data store setup, test/lint/build scripts, and a short architecture doc describing module boundaries and performance rules.
- Exit criteria: the app launches cleanly, the UI remains responsive during mocked background work, and future phases have stable extension points instead of ad hoc wiring.

## Phase 2: PostgreSQL Connection Management
- Goal: deliver the full connection lifecycle for PostgreSQL with secure credential handling.
- Requirements: support create, test, save, edit, delete, and connect flows for PostgreSQL connections.
- Requirements: store secrets in the OS keychain when possible, never in plaintext, and persist only non-secret profile metadata locally.
- Requirements: support baseline SSL configuration and clear error handling for auth, network, and certificate failures.
- Deliverables: connection management UI, Rust connection manager/pool, secure credential adapter, persistence schema for saved connections, and connection status feedback in the app shell.
- Exit criteria: a user can securely save a PostgreSQL connection, reconnect later, and recover from bad credentials or unreachable hosts without app instability.

## Phase 3: Schema Browser And Metadata Cache
- Goal: make database structure explorable without blocking the UI.
- Requirements: introspect schemas, tables, views, columns, and indexes for PostgreSQL.
- Requirements: load metadata lazily, cache it locally, and refresh it in the background so schema browsing stays fast.
- Requirements: provide search/filter over the schema tree and clear loading/error states per node.
- Deliverables: schema sidebar UI, metadata cache model, typed introspection commands, lazy tree expansion, refresh actions, and basic schema search.
- Exit criteria: users can browse large schemas fluidly, repeated opens are faster due to caching, and metadata failures do not freeze or crash the app.

## Phase 4: SQL Workspace And Query Execution
- Goal: deliver the core write-and-run workflow.
- Requirements: add a Monaco-based SQL editor with syntax highlighting, multiple tabs, per-tab connection targeting, and execution of current statement or selection.
- Requirements: provide schema-aware autocomplete using cached metadata from Phase 3.
- Requirements: execute queries asynchronously in Rust, expose execution state to the UI, and support query cancellation to preserve responsiveness.
- Deliverables: tabbed SQL workspace, query execution pipeline, cancellation flow, autocomplete provider, and per-tab execution status/error presentation.
- Exit criteria: users can work in multiple SQL tabs, run and cancel queries without UI freezes, and get useful PostgreSQL-aware editing support.

## Phase 5: Results Viewer And CSV Export
- Goal: make result exploration fast enough to satisfy the North Star.
- Requirements: stream rows incrementally from Rust to the frontend instead of loading full result sets into memory up front.
- Requirements: render results with virtualization, typed columns, loading/progress states, and stable handling for large result sets.
- Requirements: support sorting and filtering in the results viewer with MVP-safe semantics that prioritize responsiveness over full query rewriting.
- Requirements: support CSV export through a backend export path that can handle large datasets without blocking the UI.
- Deliverables: streamed results protocol, virtualized data grid, result-state UI, sort/filter controls, CSV export flow, and partial/complete result indicators.
- Exit criteria: large query results remain scrollable and responsive, export works on realistic datasets, and result browsing feels materially faster than traditional heavy clients.

## Phase 6: Developer Productivity Layer
- Goal: add the workflows that make the app usable every day, not just technically functional.
- Requirements: capture query history automatically with timestamps, connection context, and re-open/re-run affordances.
- Requirements: support saved queries with CRUD actions and quick-open behavior.
- Requirements: add core keyboard shortcuts and a command palette for the highest-frequency actions.
- Deliverables: history store and UI, saved query store and UI, command palette, shortcut map, and focus/keyboard navigation polish across connection, schema, editor, and results surfaces.
- Exit criteria: a keyboard-first user can connect, browse schema, open/run queries, revisit history, and save/reopen important queries with minimal pointer usage.

## Phase 7: Hardening, Packaging, And MVP Acceptance
- Goal: convert the functional MVP into a releasable macOS-first product.
- Requirements: validate startup speed, query responsiveness, large-result behavior, credential safety, and failure recovery against the North Star principles.
- Requirements: add automated coverage for the highest-risk flows and manual smoke-test scripts for end-to-end desktop behavior.
- Requirements: package the app for macOS while keeping code paths cross-platform-safe for later Linux/Windows expansion.
- Deliverables: end-to-end smoke suite, performance/regression checklist, release build pipeline, packaging/signing plan if needed, user-facing MVP documentation, and a known-limitations list.
- Exit criteria: the team has a shippable MVP build, clear acceptance evidence for the core workflow, and a short list of intentional post-MVP gaps.

## Test Plan
- Cold start launches into a usable shell without visible blocking.
- Saved PostgreSQL connections persist across restarts and secrets stay outside plaintext storage.
- Invalid credentials, SSL issues, and dropped connections surface actionable errors.
- Schema browsing remains responsive on large databases and supports lazy expansion.
- Multiple editor tabs preserve independent SQL text and execution state.
- Long-running queries can be canceled without freezing the UI.
- Large result sets stream incrementally and stay smooth while scrolling.
- CSV export succeeds on non-trivial datasets and does not block the interface.
- Query history and saved queries persist correctly.
- Core shortcuts and command palette actions work without mouse dependency.

## Assumptions And Defaults
- PostgreSQL is the only supported database in the MVP.
- The MVP release target is macOS first; architecture remains compatible with later Linux/Windows packaging.
- North Star work is included only where it directly protects MVP quality: typed IPC, async execution, streaming results, cancellation, secure secrets, lazy metadata, and performance validation.
- Result-grid sorting and filtering should use MVP-safe behavior that preserves responsiveness; full SQL-aware result rewriting is out of scope unless later planning explicitly adds it.
- SSH tunnels, multi-database support, data editing, visual analytics, collaboration features, plugins, and cloud sync are post-MVP.
