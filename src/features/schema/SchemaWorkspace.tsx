import { ChevronRight, FolderTree, LoaderCircle, RefreshCcw, Search, Table2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
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
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-t border-[var(--border-subtle)]">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Schema</p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
              {activeSession?.database ?? 'Metadata browser'}
            </h3>
          </div>
          <Button
            disabled={schema.isDisabled}
            onClick={() => {
              void schema.refreshSelectedScope();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            aria-label="Search schema cache"
            className="h-9"
            disabled={schema.isDisabled}
            onChange={(event) => {
              schema.setSearchQuery(event.currentTarget.value);
            }}
            placeholder={schema.isDisabled ? 'Connect to browse metadata' : 'Search tables, views, columns'}
            value={schema.searchQuery}
          />
          <div className="rounded-md bg-[var(--surface-panel)] p-2 text-[var(--text-muted)]">
            <Search className="h-4 w-4" />
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 px-3 pb-3">
        <div className="grid gap-2">
          {schema.isDisabled ? (
            <EmptyState message="Connect a saved PostgreSQL target to browse cached schema and relation metadata." />
          ) : schema.searchQuery.trim().length > 0 ? (
            schema.searchResults.length > 0 ? (
              schema.searchResults.map((node) => (
                <button
                  className="grid gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-2 text-left transition hover:border-[var(--border-strong)]"
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
                        'flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
                        isSelected
                          ? 'bg-[var(--surface-highlight)] text-[var(--text-primary)]'
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
                      {row.isRefreshing ? (
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
    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--text-secondary)]">
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
