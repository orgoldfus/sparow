import { Editor } from '@monaco-editor/react';
import { FileCode2, Play, Plus, Search, Square, X } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../lib/utils';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryResultSetSummary,
  QueryResultStatus,
  QueryResultWindow,
} from '../../lib/contracts';
import { resolveExecutionSlice } from './executionSlice';
import { EmptyPanel, QueryResultsTable } from './QueryResultsTable';
import { formatResultColumns, registerSqlCompletionProvider } from './sqlAutocomplete';
import type { QueryWorkspaceState } from './useQueryWorkspace';

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
  const totalRows = resolveVisibleResultRowCount(summary, tab?.result.window ?? null);
  const resultKind = result?.kind ?? null;

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
                  placeholder="Filter result rows"
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
            ) : summary && tab ? (
              <QueryResultsTable
                active={activeView === 'results' && resultKind !== 'command' && tab !== null}
                summary={summary}
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

function connectionNameFor(connectionId: string | null, connections: ConnectionSummary[]): string {
  if (!connectionId) {
    return 'none';
  }

  return connections.find((connection) => connection.id === connectionId)?.name ?? connectionId;
}

function resolveVisibleResultRowCount(
  summary: QueryResultSetSummary | null,
  window: QueryResultWindow | null,
): number {
  if (!summary) {
    return 0;
  }

  if (!window || window.resultSetId !== summary.resultSetId) {
    return summary.bufferedRowCount;
  }

  const loadedRowCount = window.offset + window.rows.length;
  if (window.visibleRowCount === 0 && window.rows.length > 0) {
    return Math.max(summary.bufferedRowCount, loadedRowCount);
  }

  return Math.max(window.visibleRowCount, loadedRowCount);
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
