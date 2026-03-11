import { Editor } from '@monaco-editor/react';
import { Command, Play, Plus, Square, X } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { TooltipLabel } from '../../components/ui/tooltip';
import { cn } from '../../lib/utils';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryExecutionResult,
} from '../../lib/contracts';
import { formatLongTime } from '../../lib/format';
import { resolveExecutionSlice } from './executionSlice';
import { formatResultColumns, registerSqlCompletionProvider } from './sqlAutocomplete';
import type { QueryTabState, QueryWorkspaceState } from './useQueryWorkspace';

type QueryWorkspaceProps = {
  activeSession: DatabaseSessionSnapshot | null;
  connections: ConnectionSummary[];
  onError: (error: AppError | Error) => void;
  workspace: QueryWorkspaceState;
};

type QueryResultsPanelProps = {
  activeSession: DatabaseSessionSnapshot | null;
  activeView: 'messages' | 'results';
  onActiveViewChange: (view: 'messages' | 'results') => void;
  result: QueryExecutionResult | null;
  tab: QueryTabState | null;
};

const NO_TARGET_CONNECTION = '__none__';

export function QueryWorkspace({
  activeSession,
  connections,
  onError,
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
        { token: 'comment', foreground: '6f7692' },
        { token: 'keyword', foreground: 'b88cff' },
        { token: 'number', foreground: 'f5c451' },
        { token: 'string', foreground: '82d5c0' },
        { token: 'identifier', foreground: 'd9ddf4' },
      ],
      colors: {
        'editor.background': '#181922',
        'editorLineNumber.foreground': '#5d6175',
        'editorLineNumber.activeForeground': '#cfd4ee',
        'editor.selectionBackground': '#3c2c64',
        'editor.inactiveSelectionBackground': '#2b2740',
        'editorCursor.foreground': '#b88cff',
        'editorIndentGuide.background1': '#242738',
        'editorIndentGuide.activeBackground1': '#343851',
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
    <div className="grid h-full min-h-[320px] grid-rows-[auto_minmax(0,1fr)]">
      <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_78%,_black_22%)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Query editor</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--text-primary)]">
              {activeTab?.title ?? 'Workspace'}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="new-query-tab-button" onClick={workspace.createTab} size="sm" type="button">
              <Plus className="h-3.5 w-3.5" />
              New tab
            </Button>
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
            <TooltipLabel content="Command palette is planned, not implemented, in this pass.">
              <Button size="sm" type="button" variant="ghost">
                <Command className="h-3.5 w-3.5" />
                Soon
              </Button>
            </TooltipLabel>
          </div>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {workspace.runDisabledReason ??
            'Run the current statement with Cmd/Ctrl+Enter. A non-empty selection always wins.'}
        </p>
      </div>

      <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-panel)]">
          <ScrollArea className="w-full">
            <div className="flex min-h-[56px] items-stretch gap-1 px-3 py-2">
              {workspace.tabs.map((tab) => {
                const isActive = tab.id === activeTab?.id;
                return (
                  <div
                    className={cn(
                      'flex min-w-[190px] items-center justify-between gap-2 rounded-xl border px-3 py-2',
                      isActive
                        ? 'border-[var(--border-accent)] bg-[var(--surface-highlight)]'
                        : 'border-transparent bg-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]',
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
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{tab.title}</p>
                        {tab.dirty ? <span className="inline-flex h-2 w-2 rounded-full bg-[var(--accent-solid)]" /> : null}
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">{tab.execution.status}</p>
                    </button>
                    <button
                      aria-label={`Close ${tab.title || tab.id}`}
                      className="rounded-md p-1 text-[var(--text-muted)] transition hover:bg-[var(--surface-panel)] hover:text-[var(--text-primary)]"
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
        </div>

        <div className="grid gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-panel)] px-4 py-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Badge variant={activeTab?.execution.status === 'failed' ? 'danger' : activeTab?.execution.status === 'completed' ? 'success' : 'default'}>
              {activeTab?.execution.status ?? 'idle'}
            </Badge>
            <span>Active connection: {activeSession?.name ?? 'none'}</span>
            <span>Tab target: {connectionNameFor(activeTab?.targetConnectionId ?? null, connections)}</span>
            <span>
              {activeTab?.execution.lastEvent?.finishedAt
                ? `Last run ${formatLongTime(activeTab.execution.lastEvent.finishedAt)}`
                : 'Not executed yet'}
            </span>
          </div>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Target connection</p>
            <Select
              onValueChange={(value) => {
                if (activeTab) {
                  workspace.setTabTargetConnection(
                    activeTab.id,
                    value === NO_TARGET_CONNECTION ? null : value,
                  );
                }
              }}
              value={activeTab?.targetConnectionId ?? NO_TARGET_CONNECTION}
            >
              <SelectTrigger data-testid="query-target-select">
                <SelectValue placeholder="Select saved target" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TARGET_CONNECTION}>Select saved target</SelectItem>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
    </div>
  );
}

export function QueryResultsPanel({
  activeSession,
  activeView,
  onActiveViewChange,
  result,
  tab,
}: QueryResultsPanelProps) {
  return (
    <Tabs
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      onValueChange={(value) => {
        onActiveViewChange(value as 'messages' | 'results');
      }}
      value={activeView}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Results</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
            {tab?.title ?? 'Result preview'}
          </h3>
        </div>
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent className="min-h-0" value="results">
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <Badge variant={result ? 'success' : 'default'}>
              {result ? (result.kind === 'rows' ? `${result.previewRowCount} rows` : result.commandTag) : 'No result'}
            </Badge>
            <span>Connection: {activeSession?.name ?? 'none'}</span>
            <span>Elapsed: {tab?.execution.lastEvent ? `${tab.execution.lastEvent.elapsedMs} ms` : 'n/a'}</span>
          </div>
          <div className="min-h-0 px-4 py-4">
            {result ? <ResultPreview result={result} /> : <EmptyPanel message="Run a query to populate the result grid." />}
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
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Last error</p>
              <p className="mt-3 text-sm text-[var(--text-secondary)]">
                {tab?.execution.lastError?.message ?? 'No error recorded for the active tab.'}
              </p>
            </article>
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

function ResultPreview({ result }: { result: QueryExecutionResult }) {
  if (result.kind === 'command') {
    return (
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
        <p className="font-medium text-[var(--text-primary)]">{result.commandTag}</p>
        <p className="mt-2">Rows affected: {result.rowsAffected ?? 'unknown'}</p>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-3">
      <p className="text-sm text-[var(--text-secondary)]">{formatResultColumns(result.columns)}</p>
      <div className="min-h-0 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
        <ScrollArea className="h-full">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-[color-mix(in_oklch,_var(--surface-panel)_90%,_black_10%)] text-[var(--text-muted)]">
              <tr>
                {result.columns.map((column, index) => (
                  <th
                    className="border-b border-[var(--border-subtle)] px-3 py-2 font-medium"
                    key={`${column.name}-${index}`}
                  >
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.previewRows.map((row, rowIndex) => (
                <tr className="border-b border-[var(--border-subtle)]" key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td className="px-3 py-2 text-[var(--text-secondary)]" key={`cell-${rowIndex}-${cellIndex}`}>
                      {cell ?? 'null'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </div>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
        {result.previewRowCount} rows previewed{result.truncated ? ' (truncated to 200 rows)' : ''}
      </p>
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
