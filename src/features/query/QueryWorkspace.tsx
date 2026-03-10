import { Editor } from '@monaco-editor/react';
import { Play, Plus, Square, X } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import type {
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
  onError: (error: Error) => void;
  workspace: QueryWorkspaceState;
};

type QueryResultsPanelProps = {
  activeSession: DatabaseSessionSnapshot | null;
  result: QueryExecutionResult | null;
  tab: QueryTabState | null;
};

export function QueryWorkspace({
  activeSession,
  connections,
  onError,
  workspace,
}: QueryWorkspaceProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const completionRef = useRef<ReturnType<typeof registerSqlCompletionProvider> | null>(null);
  const activeTab = workspace.activeTab;

  useEffect(() => {
    if (!monacoRef.current) {
      return;
    }

    completionRef.current?.dispose();
    completionRef.current = registerSqlCompletionProvider({
      monaco: monacoRef.current,
      getActiveConnectionId: () => activeSession?.connectionId ?? null,
      getConnectionId: () => workspace.activeTab?.targetConnectionId ?? null,
      onError: (error) => {
        onError(new Error(error.message));
      },
    });

    return () => {
      completionRef.current?.dispose();
      completionRef.current = null;
    };
  }, [activeSession?.connectionId, onError, workspace.activeTab?.targetConnectionId]);

  const handleMount = (
    editorInstance: Monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof Monaco,
  ) => {
    editorRef.current = editorInstance;
    monacoRef.current = monacoInstance;

    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      void runActiveEditor();
    });
  };

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
        caught instanceof Error
          ? caught
          : new Error('Failed to resolve the current SQL statement.'),
      );
    }
  }

  return (
    <div className="grid h-full min-h-[320px] grid-rows-[auto_auto_minmax(0,1fr)] bg-[var(--surface-1)]">
      <div className="border-b border-[var(--line-soft)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-3)]">SQL workspace</p>
            <h3 className="mt-2 font-display text-3xl text-[var(--ink-1)]">
              Native-feeling tabs for focused query work.
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center gap-2 border border-[var(--line-strong)] bg-[var(--accent-soft)] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-1)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-softer)]"
              data-testid="new-query-tab-button"
              onClick={workspace.createTab}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              New tab
            </button>
            <button
              className="inline-flex items-center gap-2 border border-[var(--line-strong)] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-1)] transition hover:border-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="run-query-button"
              disabled={workspace.runDisabledReason !== null}
              onClick={() => {
                void runActiveEditor();
              }}
              type="button"
            >
              <Play className="h-3.5 w-3.5" />
              Run
            </button>
            <button
              className="inline-flex items-center gap-2 border border-[var(--line-soft)] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-2)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink-1)] disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="cancel-query-button"
              disabled={!activeTab?.execution.jobId}
              onClick={() => {
                if (activeTab) {
                  void workspace.cancelTabQuery(activeTab.id);
                }
              }}
              type="button"
            >
              <Square className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-2)]">
          {workspace.runDisabledReason ??
            'Run the current statement with Cmd/Ctrl+Enter. A non-empty selection always wins.'}
        </p>
      </div>

      <div className="grid gap-px border-b border-[var(--line-soft)] bg-[var(--line-soft)] sm:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-h-[52px] flex-wrap gap-px bg-[var(--line-soft)]">
          {workspace.tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                className={`flex min-w-[180px] flex-1 items-center justify-between gap-2 px-3 py-3 ${
                  isActive ? 'bg-[var(--surface-0)]' : 'bg-[var(--surface-1)]'
                }`}
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
                    <p className="truncate text-sm font-medium text-[var(--ink-1)]">{tab.title}</p>
                    {tab.dirty ? (
                      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent-strong)]" />
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--ink-3)]">
                    {tab.execution.status === 'idle' ? 'Idle' : tab.execution.status}
                  </p>
                </button>
                <button
                  className="text-[var(--ink-3)] transition hover:text-[var(--ink-1)]"
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
        <label className="flex items-center gap-2 bg-[var(--surface-0)] px-3 py-3 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
          Target
          <select
            className="w-full border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-2 text-sm tracking-normal text-[var(--ink-1)] outline-none"
            data-testid="query-target-select"
            onChange={(event) => {
              if (activeTab) {
                workspace.setTabTargetConnection(activeTab.id, event.currentTarget.value || null);
              }
            }}
            value={activeTab?.targetConnectionId ?? ''}
          >
            <option value="">Select saved target</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-0)_90%,_white_10%)] px-4 py-3 text-sm text-[var(--ink-2)]">
          <div className="flex flex-wrap items-center gap-3">
            <span>Active connection: {activeSession?.name ?? 'none'}</span>
            <span>Tab target: {connectionNameFor(activeTab?.targetConnectionId ?? null, connections)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
            <span>{activeTab?.execution.status ?? 'idle'}</span>
            <span>
              {activeTab?.execution.lastEvent?.finishedAt
                ? formatLongTime(activeTab.execution.lastEvent.finishedAt)
                : 'Not executed yet'}
            </span>
          </div>
        </div>

        <div className="min-h-0">
          <Editor
            defaultLanguage="sql"
            height="100%"
            onMount={handleMount}
            options={{
              automaticLayout: true,
              fontSize: 14,
              minimap: { enabled: false },
              padding: { top: 16 },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
            }}
            path={activeTab?.id ?? 'query-tab'}
            theme="vs"
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

export function QueryResultsPanel({ activeSession, result, tab }: QueryResultsPanelProps) {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <section className="grid gap-4">
        <article className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Last execution</p>
          <div className="mt-3 grid gap-2 text-sm text-[var(--ink-2)]">
            <p>Status: {tab?.execution.status ?? 'idle'}</p>
            <p>Connection: {activeSession?.name ?? 'none'}</p>
            <p>Elapsed: {tab?.execution.lastEvent ? `${tab.execution.lastEvent.elapsedMs} ms` : 'n/a'}</p>
            <p>Query: {tab?.title ?? 'n/a'}</p>
          </div>
        </article>
        <article className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Latest message</p>
          <p className="mt-3 text-sm text-[var(--ink-2)]">
            {tab?.execution.lastError?.message ??
              tab?.lastExecutionSummary ??
              'Run a query to populate the results panel.'}
          </p>
        </article>
      </section>

      <section className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Preview</p>
        {result ? (
          <ResultPreview result={result} />
        ) : (
          <p className="mt-4 text-sm text-[var(--ink-2)]">No result yet.</p>
        )}
      </section>
    </div>
  );
}

