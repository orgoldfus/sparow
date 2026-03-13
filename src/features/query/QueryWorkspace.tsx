import { Editor } from '@monaco-editor/react';
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  FileCode2,
  Play,
  Plus,
  Search,
  Square,
  X,
} from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../lib/utils';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryResultCell,
  QueryResultStatus,
} from '../../lib/contracts';
import { resolveExecutionSlice } from './executionSlice';
import { formatResultColumns, registerSqlCompletionProvider } from './sqlAutocomplete';
import type { QueryTabState, QueryWorkspaceState } from './useQueryWorkspace';

type QueryWorkspaceProps = {
  activeSession: DatabaseSessionSnapshot | null;
  connections: ConnectionSummary[];
  onError: (error: AppError | Error) => void;
  showTabStrip?: boolean;
  workspace: QueryWorkspaceState;
};

export type QueryResultsView = 'messages' | 'results';

type QueryResultsPanelProps = {
  activeSession: DatabaseSessionSnapshot | null;
  activeView: QueryResultsView;
  onActiveViewChange: (view: QueryResultsView) => void;
  workspace: QueryWorkspaceState;
};

const GRID_ROW_HEIGHT = 34;
const GRID_OVERSCAN = 12;
const GRID_MIN_FETCH = 120;

export function QueryTabStrip({ workspace }: { workspace: QueryWorkspaceState }) {
  const activeTab = workspace.activeTab;

  return (
    <div className="flex h-full min-h-[56px] items-stretch border-b border-[var(--border-subtle)] bg-[linear-gradient(180deg,_color-mix(in_oklch,_var(--surface-panel)_84%,_black_16%),_color-mix(in_oklch,_var(--surface-panel)_94%,_black_6%))]">
      <ScrollArea className="min-w-0 flex-1">
        <div className="flex min-h-[56px] items-end gap-1 px-3 pt-3">
          {workspace.tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;

            return (
              <div
                className={cn(
                  'flex min-w-[190px] max-w-[280px] items-center gap-2 rounded-t-2xl border border-b-0 px-3 py-2',
                  isActive
                    ? 'border-[var(--border-strong)] bg-[color-mix(in_oklch,_var(--surface-editor)_92%,_white_8%)]'
                    : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[color-mix(in_oklch,_var(--surface-panel)_84%,_black_16%)]',
                )}
                key={tab.id}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  data-testid={`query-tab-${tab.id}`}
                  onClick={() => {
                    workspace.selectTab(tab.id);
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{tab.title}</p>
                    {tab.dirty ? <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-solid)]" /> : null}
                  </div>
                </button>
                <button
                  aria-label={`Close ${tab.title || tab.id}`}
                  className="rounded-lg p-1 text-[var(--text-muted)] transition hover:bg-[var(--surface-panel)] hover:text-[var(--text-primary)]"
                  onClick={() => {
                    workspace.closeTab(tab.id);
                  }}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="flex items-center pr-3">
        <Button data-testid="new-query-tab-button" onClick={workspace.createTab} size="sm" type="button" variant="ghost">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function QueryWorkspace({
  activeSession,
  connections,
  onError,
  showTabStrip = true,
  workspace,
}: QueryWorkspaceProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const completionRef = useRef<ReturnType<typeof registerSqlCompletionProvider> | null>(null);
  const runActiveEditorRef = useRef<() => void>(() => {});
  const activeTab = workspace.activeTab;

  runActiveEditorRef.current = () => {
    void runActiveEditor();
  };

  useEffect(() => {
    if (!monacoRef.current) {
      return;
    }

    completionRef.current?.dispose();
    completionRef.current = registerSqlCompletionProvider({
      monaco: monacoRef.current,
      getActiveConnectionId: () => activeSession?.connectionId ?? null,
      getConnectionId: () => workspace.activeTab?.targetConnectionId ?? null,
      onError,
    });

    return () => {
      completionRef.current?.dispose();
      completionRef.current = null;
    };
  }, [activeSession?.connectionId, onError, workspace.activeTab?.targetConnectionId]);

  function handleMount(
    editorInstance: Monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof Monaco,
  ) {
    editorRef.current = editorInstance;
    monacoRef.current = monacoInstance;

    monacoInstance.editor.defineTheme('sparow-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '60667c' },
        { token: 'keyword', foreground: '9164ff' },
        { token: 'number', foreground: 'b28fff' },
        { token: 'string', foreground: '89d7c5' },
        { token: 'identifier', foreground: 'd8def9' },
      ],
      colors: {
        'editor.background': '#0d111c',
        'editorLineNumber.foreground': '#535a71',
        'editorLineNumber.activeForeground': '#f3f4fb',
        'editor.selectionBackground': '#2f214d',
        'editor.inactiveSelectionBackground': '#221835',
        'editorCursor.foreground': '#9b74ff',
        'editorIndentGuide.background1': '#1a1f30',
        'editorIndentGuide.activeBackground1': '#313853',
      },
    });

    editorInstance.updateOptions({
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: false },
      padding: { top: 16 },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
    });
    monacoInstance.editor.setTheme('sparow-dark');

    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      runActiveEditorRef.current();
    });
  }

  async function runActiveEditor() {
    if (!activeTab || !editorRef.current) {
      return;
    }

    try {
      const model = editorRef.current.getModel();
      if (!model) {
        throw new Error('Editor model is not ready yet.');
      }

      const intent = resolveExecutionSlice(model, editorRef.current.getSelection());
      await workspace.startTabQuery(activeTab.id, intent);
    } catch (caught) {
      onError(
        caught instanceof Error ? caught : new Error('Failed to resolve the current SQL statement.'),
      );
    }
  }

  return (
    <div
      className={cn(
        'grid h-full min-h-[320px]',
        showTabStrip ? 'grid-rows-[auto_auto_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]',
      )}
    >
      {showTabStrip ? <QueryTabStrip workspace={workspace} /> : null}

      <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_82%,_black_18%)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-testid="run-query-button"
              disabled={workspace.runDisabledReason !== null}
              onClick={() => {
                void runActiveEditor();
              }}
              size="sm"
              type="button"
            >
              <Play className="h-3.5 w-3.5" />
              Run
            </Button>
            <Button
              data-testid="cancel-query-button"
              disabled={!activeTab?.execution.jobId}
              onClick={() => {
                if (activeTab) {
                  void workspace.cancelTabQuery(activeTab.id);
                }
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Square className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <Badge
              variant={
                activeTab?.execution.status === 'failed'
                  ? 'danger'
                  : activeTab?.execution.status === 'completed'
                    ? 'success'
                    : activeTab?.execution.status === 'running'
                      ? 'accent'
                      : 'default'
              }
            >
              {activeTab?.execution.status ?? 'idle'}
            </Badge>
            <span>{connectionNameFor(activeTab?.targetConnectionId ?? null, connections)}</span>
            <span className="hidden lg:inline">{activeSession?.database ?? 'No active database'}</span>
            <span className="hidden xl:inline">{activeTab?.title ?? 'Untitled query'}</span>
          </div>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {workspace.runDisabledReason ??
            'Run the current statement with Cmd/Ctrl+Enter. A non-empty selection always wins.'}
        </p>
      </div>

      <div className="surface-grid min-h-0">
        <Editor
          defaultLanguage="sql"
          height="100%"
          onMount={handleMount}
          path={activeTab?.id ?? 'query-tab'}
          theme="sparow-dark"
          value={activeTab?.sql ?? ''}
          onChange={(value) => {
            if (activeTab) {
              workspace.setTabSql(activeTab.id, value ?? '');
            }
          }}
        />
      </div>
    </div>
  );
}

export function QueryResultsPanel({
  activeSession,
  activeView,
  onActiveViewChange,
  workspace,
}: QueryResultsPanelProps) {
  const tab = workspace.activeTab;
  const result = tab?.execution.lastResult ?? null;
  const summary = tab?.result.summary ?? (result?.kind === 'rows' ? result : null);
  const loadWindowRef = useRef(workspace.loadTabResultWindow);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollTopRef = useRef(0);
  const [scrollRevision, setScrollRevision] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const totalRows = tab?.result.window?.visibleRowCount ?? summary?.bufferedRowCount ?? 0;
  const visibleRowCount = Math.max(
    GRID_MIN_FETCH,
    Math.ceil(viewportHeight / GRID_ROW_HEIGHT) + GRID_OVERSCAN * 2,
  );
  const tabId = tab?.id ?? null;
  const resultKind = result?.kind ?? null;
  const summaryResultSetId = summary?.resultSetId ?? null;
  const gridTemplateColumns = useMemo(() => {
    const columnCount = summary?.columns.length ?? 0;
    return `72px repeat(${Math.max(columnCount, 1)}, minmax(180px, 1fr))`;
  }, [summary?.columns.length]);

  useEffect(() => {
    loadWindowRef.current = workspace.loadTabResultWindow;
  }, [workspace.loadTabResultWindow]);

  useEffect(() => {
    const element = scrollContainerRef.current;
    scrollTopRef.current = 0;
    if (!element) {
      return;
    }

    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, [summaryResultSetId, tabId, tab?.result.filters, tab?.result.quickFilter, tab?.result.sort]);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(element);
    setViewportHeight(element.clientHeight);

    return () => {
      observer.disconnect();
    };
  }, [activeView, tabId]);

  useEffect(() => {
    if (activeView !== 'results' || !tabId || !summaryResultSetId || resultKind === 'command') {
      return;
    }

    const currentScrollTop = scrollContainerRef.current?.scrollTop ?? scrollTopRef.current;
    const firstVisibleIndex = Math.max(0, Math.floor(currentScrollTop / GRID_ROW_HEIGHT) - GRID_OVERSCAN);
    void loadWindowRef.current(tabId, firstVisibleIndex, visibleRowCount);
  }, [
    activeView,
    resultKind,
    scrollRevision,
    summaryResultSetId,
    tabId,
    visibleRowCount,
  ]);

  return (
    <Tabs
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      onValueChange={(value) => {
        onActiveViewChange(value as QueryResultsView);
      }}
      value={activeView}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_92%,_black_8%)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Results</p>
            <h3 className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
              {tab?.title ?? 'Cached result viewer'}
            </h3>
          </div>
          {summary ? (
            <Badge variant={resultStatusBadgeVariant(summary.status)}>{resultStatusLabel(summary.status)}</Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <TabsList>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="messages">Messages</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
            <span>
              {summary
                ? `${summary.bufferedRowCount}${summary.totalRowCount !== null ? ` / ${summary.totalRowCount}` : ''} rows`
                : 'No rows'}
            </span>
            <span>{tab?.execution.lastEvent ? `${tab.execution.lastEvent.elapsedMs} ms` : 'n/a'}</span>
          </div>
        </div>
      </div>

      <TabsContent className="min-h-0" value="results">
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_86%,_black_14%)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-[240px] max-w-[420px] flex-1 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
                <Search className="h-4 w-4 text-[var(--text-muted)]" />
                <input
                  className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                  data-testid="result-quick-filter"
                  disabled={!summary}
                  placeholder="Filter visible columns"
                  value={tab?.result.quickFilter ?? ''}
                  onChange={(event) => {
                    if (tab) {
                      workspace.setTabQuickFilter(tab.id, event.target.value);
                    }
                  }}
                />
              </label>

              {tab?.result.latestStreamEvent && summary?.status === 'running' ? (
                <span className="text-xs text-[var(--text-secondary)]" data-testid="result-streaming-note">
                  Viewer reflects cached rows only while streaming continues.
                </span>
              ) : (
                <span className="text-xs text-[var(--text-secondary)]">
                  {activeSession ? `Connected to ${activeSession.name}` : 'Connect a saved target to run queries.'}
                </span>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-hidden">
            {result?.kind === 'command' ? (
              <div className="p-4">
                <CommandResultCard commandTag={result.commandTag} rowsAffected={result.rowsAffected} />
              </div>
            ) : summary ? (
              <ResultGrid
                gridTemplateColumns={gridTemplateColumns}
                scrollContainerRef={scrollContainerRef}
                setScrollTop={(value) => {
                  scrollTopRef.current = value;
                  setScrollRevision((current) => current + 1);
                }}
                tab={tab}
                totalRows={totalRows}
                workspace={workspace}
              />
            ) : (
              <div className="p-4">
                <EmptyPanel
                  message={
                    tab?.execution.status === 'failed'
                      ? tab.execution.lastError?.message ?? 'The last query failed before rows were cached.'
                      : tab?.execution.status === 'running'
                        ? 'Waiting for result metadata from the running query.'
                        : 'Run a query to populate the cached result grid.'
                  }
                />
              </div>
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent className="min-h-0" value="messages">
        <ScrollArea className="h-full px-4 py-4">
          <div className="grid gap-4">
            <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Execution summary</p>
              <div className="mt-3 grid gap-2 text-sm text-[var(--text-secondary)]">
                <p>Status: {tab?.execution.status ?? 'idle'}</p>
                <p>Connection: {activeSession?.name ?? 'none'}</p>
                <p>Query: {tab?.title ?? 'n/a'}</p>
                <p>{tab?.lastExecutionSummary ?? 'Run a query to capture execution messages.'}</p>
              </div>
            </article>

            <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Cached result</p>
              <div className="mt-3 grid gap-2 text-sm text-[var(--text-secondary)]">
                <p>Result set: {summary?.resultSetId ?? 'none'}</p>
                <p>Columns: {summary ? formatResultColumns(summary.columns) : 'n/a'}</p>
                <p>
                  Rows buffered:{' '}
                  {summary ? `${summary.bufferedRowCount}${summary.totalRowCount !== null ? ` / ${summary.totalRowCount}` : ''}` : 'n/a'}
                </p>
                <p>Window state: {tab?.result.windowStatus ?? 'idle'}</p>
              </div>
            </article>

            <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Last error</p>
              <p className="mt-3 text-sm text-[var(--text-secondary)]">
                {tab?.result.windowError?.message ??
                  tab?.result.exportLastError?.message ??
                  tab?.execution.lastError?.message ??
                  'No error recorded for the active tab.'}
              </p>
            </article>
          </div>
        </ScrollArea>
      </TabsContent>

    </Tabs>
  );
}

function ResultGrid({
  gridTemplateColumns,
  scrollContainerRef,
  setScrollTop,
  tab,
  totalRows,
  workspace,
}: {
  gridTemplateColumns: string;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  setScrollTop: (value: number) => void;
  tab: QueryTabState | null;
  totalRows: number;
  workspace: QueryWorkspaceState;
}) {
  const summary = tab?.result.summary;
  const window = tab?.result.window;
  const topSpacer = window ? window.offset * GRID_ROW_HEIGHT : 0;
  const bottomSpacer = window
    ? Math.max(0, (totalRows - window.offset - window.rows.length) * GRID_ROW_HEIGHT)
    : 0;
  const sort = tab?.result.sort ?? null;

  if (!summary || !tab) {
    return <EmptyPanel message="No cached result set is available for this tab." />;
  }

  return (
    <div className="grid h-full min-h-0 overflow-hidden bg-[color-mix(in_oklch,_var(--surface-editor)_82%,_var(--surface-panel)_18%)]">
      <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_84%,_black_16%)] px-3 py-2 text-xs text-[var(--text-secondary)]">
        {formatResultColumns(summary.columns)}
      </div>

      <div
        className="min-h-0 overflow-auto"
        aria-colcount={summary.columns.length + 1}
        aria-rowcount={totalRows}
        data-testid="query-result-grid-scroll"
        ref={scrollContainerRef}
        role="grid"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
      >
        <div className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_92%,_black_8%)] backdrop-blur-sm" role="rowgroup">
          <div className="grid min-w-max" role="row" style={{ gridTemplateColumns }}>
            <div className="border-r border-[var(--border-subtle)] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]" role="columnheader">
              Row
            </div>
            {summary.columns.map((column, index) => {
              const isSorted = sort?.columnIndex === index;
              return (
                <button
                  className="flex items-center justify-between gap-2 border-r border-[var(--border-subtle)] px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)] last:border-r-0"
                  data-testid={`result-column-${index}`}
                  key={`${column.name}-${index}`}
                  onClick={() => {
                    workspace.toggleTabSort(tab.id, index);
                  }}
                  role="columnheader"
                  type="button"
                >
                  <span className="truncate">{column.name}</span>
                  {isSorted ? (
                    sort.direction === 'asc' ? (
                      <ArrowUpWideNarrow className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                    ) : (
                      <ArrowDownWideNarrow className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                    )
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="grid min-w-max border-t border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-elevated)_94%,_black_6%)]" role="row" style={{ gridTemplateColumns }}>
            <div className="border-r border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--text-muted)]" role="gridcell">contains</div>
            {summary.columns.map((column, index) => (
              <label className="border-r border-[var(--border-subtle)] px-2 py-1.5 last:border-r-0" key={`filter-${column.name}-${index}`} role="gridcell">
                <input
                  className="w-full rounded-lg border border-transparent bg-[var(--surface-panel)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]"
                  data-testid={`result-filter-${index}`}
                  placeholder={column.name}
                  value={filterValueForColumn(tab, index)}
                  onChange={(event) => {
                    workspace.setTabColumnFilter(tab.id, index, event.target.value);
                  }}
                />
              </label>
            ))}
          </div>
        </div>

        {tab.result.windowStatus === 'failed' ? (
          <div className="px-4 py-6">
            <EmptyPanel message={tab.result.windowError?.message ?? 'Failed to load the cached result window.'} />
          </div>
        ) : (
          <div className="min-w-max" role="rowgroup">
            <div style={{ height: topSpacer }} />
            {window?.rows.map((row, rowIndex) => {
              const absoluteIndex = window.offset + rowIndex;
              return (
                <div
                  aria-rowindex={absoluteIndex + 1}
                  className="grid border-b border-[var(--border-subtle)] text-sm text-[var(--text-secondary)]"
                  data-testid={`result-row-${absoluteIndex}`}
                  key={`row-${absoluteIndex}`}
                  role="row"
                  style={{ gridTemplateColumns, minHeight: GRID_ROW_HEIGHT }}
                >
                  <div className="border-r border-[var(--border-subtle)] px-3 py-2 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {absoluteIndex + 1}
                  </div>
                  {row.map((cell, cellIndex) => (
                    <div
                      className="truncate border-r border-[var(--border-subtle)] px-3 py-2 font-mono text-[13px] last:border-r-0"
                      key={`cell-${absoluteIndex}-${cellIndex}`}
                      role="gridcell"
                      title={cellTitle(cell)}
                    >
                      {renderCell(cell)}
                    </div>
                  ))}
                </div>
              );
            })}
            <div style={{ height: bottomSpacer }} />
          </div>
        )}
      </div>
    </div>
  );
}

function CommandResultCard({
  commandTag,
  rowsAffected,
}: {
  commandTag: string;
  rowsAffected: number | null;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
      <p className="font-medium text-[var(--text-primary)]">{commandTag}</p>
      <p className="mt-2">Rows affected: {rowsAffected ?? 'unknown'}</p>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
      {message}
    </div>
  );
}

function connectionNameFor(connectionId: string | null, connections: ConnectionSummary[]): string {
  if (!connectionId) {
    return 'none';
  }

  return connections.find((connection) => connection.id === connectionId)?.name ?? connectionId;
}

function filterValueForColumn(tab: QueryTabState, columnIndex: number): string {
  return tab.result.filters.find((filter) => filter.columnIndex === columnIndex)?.value ?? '';
}

function renderCell(cell: QueryResultCell): string {
  if (cell === null) {
    return 'null';
  }

  return String(cell);
}

function cellTitle(cell: QueryResultCell): string {
  return renderCell(cell);
}

function resultStatusBadgeVariant(status: QueryResultStatus): 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'cancelled':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'running':
      return 'accent';
  }
}

function resultStatusLabel(status: QueryResultStatus): string {
  switch (status) {
    case 'completed':
      return 'cached result complete';
    case 'cancelled':
      return 'cached result cancelled';
    case 'failed':
      return 'cached result failed';
    case 'running':
      return 'streaming cached rows';
  }
}
