import {
  ChevronRight,
  Columns3,
  Eye,
  FolderTree,
  KeyRound,
  LoaderCircle,
  RefreshCcw,
  Search,
  Table2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type {
  ConnectionSummary,
  ConnectionTestResult,
  DatabaseSessionSnapshot,
  SchemaNode,
  SchemaRefreshProgressEvent,
} from '../../lib/contracts';
import type { SchemaBrowserState } from './useSchemaBrowser';

type SchemaSidebarProps = {
  activeSession: DatabaseSessionSnapshot | null;
  connections: ConnectionSummary[];
  onCreateConnection: () => void;
  onSelectConnection: (connectionId: string | null) => void;
  schema: SchemaBrowserState;
  selectedConnectionId: string | null;
};

type SchemaDetailsPanelProps = {
  activeSession: DatabaseSessionSnapshot | null;
  latestRefreshEvent: SchemaRefreshProgressEvent | null;
  latestTestResult: ConnectionTestResult | null;
  selectedNode: SchemaNode | null;
};

export function SchemaSidebar({
  activeSession,
  connections,
  onCreateConnection,
  onSelectConnection,
  schema,
  selectedConnectionId,
}: SchemaSidebarProps) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <section className="border-b border-[var(--line-soft)] bg-[var(--surface-1)]">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-3)]">Saved targets</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink-1)]">Switcher</h2>
          </div>
          <button
            className="border border-[var(--line-soft)] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-2)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink-1)]"
            onClick={onCreateConnection}
            type="button"
          >
            New
          </button>
        </div>
        <div className="grid gap-2 px-4 pb-4">
          {connections.map((connection) => {
            const isSelected = selectedConnectionId === connection.id;
            const isActive = activeSession?.connectionId === connection.id;
            return (
              <button
                className={`flex items-center justify-between border px-3 py-2 text-left transition ${
                  isSelected
                    ? 'border-[var(--line-strong)] bg-[var(--surface-0)]'
                    : 'border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-1)_90%,_white_10%)] hover:border-[var(--line-strong)]'
                }`}
                key={connection.id}
                onClick={() => {
                  onSelectConnection(connection.id);
                }}
                type="button"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--ink-1)]">{connection.name}</p>
                  <p className="text-xs text-[var(--ink-3)]">
                    {connection.database} / {connection.username}
                  </p>
                </div>
                {isActive ? <Wifi className="h-4 w-4 text-[var(--accent-strong)]" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[var(--surface-0)]">
        <div className="border-b border-[var(--line-soft)] px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderTree className="h-4 w-4 text-[var(--accent-strong)]" />
              <h3 className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--ink-3)]">Schema</h3>
            </div>
            <button
              className="inline-flex items-center gap-2 border border-[var(--line-soft)] px-2.5 py-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-2)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink-1)] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={schema.isDisabled}
              onClick={() => {
                void schema.refreshSelectedScope();
              }}
              type="button"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
          <label className="mt-3 flex items-center gap-2 border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--ink-2)]">
            <Search className="h-4 w-4 text-[var(--ink-3)]" />
            <input
              aria-label="Search schema cache"
              className="w-full bg-transparent outline-none"
              disabled={schema.isDisabled}
              onChange={(event) => {
                schema.setSearchQuery(event.currentTarget.value);
              }}
              placeholder={schema.isDisabled ? 'Connect to browse metadata' : 'Search cached schema'}
              value={schema.searchQuery}
            />
          </label>
        </div>

        <div className="min-h-0 overflow-auto px-3 py-3">
          {schema.isDisabled ? (
            <div className="border border-dashed border-[var(--line-soft)] bg-[var(--surface-1)] p-4 text-sm text-[var(--ink-2)]">
              Connect a saved PostgreSQL target to browse schemas, relations, and cached metadata.
            </div>
          ) : schema.searchQuery.trim().length > 0 ? (
            <div className="grid gap-2">
              {schema.searchResults.length > 0 ? (
                schema.searchResults.map((node) => (
                  <button
                    className="grid gap-1 border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-left transition hover:border-[var(--line-strong)]"
                    key={node.path}
                    onClick={() => {
                      schema.selectNode(node);
                    }}
                    type="button"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink-1)]">
                      {iconForNode(node)}
                      {node.name}
                    </div>
                    <p className="text-xs text-[var(--ink-3)]">{node.path}</p>
                  </button>
                ))
              ) : (
                <div className="border border-dashed border-[var(--line-soft)] bg-[var(--surface-1)] p-4 text-sm text-[var(--ink-2)]">
                  No cached matches yet. Expand a few scopes or run refresh to grow the local metadata cache.
                </div>
              )}
            </div>
          ) : (
            <div
              aria-label="Schema browser"
              className="grid gap-1 outline-none"
              data-testid="schema-tree"
              onKeyDown={(event) => {
                void handleTreeKeyDown(event, schema);
              }}
              role="tree"
              tabIndex={0}
            >
              {schema.isLoadingRoot ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ink-2)]">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Loading cached root metadata…
                </div>
              ) : schema.visibleRows.length > 0 ? (
                schema.visibleRows.map((row) => {
                  const isSelected = schema.selectedNode?.path === row.node.path;
                  return (
                    <button
                      aria-expanded={row.node.hasChildren ? row.isExpanded : undefined}
                      aria-level={row.depth + 1}
                      aria-selected={isSelected}
                      className={`flex items-center gap-2 px-3 py-2 text-left text-sm transition ${
                        isSelected ? 'bg-[var(--accent-soft)] text-[var(--ink-1)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-1)]'
                      }`}
                      data-testid={`schema-node-${row.node.path}`}
                      key={row.node.path}
                      onClick={() => {
                        schema.selectNode(row.node);
                      }}
                      onDoubleClick={() => {
                        void schema.toggleNode(row.node);
                      }}
                      role="treeitem"
                      style={{ paddingLeft: `${row.depth * 18 + 12}px` }}
                      type="button"
                    >
                      {row.node.hasChildren ? (
                        <ChevronRight
                          className={`h-3.5 w-3.5 transition ${row.isExpanded ? 'rotate-90' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void schema.toggleNode(row.node);
                          }}
                        />
                      ) : (
                        <span className="w-3.5" />
                      )}
                      {iconForNode(row.node)}
                      <span className="min-w-0 flex-1 truncate">{row.node.name}</span>
                      {row.isRefreshing ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[var(--accent-strong)]" />
                      ) : row.childScopeStatus === 'stale' ? (
                        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--danger-ink)]">Stale</span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="border border-dashed border-[var(--line-soft)] bg-[var(--surface-1)] p-4 text-sm text-[var(--ink-2)]">
                  No cached schema rows yet. Refresh the root scope to seed the browser.
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function SchemaDetailsPanel({
  activeSession,
  latestRefreshEvent,
  latestTestResult,
  selectedNode,
}: SchemaDetailsPanelProps) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[280px_280px_minmax(0,1fr)]">
      <section className="grid gap-4">
        <article className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Active session</p>
          {activeSession ? (
            <div className="mt-3 grid gap-2 text-sm text-[var(--ink-2)]">
              <p className="font-medium text-[var(--ink-1)]">{activeSession.name}</p>
              <p>
                {activeSession.database} / {activeSession.username}
              </p>
              <p>
                {activeSession.host}:{activeSession.port}
              </p>
              <p>
                SSL:{' '}
                {activeSession.sslInUse === true
                  ? 'enabled'
                  : activeSession.sslInUse === false
                    ? 'disabled'
                    : 'unknown'}
              </p>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-sm text-[var(--ink-2)]">
              <WifiOff className="h-4 w-4 text-[var(--danger-ink)]" />
              No active schema session.
            </div>
          )}
        </article>

        <article className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Latest connection test</p>
          {latestTestResult ? (
            <div className="mt-3 grid gap-2 text-sm text-[var(--ink-2)]">
              <p className="font-medium text-[var(--ink-1)]">{latestTestResult.summaryMessage}</p>
              <p>Round trip: {latestTestResult.roundTripMs ?? 'n/a'} ms</p>
              <p>Server: {latestTestResult.serverVersion ?? 'Unavailable'}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-2)]">Run a connection test to capture transport and identity details.</p>
          )}
        </article>
      </section>

      <article className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Refresh activity</p>
          <span className="text-xs text-[var(--ink-3)]">Schema events</span>
        </div>
        {latestRefreshEvent ? (
          <div className="mt-3 grid gap-2 text-sm text-[var(--ink-2)]">
            <p className="font-medium text-[var(--ink-1)]">{latestRefreshEvent.message}</p>
            <p>Status: {latestRefreshEvent.status}</p>
            <p>Scope: {latestRefreshEvent.scopePath ?? 'root'}</p>
            <p>Correlation: {latestRefreshEvent.correlationId}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--ink-2)]">Refresh events appear here as cached scopes update in the background.</p>
        )}
      </article>

      <article className="border border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-0)_92%,_white_8%)] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Selected node</p>
          <span className="text-xs text-[var(--ink-3)]">Schema detail rail</span>
        </div>
        {selectedNode ? (
          <dl className="mt-4 grid gap-3 text-sm text-[var(--ink-2)] md:grid-cols-2">
            <Metric label="Kind" value={selectedNode.kind} />
            <Metric label="Name" value={selectedNode.name} />
            <Metric label="Schema" value={selectedNode.schemaName} />
            <Metric label="Relation" value={selectedNode.relationName ?? 'n/a'} />
            <Metric label="Path" value={selectedNode.path} />
            <Metric label="Refreshed" value={formatLongTime(selectedNode.refreshedAt)} />
            {'dataType' in selectedNode ? <Metric label="Data type" value={selectedNode.dataType} /> : null}
            {'dataType' in selectedNode ? (
              <Metric label="Nullable" value={selectedNode.isNullable ? 'yes' : 'no'} />
            ) : null}
            {'columnNames' in selectedNode ? (
              <Metric label="Index columns" value={selectedNode.columnNames.join(', ') || 'n/a'} />
            ) : null}
            {'columnNames' in selectedNode ? (
              <Metric label="Unique" value={selectedNode.isUnique ? 'yes' : 'no'} />
            ) : null}
          </dl>
        ) : (
          <div className="mt-4 border border-dashed border-[var(--line-soft)] p-4 text-sm text-[var(--ink-2)]">
            Select a schema node to inspect its cached metadata without leaving the main workspace.
          </div>
        )}
      </article>
    </div>
  );
}

function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>, schema: SchemaBrowserState) {
  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault();
      void schema.handleTreeNavigation('up');
      break;
    case 'ArrowDown':
      event.preventDefault();
      void schema.handleTreeNavigation('down');
      break;
    case 'ArrowLeft':
      event.preventDefault();
      void schema.handleTreeNavigation('left');
      break;
    case 'ArrowRight':
      event.preventDefault();
      void schema.handleTreeNavigation('right');
      break;
  }
}

function iconForNode(node: SchemaNode) {
  switch (node.kind) {
    case 'schema':
      return <FolderTree className="h-4 w-4 text-[var(--accent-strong)]" />;
    case 'table':
      return <Table2 className="h-4 w-4 text-[var(--ink-3)]" />;
    case 'view':
      return <Eye className="h-4 w-4 text-[var(--ink-3)]" />;
    case 'column':
      return <Columns3 className="h-4 w-4 text-[var(--ink-3)]" />;
    case 'index':
      return <KeyRound className="h-4 w-4 text-[var(--ink-3)]" />;
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">{label}</dt>
      <dd className="mt-1 break-all text-[var(--ink-1)]">{value}</dd>
    </div>
  );
}

function formatLongTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