function ResultPreview({ result }: { result: QueryExecutionResult }) {
  if (result.kind === 'command') {
    return (
      <div className="mt-4 grid gap-3 text-sm text-[var(--ink-2)]">
        <p className="font-medium text-[var(--ink-1)]">{result.commandTag}</p>
        <p>Rows affected: {result.rowsAffected ?? 'unknown'}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-3">
      <p className="text-sm text-[var(--ink-2)]">{formatResultColumns(result.columns)}</p>
      <div className="overflow-auto border border-[var(--line-soft)]">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-1)] text-[var(--ink-3)]">
            <tr>
              {result.columns.map((column) => (
                <th className="border-b border-[var(--line-soft)] px-3 py-2 font-medium" key={column.name}>
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.previewRows.map((row, rowIndex) => (
              <tr className="border-b border-[var(--line-soft)]" key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td className="px-3 py-2 text-[var(--ink-2)]" key={`cell-${rowIndex}-${cellIndex}`}>
                    {cell ?? 'null'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
        {result.previewRowCount} rows previewed{result.truncated ? ' (truncated to 200 rows)' : ''}
      </p>
    </div>
  );
}

function connectionNameFor(connectionId: string | null, connections: ConnectionSummary[]): string {
  if (!connectionId) {
    return 'none';
  }

  return connections.find((connection) => connection.id === connectionId)?.name ?? connectionId;
}
