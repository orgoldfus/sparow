# Query Execution Research And Recommendation

Last updated: 2026-03-22

## Purpose
This note captures a GitHub research pass on how widely used open source database tools execute queries, browse large result sets, and avoid freezing the UI. The goal is to turn that research into a concrete recommendation for Sparow's query architecture.

## Question
Should Sparow keep the current direct-to-database query approach without a persistent row cache, keep limiting result windows, and continue treating large results as database-backed state instead of persisting them locally?

## Short Answer
Yes, with one important adjustment.

Sparow should keep the current no-SQLite-result-cache direction and keep replayable queries database-backed. The main change to make is replacing the current append-only in-memory replayable row cache with a bounded page cache or window cache, so long scrolling sessions do not grow Rust memory without bound.

## Current Sparow Behavior
- Query result rows are not persisted to SQLite. See [docs/MVP/PHASE5_PLAN.md](../MVP/PHASE5_PLAN.md).
- Replayable `SELECT` queries fetch an initial window, then re-run wrapped SQL with `LIMIT` and `OFFSET` for later result windows. See [src-tauri/src/query/driver.rs](../../src-tauri/src/query/driver.rs).
- Replayable sort and filter state are pushed back into SQL, and exact counts are computed asynchronously with a separate `count(*)` query. See [src-tauri/src/query/service.rs](../../src-tauri/src/query/service.rs).
- Non-replayable row-returning queries are buffered in memory and rejected if they exceed safety limits. See [src-tauri/src/query/service.rs](../../src-tauri/src/query/service.rs).
- Replayable result rows currently accumulate in an append-only in-memory cache keyed by the active viewer descriptor. See [src-tauri/src/query/result_store.rs](../../src-tauri/src/query/result_store.rs).

## Repositories Reviewed

### DBeaver
- Repo: <https://github.com/dbeaver/dbeaver>
- Approximate stars at research time: 49k+
- Most relevant files:
  - <https://github.com/dbeaver/dbeaver/blob/devel/plugins/org.jkiss.dbeaver.model/src/org/jkiss/dbeaver/ModelPreferences.java>
  - <https://github.com/dbeaver/dbeaver/blob/devel/plugins/org.jkiss.dbeaver.model/src/org/jkiss/dbeaver/model/impl/sql/QueryTransformerLimit.java>
  - <https://github.com/dbeaver/dbeaver/blob/devel/plugins/org.jkiss.dbeaver.ui.editors.data/src/org/jkiss/dbeaver/ui/controls/resultset/ResultSetViewer.java>
  - <https://github.com/dbeaver/dbeaver/blob/devel/plugins/org.jkiss.dbeaver.ui.editors.data/src/org/jkiss/dbeaver/ui/controls/resultset/ResultSetJobDataRead.java>

Observed behavior:
- Default result handling is segmented.
- DBeaver defaults `resultset.reread.on.scroll` to `true` and `resultset.maxrows` to `200`.
- It can rewrite SQL to add `LIMIT` and `OFFSET`, but the SQL-transform path is optional, not the only strategy.
- It also supports statement-level limit handling instead of always rewriting SQL text.
- The viewer can auto-fetch the next segment while scrolling.

Interpretation:
- DBeaver does not rely on a persistent local row cache as the primary answer to large result sets.
- Its default behavior favors bounded reads and re-fetching or segmented loading over full local materialization.

### Beekeeper Studio
- Repo: <https://github.com/beekeeper-studio/beekeeper-studio>
- Approximate stars at research time: 22k+
- Most relevant files:
  - <https://github.com/beekeeper-studio/beekeeper-studio/blob/master/apps/studio/src/lib/db/clients/utils.ts>
  - <https://github.com/beekeeper-studio/beekeeper-studio/blob/master/apps/studio/src/lib/db/clients/BasicDatabaseClient.ts>
  - <https://github.com/beekeeper-studio/beekeeper-studio/blob/master/apps/studio/src/lib/db/clients/postgresql.ts>
  - <https://github.com/beekeeper-studio/beekeeper-studio/blob/master/apps/studio/src/components/tableview/TableTable.vue>

Observed behavior:
- Table browsing uses generated `SELECT ... LIMIT ... OFFSET ...` queries.
- Table browsing also runs a separate count query.
- Arbitrary query execution supports cursor-like streaming paths (`queryStream`, `selectTopStream`).
- The PostgreSQL streaming path still calls a helper that executes the query once to discover columns and total rows before returning a cursor.

