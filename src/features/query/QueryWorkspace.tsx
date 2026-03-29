import { Editor } from '@monaco-editor/react';
import { Check, Code2, Play, Plus, Search, Square, X } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../lib/utils';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryResultSetSummary,
  QueryResultWindow,
} from '../../lib/contracts';
import { resolveExecutionSlice } from './executionSlice';
import { EmptyPanel, QueryResultsTable } from './QueryResultsTable';
import {
  resetQueryCursorPosition,
  setQueryCursorPosition,
  syncQueryCursorPosition,
} from './queryCursorPosition';
import { formatResultColumns, registerSqlCompletionProvider } from './sqlAutocomplete';
import type { QueryTabState, QueryWorkspaceState } from './useQueryWorkspace';

type QueryWorkspaceProps = {
  activeSession: DatabaseSessionSnapshot | null;
  /** @deprecated - no longer used in rendering but kept for API compatibility */
  connections?: ConnectionSummary[];
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
    <div className="flex h-9 items-stretch border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_80%,_black_20%)]">
      <ScrollArea className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-9 items-stretch">
          {workspace.tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;

            return (
              <div
                className={cn(
                  'group flex items-center gap-1.5 border-r border-[var(--border-subtle)] pl-3 pr-2 transition',
                  isActive
                    ? 'bg-[var(--surface-editor)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[color-mix(in_oklch,_var(--surface-editor)_40%,_transparent_60%)] hover:text-[var(--text-primary)]',
                )}
                key={tab.id}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left"
                  data-testid={`query-tab-${tab.id}`}
                  onClick={() => {
                    workspace.selectTab(tab.id);
                  }}
                  type="button"
                >
                  <Code2
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition',
                      isActive ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)]',
                    )}
                  />
                  <span className="max-w-[160px] truncate text-xs font-medium">{tab.title}</span>
                  {tab.dirty ? (
                    <span
                      aria-label="Unsaved changes"
                      className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                    />
                  ) : null}
                </button>
                <button
                  aria-label={`Close ${tab.title || tab.id}`}
                  className="rounded p-0.5 text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--surface-panel)] hover:text-[var(--text-primary)] group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  onClick={() => {
                    workspace.closeTab(tab.id);
                  }}
                  type="button"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="flex items-center border-l border-[var(--border-subtle)] px-1">
        <Button
          className="h-7 w-7 rounded p-0"
          data-testid="new-query-tab-button"
          onClick={workspace.createTab}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function QueryWorkspace({
  activeSession,
  onError,
  showTabStrip = true,
  workspace,
}: QueryWorkspaceProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const completionRef = useRef<ReturnType<typeof registerSqlCompletionProvider> | null>(null);
  const cursorListenerRef = useRef<Monaco.IDisposable | null>(null);
  const runActiveEditorRef = useRef<() => void>(() => {});
  const activeTab = workspace.activeTab;
  const activeTabId = activeTab?.id ?? null;

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

  useEffect(() => {
    if (!activeTabId || !editorRef.current) {
      resetQueryCursorPosition();
      return;
    }

    syncQueryCursorPosition(editorRef.current);
  }, [activeTabId]);

  useEffect(() => {
    return () => {
      cursorListenerRef.current?.dispose();
      cursorListenerRef.current = null;
      resetQueryCursorPosition();
    };
  }, []);

  function handleMount(
    editorInstance: Monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof Monaco,
  ) {
    cursorListenerRef.current?.dispose();
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
    syncQueryCursorPosition(editorInstance);

    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      runActiveEditorRef.current();
    });

    if (typeof editorInstance.onDidChangeCursorPosition === 'function') {
      cursorListenerRef.current = editorInstance.onDidChangeCursorPosition((event) => {
        setQueryCursorPosition({
          column: event.position.column,
          line: event.position.lineNumber,
        });
      });
    }
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

      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_82%,_black_18%)] px-3 py-1.5">
        <div className="flex items-center gap-1">
          {/* Run button */}
          <button
            aria-label="Run"
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--accent-foreground)] transition hover:bg-[var(--accent-solid-hover)] disabled:pointer-events-none disabled:opacity-40"
            data-testid="run-query-button"
            disabled={workspace.runDisabledReason !== null}
            onClick={() => {
              void runActiveEditor();
            }}
            title={workspace.runDisabledReason ?? undefined}
            type="button"
          >
            <Play className="h-3 w-3" />
            Run
            <kbd
              aria-hidden="true"
              className="ml-px rounded bg-white/10 px-1 py-px text-[10px] font-mono leading-none"
            >
              Ctrl/Cmd↵
            </kbd>
          </button>

          {/* Cancel — always rendered for test accessibility; visually hidden when idle */}
          <button
            className={cn(
              'ml-1 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[var(--danger-text)] transition hover:bg-[var(--danger-surface)]',
              activeTab?.execution.jobId ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
            data-testid="cancel-query-button"
            disabled={!activeTab?.execution.jobId}
            onClick={() => {
              if (activeTab) {
                void workspace.cancelTabQuery(activeTab.id);
              }
            }}
            type="button"
          >
            <Square className="h-3 w-3" />
            Cancel
          </button>
        </div>

        {/* Active tab filename */}
        <span className="truncate text-xs text-[var(--text-muted)]">
          {activeTab?.title ?? ''}
        </span>
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
  const displayResultCount = formatResultTabCount(summary);
  const resultKind = result?.kind ?? null;

  return (
    <Tabs
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      onValueChange={(value) => {
        onActiveViewChange(value as QueryResultsView);
      }}
      value={activeView}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_92%,_black_8%)]">
        {/* Left: flat tab triggers */}
        <TabsList className="h-auto gap-0 rounded-none bg-transparent p-0">
          <TabsTrigger
            className="h-10 gap-1.5 rounded-none border-b-2 border-transparent px-4 text-xs data-[state=active]:border-[var(--accent-solid)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--text-primary)]"
            value="results"
          >
            Results
            {displayResultCount ? (
              <span className="text-[var(--text-muted)]">{displayResultCount}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger
            className="h-10 rounded-none border-b-2 border-transparent px-4 text-xs data-[state=active]:border-[var(--accent-solid)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--text-primary)]"
            value="messages"
          >
            Messages
          </TabsTrigger>
        </TabsList>

        {/* Right: row count + timing */}
        {summary && tab ? (
          <div className="flex items-center gap-3 pr-4 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              {summary.status === 'completed' ? (
                <Check className="h-3 w-3 text-[var(--success-text)]" />
              ) : null}
              {formatRowCountLabel(summary, tab.result.countStatus)}
            </span>
            {tab.execution.lastEvent ? (
              <span>{tab.execution.lastEvent.elapsedMs}ms</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <TabsContent className="min-h-0" value="results">
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_86%,_black_14%)] px-3 py-2">
            <label className="flex min-w-0 max-w-[360px] flex-1 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1.5 focus-within:border-[var(--ring)] focus-within:ring-1 focus-within:ring-[var(--ring)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <input
                aria-label="Filter result rows"
                className="w-full bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
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
            {activeSession ? (
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{activeSession.name}</span>
            ) : null}
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
                      ? tab.execution.lastError?.message ?? 'The last query failed before a result set was available.'
                      : tab?.execution.status === 'running'
                        ? 'Waiting for result metadata from the running query.'
                        : 'Run a query to populate the result grid.'
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
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Query result</p>
              <div className="mt-3 grid gap-2 text-sm text-[var(--text-secondary)]">
                <p>Result set: {summary?.resultSetId ?? 'none'}</p>
                <p>Columns: {summary ? formatResultColumns(summary.columns) : 'n/a'}</p>
                <p>
                  Rows available: {summary && tab ? formatRowCountLabel(summary, tab.result.countStatus) : 'n/a'}
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

function resolveVisibleResultRowCount(
  summary: QueryResultSetSummary | null,
  window: QueryResultWindow | null,
): number {
  if (!summary) {
    return 0;
  }

  if (!window || window.resultSetId !== summary.resultSetId) {
    return summary.totalRowCount ?? summary.bufferedRowCount + (summary.hasMoreRows ? 1 : 0);
  }

  return window.totalRowCount ?? window.visibleRowCount;
}

function formatRowCountLabel(
  summary: QueryResultSetSummary,
  countStatus: QueryTabState['result']['countStatus'],
): string {
  if (summary.totalRowCount !== null) {
    return `${summary.bufferedRowCount} / ${summary.totalRowCount} rows`;
  }

  const loadedLabel = `${summary.bufferedRowCount}${summary.hasMoreRows ? '+' : ''} rows loaded`;
  if (countStatus === 'loading') {
    return `${loadedLabel} - counting total...`;
  }

  return loadedLabel;
}

function formatResultTabCount(summary: QueryResultSetSummary | null): string | null {
  if (!summary) {
    return null;
  }

  if (summary.totalRowCount !== null) {
    return summary.totalRowCount.toString();
  }

  return `${summary.bufferedRowCount}${summary.hasMoreRows ? '+' : ''}`;
}
