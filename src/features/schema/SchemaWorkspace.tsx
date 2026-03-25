import { ChevronRight, FolderTree, LoaderCircle, RefreshCcw, Search, Table2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Badge } from '../../components/ui/badge';
import { ScrollArea } from '../../components/ui/scroll-area';
import { cn } from '../../lib/utils';
import type {
  DatabaseSessionSnapshot,
  SchemaNode,
} from '../../lib/contracts';
import type { SchemaBrowserState } from './useSchemaBrowser';

type SchemaSidebarProps = {
  activeSession: DatabaseSessionSnapshot | null;
  schema: SchemaBrowserState;
};

export function SchemaSidebar({ activeSession, schema }: SchemaSidebarProps) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-t border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-sidebar)_94%,_black_6%)]">
      <div className="px-4 py-2.5">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Schema</p>
            {activeSession?.database ? (
              <p className="truncate text-xs text-[var(--text-secondary)]">{activeSession.database}</p>
            ) : null}
          </div>
          <button
            aria-label="Refresh schema"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition hover:bg-[var(--surface-panel-hover)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-30"
            disabled={schema.isDisabled}
            onClick={() => { void schema.refreshSelectedScope(); }}
            type="button"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        {!schema.isDisabled ? (
          <div className="mt-2">
            <label className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1.5">
              <Search className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
              <input
                aria-label="Search schema cache"
                className="w-full bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                onChange={(event) => { schema.setSearchQuery(event.currentTarget.value); }}
                placeholder="Search tables, views, columns…"
                value={schema.searchQuery}
              />
            </label>
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 px-3 pb-3">
        <div className="grid gap-2">
          {schema.isDisabled ? (
            <EmptyState message="Connect a saved PostgreSQL target to browse cached schema and relation metadata." />
          ) : schema.searchQuery.trim().length > 0 ? (
            schema.searchResults.length > 0 ? (
              schema.searchResults.map((node) => (
                <button
                  className="grid gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-2 text-left transition hover:border-[var(--border-strong)]"
                  key={node.path}
                  onClick={() => {
                    schema.selectNode(node);
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                    {iconForNode(node)}
                    {node.name}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">{node.path}</p>
                </button>
              ))
            ) : (
              <EmptyState message="No cached matches yet. Refresh more scopes to grow the local metadata index." />
            )
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
                <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-3 text-sm text-[var(--text-secondary)]">
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
                      className={cn(
                        'flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition',
                        isSelected
                          ? 'bg-[color-mix(in_oklch,_var(--surface-highlight)_86%,_black_14%)] text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-panel)]',
                      )}
                      data-testid={`schema-node-${row.node.path}`}
                      key={row.node.path}
                      onClick={() => {
                        schema.selectNode(row.node);
                      }}
                      onDoubleClick={() => {
                        void schema.toggleNode(row.node);
                      }}
                      role="treeitem"
                      style={{ paddingLeft: `${row.depth * 16 + 12}px` }}
                      type="button"
                    >
                      {row.node.hasChildren ? (
                        <ChevronRight
                          className={cn('h-3.5 w-3.5 transition', row.isExpanded ? 'rotate-90' : '')}
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
                      {row.node.kind === 'column' ? (
                        <span className="ml-2 shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                          {row.node.dataType}
                        </span>
                      ) : row.isRefreshing ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[var(--accent-text)]" />
                      ) : row.childScopeStatus === 'stale' ? (
                        <Badge variant="warning">Stale</Badge>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <EmptyState message="No cached schema rows yet. Refresh the root scope to seed the browser." />
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--text-secondary)]">
      {message}
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
    default:
      break;
  }
}

function iconForNode(node: SchemaNode) {
  switch (node.kind) {
    case 'schema':
      return <FolderTree className="h-4 w-4 text-[var(--accent-text)]" />;
    case 'table':
    case 'view':
      return <Table2 className="h-4 w-4 text-[var(--text-muted)]" />;
    default:
      return <div className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />;
  }
}