Interpretation:
- Beekeeper clearly separates browseable table data from arbitrary query execution.
- It does not push everything into a persistent local cache.
- Its biggest weakness is double work for some streamed queries because metadata and totals are derived by running the query eagerly before opening the stream.

### DbGate
- Repo: <https://github.com/dbgate/dbgate>
- Approximate stars at research time: 6.8k+
- Most relevant files:
  - <https://github.com/dbgate/dbgate/blob/master/packages/api/src/proc/sessionProcess.js>
  - <https://github.com/dbgate/dbgate/blob/master/packages/api/src/utility/handleQueryStream.js>
  - <https://github.com/dbgate/dbgate/blob/master/packages/web/src/tabs/QueryTab.svelte>
  - <https://github.com/dbgate/dbgate/blob/master/plugins/dbgate-plugin-postgres/src/backend/drivers.js>
  - <https://github.com/dbgate/dbgate/blob/master/plugins/dbgate-plugin-mysql/src/backend/drivers.js>

Observed behavior:
- Query execution is stream-oriented in the backend.
- Drivers push rows directly to stream handlers instead of materializing large full result sets first.
- The SQL editor exposes a user-configurable `limitRows` setting.
- When the stream exceeds the limit, DbGate stops the query and reports overflow.

Interpretation:
- DbGate treats large result handling as a transport and safety problem, not a persistence problem.
- The core idea is bounded streaming plus cancellation, not local result storage.

### DB Browser For SQLite
- Repo: <https://github.com/sqlitebrowser/sqlitebrowser>
- Approximate stars at research time: 23k+
- Most relevant files:
  - <https://github.com/sqlitebrowser/sqlitebrowser/blob/master/src/sqlitetablemodel.h>
  - <https://github.com/sqlitebrowser/sqlitebrowser/blob/master/src/RowLoader.cpp>
  - <https://github.com/sqlitebrowser/sqlitebrowser/blob/master/src/sqlitetablemodel.cpp>

Observed behavior:
- The data browser keeps rows in memory, not in a durable local result cache.
- It appends `LIMIT` and `OFFSET` when the query does not already contain them.
- It fetches rows in chunks and can backfill total row count after the first chunk.
- The code comments explicitly acknowledge that deep `OFFSET` paging can still become expensive in SQLite.

Interpretation:
- Even a tool dedicated to one embedded engine still prefers chunked in-memory browsing over a persistent result cache.
- It also demonstrates the main weakness of a plain `OFFSET` strategy for deep navigation.

### pgAdmin 4
- Repo: <https://github.com/pgadmin-org/pgadmin4>
- Approximate stars at research time: 3.5k+
- Most relevant files:
  - <https://github.com/pgadmin-org/pgadmin4/blob/master/web/pgadmin/tools/sqleditor/utils/query_tool_preferences.py>
  - <https://github.com/pgadmin-org/pgadmin4/blob/master/web/pgadmin/tools/sqleditor/command.py>
  - <https://github.com/pgadmin-org/pgadmin4/blob/master/web/pgadmin/tools/sqleditor/__init__.py>

Observed behavior:
- pgAdmin exposes a `server_cursor` option for large datasets.
- The preference text explicitly says the server-side cursor is meant to avoid loading the full dataset into memory.
- Table-oriented view-data commands use bounded result counts such as first 100 rows.
- Pagination state is tracked separately from the full dataset.

Interpretation:
- pgAdmin treats large-result browsing as a cursor/pagination problem.
- It does not assume full client-side materialization is the right default.

## Cross-Repository Patterns
- None of the reviewed tools use a persistent local cache of live query result rows as the primary strategy.
- The common patterns are:
  - segmented reads
  - server-side cursors or streaming
  - generated page queries with `LIMIT` and `OFFSET`
  - explicit safety limits for arbitrary query execution
  - asynchronous or deferred row counts
- Tools tend to distinguish between:
  - browseable, replayable data that can be re-queried safely
  - arbitrary editor queries that may need streaming or stricter safety limits
- The main failure modes they are avoiding are:
  - UI freezes
  - large memory spikes
  - stale or incorrect persisted row caches
  - excessive hidden work before the first result rows render

## What This Means For Sparow

### What Sparow Is Already Doing Right
- The current decision to stop persisting result rows in SQLite is aligned with the market.
- The replayable-query path is directionally correct:
  - first page quickly
  - later windows on demand
  - viewer sort/filter pushed into SQL
  - exact count in the background
- The buffered fallback for non-replayable queries is also directionally correct, especially with explicit hard limits.

