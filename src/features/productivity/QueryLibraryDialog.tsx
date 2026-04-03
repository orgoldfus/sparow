import { BookMarked, FileClock, Play, Save, Search, Trash2 } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import type { ConnectionSummary, HistoryEntry, SavedQuery } from '../../lib/contracts';
import type { QueryLibraryProps, QueryLibraryTab } from './types';

export function QueryLibraryDialog({
  activeTab,
  connections,
  deletingSavedQueryId,
  historyConnectionId,
  historyEntries,
  historyHasMore,
  historyLoading,
  historySearchQuery,
  onActiveTabChange,
  onDeleteSavedQuery,
  onEditSavedQuery,
  onHistoryConnectionIdChange,
  onHistorySearchQueryChange,
  onOpenChange,
  onOpenHistoryEntry,
  onOpenSavedQuery,
  onRunHistoryEntry,
  onRunSavedQuery,
  onSaveHistoryEntry,
  onSavedQueriesSearchQueryChange,
  open,
  savedQueries,
  savedQueriesHasMore,
  savedQueriesLoading,
  savedQueriesSearchQuery,
}: QueryLibraryProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-5xl overflow-hidden p-0" data-testid="query-library-dialog" showClose>
        <DialogHeader className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_88%,_black_12%)] px-6 py-5">
          <DialogTitle>Query library</DialogTitle>
          <DialogDescription>
            Browse saved query definitions and accepted query history without replacing the active editor tab.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          className="grid min-h-[70vh] grid-rows-[auto_minmax(0,1fr)]"
          onValueChange={(value) => {
            onActiveTabChange(value as QueryLibraryTab);
          }}
          value={activeTab}
        >
          <div className="border-b border-[var(--border-subtle)] px-6 py-4">
            <TabsList>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="saved">Saved</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent className="min-h-0" value="history">
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="grid gap-3 border-b border-[var(--border-subtle)] px-6 py-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <label className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3">
                  <Search className="h-4 w-4 text-[var(--text-muted)]" />
                  <Input
                    aria-label="Search query history"
                    className="border-none bg-transparent px-0 shadow-none focus:border-none focus:ring-0"
                    data-testid="query-library-history-search"
                    onChange={(event) => {
                      onHistorySearchQueryChange(event.currentTarget.value);
                    }}
                    placeholder="Search recent SQL"
                    value={historySearchQuery}
                  />
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3">
                  <FileClock className="h-4 w-4 text-[var(--text-muted)]" />
                  <select
                    aria-label="Filter history by connection"
                    className="h-11 w-full bg-transparent text-sm text-[var(--text-primary)] outline-none"
                    data-testid="query-library-history-connection-filter"
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value.trim();
                      onHistoryConnectionIdChange(nextValue.length > 0 ? nextValue : null);
                    }}
                    value={historyConnectionId ?? ''}
                  >
                    <option value="">All connections</option>
                    {connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <ScrollArea className="min-h-0">
                <div className="grid gap-3 px-6 py-5">
                  {historyEntries.length > 0 ? (
                    historyEntries.map((entry) => (
                      <HistoryEntryCard
                        connectionLabel={connectionLabelFor(entry.connectionProfileId, connections)}
                        entry={entry}
                        key={entry.id}
                        onOpen={() => {
                          onOpenHistoryEntry(entry);
                        }}
                        onRun={() => {
                          onRunHistoryEntry(entry);
                        }}
                        onSave={() => {
                          onSaveHistoryEntry(entry);
                        }}
                      />
                    ))
                  ) : (
                    <EmptyLibraryState
                      loading={historyLoading}
                      message="No matching history rows. Accepted queries will appear here as soon as they are started."
                    />
                  )}
                  {historyHasMore ? (
                    <p className="px-1 text-xs text-[var(--text-muted)]">
                      Showing the newest matching rows first. Refine the search to narrow the result set.
                    </p>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent className="min-h-0" value="saved">
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="border-b border-[var(--border-subtle)] px-6 py-4">
                <label className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3">
                  <Search className="h-4 w-4 text-[var(--text-muted)]" />
                  <Input
                    aria-label="Search saved queries"
                    className="border-none bg-transparent px-0 shadow-none focus:border-none focus:ring-0"
                    data-testid="query-library-saved-search"
                    onChange={(event) => {
                      onSavedQueriesSearchQueryChange(event.currentTarget.value);
                    }}
                    placeholder="Search saved query titles, SQL, and tags"
                    value={savedQueriesSearchQuery}
                  />
                </label>
              </div>

              <ScrollArea className="min-h-0">
                <div className="grid gap-3 px-6 py-5">
                  {savedQueries.length > 0 ? (
                    savedQueries.map((savedQuery) => (
                      <SavedQueryCard
                        connectionLabel={connectionLabelFor(savedQuery.connectionProfileId, connections)}
                        deleting={deletingSavedQueryId === savedQuery.id}
                        key={savedQuery.id}
                        onDelete={() => {
                          onDeleteSavedQuery(savedQuery);
                        }}
                        onEdit={() => {
                          onEditSavedQuery(savedQuery);
                        }}
                        onOpen={() => {
                          onOpenSavedQuery(savedQuery);
                        }}
                        onRun={() => {
                          onRunSavedQuery(savedQuery);
                        }}
                        savedQuery={savedQuery}
                      />
                    ))
                  ) : (
                    <EmptyLibraryState
                      loading={savedQueriesLoading}
                      message="No saved queries match the current search."
                    />
                  )}
                  {savedQueriesHasMore ? (
                    <p className="px-1 text-xs text-[var(--text-muted)]">
                      More saved queries exist than this dialog currently shows. Keep typing to narrow them.
                    </p>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function HistoryEntryCard({
  connectionLabel,
  entry,
  onOpen,
  onRun,
  onSave,
}: {
  connectionLabel: string;
  entry: HistoryEntry;
  onOpen: () => void;
  onRun: () => void;
  onSave: () => void;
}) {
  return (
    <article
      className="grid gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-4 py-4"
      data-testid={`query-library-history-entry-${entry.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent">Accepted query</Badge>
        <Badge>{connectionLabel}</Badge>
        <span className="text-xs text-[var(--text-muted)]">{formatTimestamp(entry.createdAt)}</span>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-[color-mix(in_oklch,_var(--surface-editor)_88%,_black_12%)] px-4 py-3 text-sm text-[var(--text-primary)]">
        {entry.sql}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onOpen} size="sm" type="button" variant="secondary">
          Open in new tab
        </Button>
        <Button onClick={onRun} size="sm" type="button">
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
        <Button onClick={onSave} size="sm" type="button" variant="ghost">
          <Save className="h-3.5 w-3.5" />
          Save as query
        </Button>
      </div>
    </article>
  );
}

function SavedQueryCard({
  connectionLabel,
  deleting,
  onDelete,
  onEdit,
  onOpen,
  onRun,
  savedQuery,
}: {
  connectionLabel: string;
  deleting: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onRun: () => void;
  savedQuery: SavedQuery;
}) {
  return (
    <article
      className="grid gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-4 py-4"
      data-testid={`query-library-saved-entry-${savedQuery.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-[var(--text-primary)]">{savedQuery.title}</p>
            <Badge>{connectionLabel}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {savedQuery.tags.length > 0 ? (
              savedQuery.tags.map((tag) => (
                <Badge key={tag} variant="accent">
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-[var(--text-muted)]">No tags</span>
            )}
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)]">Updated {formatTimestamp(savedQuery.updatedAt)}</p>
      </div>

      <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-[color-mix(in_oklch,_var(--surface-editor)_88%,_black_12%)] px-4 py-3 text-sm text-[var(--text-primary)]">
        {savedQuery.sql}
      </pre>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onOpen} size="sm" type="button" variant="secondary">
          Open
        </Button>
        <Button onClick={onRun} size="sm" type="button">
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
        <Button onClick={onEdit} size="sm" type="button" variant="ghost">
          <BookMarked className="h-3.5 w-3.5" />
          Edit metadata
        </Button>
        <Button disabled={deleting} onClick={onDelete} size="sm" type="button" variant="danger">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </article>
  );
}

function EmptyLibraryState({ loading, message }: { loading: boolean; message: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-panel)] px-4 py-6 text-sm text-[var(--text-secondary)]">
      {loading ? 'Loading local productivity data...' : message}
    </div>
  );
}

function connectionLabelFor(connectionId: string | null, connections: ConnectionSummary[]) {
  if (!connectionId) {
    return 'No default connection';
  }

  return connections.find((connection) => connection.id === connectionId)?.name ?? 'Missing connection';
}

function formatTimestamp(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