### The Main Weakness In The Current Design
The current replayable result cache grows monotonically as the user scrolls because later windows are appended to one `Vec` in memory.

That is a reasonable first implementation, but it does not scale well to:
- very long scrolling sessions
- repeated deep navigation
- multiple open result tabs
- future support for larger default windows or richer cell payloads

In other words, Sparow removed the SQLite cache correctly, but it still has an unbounded in-memory row accumulation problem for replayable results.

## Recommendation

### Keep
- Keep the no-SQLite-result-cache architecture.
- Keep the split between replayable queries and buffered fallback queries.
- Keep asynchronous exact counts instead of blocking the first render on `count(*)`.
- Keep database-backed export for replayable results.
- Keep explicit safety limits for non-replayable result buffering.

### Change
- Replace the append-only replayable row cache with a bounded page cache.
- Cache pages by a stable key that includes:
  - `result_set_id`
  - sort signature
  - filter signature
  - quick-filter signature
- Evict old pages with a simple LRU or distance-from-viewport policy.
- Prefer returning only the requested page window plus a small prefetch margin instead of storing every page ever seen.

### Do Not Do
- Do not reintroduce a SQLite-backed live result cache.
- Do not automatically rewrite every ad-hoc editor query with a hard SQL `LIMIT` by default.
- Do not make exact total row count a prerequisite for first paint.
- Do not make React own any heavy query paging or result shaping logic.

## Recommended Query Strategy By Result Type

### Replayable `SELECT`
Recommended behavior:
1. Run the statement once to obtain columns and the first page.
2. Store only lightweight metadata plus a bounded in-memory page cache.
3. Fetch later pages by re-running wrapped SQL with viewer sort/filter state.
4. Compute exact counts asynchronously and only when useful.
5. Export by reading database-backed windows, not by depending on a full in-memory copy.

Why:
- Fast first paint
- bounded memory
- deterministic viewer state
- no persistent row-cache correctness problem

### Non-Replayable Row-Returning SQL
Recommended behavior:
- Keep the current buffered fallback.
- Keep hard row and byte limits.
- Return a clear error when the result is too large to buffer safely.
- In a later phase, consider a stream-only mode for some statements if PostgreSQL metadata and UX constraints can be kept deterministic.

Why:
- Many non-replayable queries cannot safely support arbitrary refetch, filtering, and export semantics.
- The current hard-fail behavior is safer than pretending those results are cheaply replayable.

### Table/Data Browsing Flows
Recommended behavior:
- Continue treating these as strongly replayable.
- Favor explicit page queries and stable ordering.
- Consider keyset pagination later for deep-scroll performance when a stable unique ordering is available.

Why:
- Table browsing has much better structure than arbitrary editor SQL and is the best place to optimize deeper paging behavior.

## `LIMIT/OFFSET` Versus Cursor Guidance

### For Now
Use the current replayable window model for PostgreSQL, but bound the cache.

Rationale:
- It matches the current architecture.
- It keeps behavior easy to reason about.
- It is already compatible with export, filtering, and sorting.
- It avoids taking on cursor lifecycle complexity immediately.

### Later Optimization
Add a PostgreSQL cursor path for sequential scrolling and export workloads.

Good candidates:
- long forward-only browsing sessions
- export of very large replayable result sets
- cases where deep `OFFSET` cost becomes measurable

Caveat:
- Cursor-backed browsing is not free. It introduces transaction and lifecycle complexity, cancellation edge cases, and more connection-state management.
- Cursor mode should be an optimization path, not the only result model.

## Concrete Implementation Direction
- Refactor `ReplayableQueryResultHandle` so it stores page metadata and a bounded page map instead of one append-only row vector.
- Keep `QueryResultSetSummary` lightweight and continue exposing:
  - current buffered row count
  - optional total row count
  - has-more state
- Preserve the current async count path.
- Preserve the current replayable export path.
- Add diagnostics for:
  - page fetch count
  - page cache hits and misses
  - evictions
  - deep-offset fetch timings

## Proposed Decision
Sparow should standardize on this rule:

> Live query results are ephemeral, Rust-owned, and database-backed when replayable. Sparow does not persist result rows locally. It fetches only bounded windows, counts asynchronously, and keeps only a bounded in-memory page cache.

## Why This Fits The North Star
- It protects fast startup by avoiding local result-cache complexity.
- It protects UI responsiveness by keeping heavy work in Rust and keeping window sizes bounded.
- It keeps behavior explicit instead of hiding correctness behind a fragile cache.
- It leaves room for future cursor-based optimization without forcing that complexity into the MVP path.
