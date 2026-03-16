import { startTransition, useMemo, useState } from 'react';
import { QueryResultsPanel, type QueryResultsView } from './QueryWorkspace';
import type {
  AppError,
  QueryExecutionAccepted,
  QueryExecutionProgressEvent,
  QueryExecutionResult,
  QueryResultCell,
  QueryResultExportProgressEvent,
  QueryResultExportStatus,
  QueryResultFilter,
  QueryResultStatus,
  QueryResultSetSummary,
  QueryResultSort,
} from '../../lib/contracts';
import type {
  QueryTabResultState,
  QueryTabState,
  QueryWorkspaceState,
} from './useQueryWorkspace';

type HarnessScenarioId =
  | 'command'
  | 'small-complete'
  | 'query-running'
  | 'large-complete'
  | 'query-failed'
  | 'query-cancelled'
  | 'export-running'
  | 'export-failed';

const activeSession = {
  connectionId: 'conn-harness',
  name: 'Harness Postgres',
  engine: 'postgresql' as const,
  database: 'sparow_harness',
  username: 'sparow',
  host: '127.0.0.1',
  port: 5432,
  connectedAt: '2026-03-12T08:00:00.000Z',
  serverVersion: 'PostgreSQL 17',
  sslInUse: false,
  status: 'connected' as const,
};

const baseColumns = [
  { name: 'id', postgresType: 'int4', semanticType: 'number', isNullable: false },
  { name: 'name', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'city', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'active', postgresType: 'bool', semanticType: 'boolean', isNullable: false },
  { name: 'email', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'team', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'plan', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'order_count', postgresType: 'int4', semanticType: 'number', isNullable: false },
  { name: 'lifetime_value', postgresType: 'numeric', semanticType: 'number', isNullable: false },
  { name: 'last_seen_at', postgresType: 'timestamp', semanticType: 'temporal', isNullable: false },
] as const;

const cities = ['Jerusalem', 'Tel Aviv', 'Haifa', 'Beer Sheva'] as const;
const teams = ['Growth', 'Platform', 'Finance', 'Support'] as const;
const plans = ['starter', 'pro', 'enterprise'] as const;

const baseRows: QueryResultCell[][] = Array.from({ length: 1_200 }, (_, index) => [
  index + 1,
  `customer-${String(index + 1).padStart(4, '0')}`,
  cities[index % cities.length] ?? 'Jerusalem',
  index % 3 !== 0,
  `customer-${String(index + 1).padStart(4, '0')}@sparow.test`,
  teams[index % teams.length] ?? 'Growth',
  plans[index % plans.length] ?? 'starter',
  12 + (index % 41),
  4200 + index * 18.75,
  `2026-03-${String(1 + (index % 9)).padStart(2, '0')} 1${index % 10}:2${index % 6}:0${index % 5}`,
]);

export function ResultViewerHarness() {
  const scenarios = useMemo(() => buildScenarios(), []);
  const initialScenario = scenarios['large-complete'];
  const [activeView, setActiveView] = useState<QueryResultsView>('results');
  const [scenarioId, setScenarioId] = useState<HarnessScenarioId>('large-complete');
  const [tab, setTab] = useState<QueryTabState>(() => initialScenario.tab);
  const [rows, setRows] = useState<QueryResultCell[][]>(() => initialScenario.rows);
  const visibleRows = useMemo(
    () => applyViewerDescriptors(rows, tab.result.sort, tab.result.filters, tab.result.quickFilter),
    [rows, tab.result.sort, tab.result.filters, tab.result.quickFilter],
  );

  const workspace: QueryWorkspaceState = {
    activeTab: tab,
    activeTabId: tab.id,
    runDisabledReason: null,
    tabs: [tab],
    createTab: noop,
    createNewTab: noop,
    closeTab: noop,
    selectTab: noop,
    setTabSql: noop,
    updateTabSql: noop,
    setTabTargetConnection: noop,
    updateTabTargetConnection: noop,
    startTabQuery: noopAsync as QueryWorkspaceState['startTabQuery'],
    runActiveTab: noopAsync as QueryWorkspaceState['runActiveTab'],
    cancelTabQuery: noopAsync as QueryWorkspaceState['cancelTabQuery'],
    cancelActiveTab: noopAsync as QueryWorkspaceState['cancelActiveTab'],
    loadTabResultWindow: (tabId: string, offset: number, limit: number) => {
      void tabId;
      setTab((current) => loadScenarioWindow(current, visibleRows, offset, limit));
      return Promise.resolve();
    },
    setTabQuickFilter: (tabId: string, value: string) => {
      void tabId;
      startTransition(() => {
        setTab((current) =>
          invalidateHarnessWindow({
            ...current,
            result: {
              ...current.result,
              quickFilter: value,
            },
          }),
        );
      });
    },
    setTabColumnFilter: (tabId: string, columnIndex: number, value: string) => {
      void tabId;
      startTransition(() => {
        setTab((current) =>
          invalidateHarnessWindow({
            ...current,
            result: {
              ...current.result,
              filters: updateHarnessFilters(current.result.filters, columnIndex, value),
            },
          }),
        );
      });
    },
    toggleTabSort: (tabId: string, columnIndex: number) => {
      void tabId;
      startTransition(() => {
        setTab((current) =>
          invalidateHarnessWindow({
            ...current,
            result: {
              ...current.result,
              sort: toggleHarnessSort(current.result.sort, columnIndex),
            },
          }),
        );
      });
    },
    setTabExportOutputPath: (tabId: string, outputPath: string) => {
      void tabId;
      setTab((current) => ({
        ...current,
        result: {
          ...current.result,
          exportOutputPath: outputPath,
        },
      }));
    },
    startTabResultExport: () => {
      setTab((current) => ({
        ...current,
        result: {
          ...current.result,
          exportJobId: 'export-job-harness',
          exportStatus:
            scenarioId === 'export-failed' ? 'failed' : ('running' satisfies QueryResultExportStatus),
          exportLastEvent: {
            jobId: 'export-job-harness',
            correlationId: 'harness-export',
            resultSetId: current.result.summary?.resultSetId ?? 'harness-result',
            outputPath: current.result.exportOutputPath || './sparow-harness.csv',
            status:
              scenarioId === 'export-failed' ? 'failed' : ('running' satisfies QueryResultExportStatus),
            rowsWritten: scenarioId === 'export-failed' ? 32 : 480,
            message:
              scenarioId === 'export-failed'
                ? 'Harness export failed after writing a partial CSV.'
                : 'Harness export is writing rows to CSV.',
            startedAt: '2026-03-12T08:10:00.000Z',
            finishedAt: scenarioId === 'export-failed' ? '2026-03-12T08:10:01.000Z' : null,
            lastError:
              scenarioId === 'export-failed'
                ? buildError('harness_export_failed', 'Harness export failed.')
                : null,
          },
          exportLastError:
            scenarioId === 'export-failed'
              ? buildError('harness_export_failed', 'Harness export failed.')
              : null,
        },
      }));
      return Promise.resolve();
    },
    cancelTabResultExport: () => {
      setTab((current) => ({
        ...current,
        result: {
          ...current.result,
          exportJobId: null,
          exportStatus: 'cancelled',
          exportLastEvent: {
            jobId: 'export-job-harness',
            correlationId: 'harness-export',
            resultSetId: current.result.summary?.resultSetId ?? 'harness-result',
            outputPath: current.result.exportOutputPath || './sparow-harness.csv',
            status: 'cancelled',
            rowsWritten: 120,
            message: 'Harness export cancelled.',
            startedAt: '2026-03-12T08:10:00.000Z',
            finishedAt: '2026-03-12T08:10:00.500Z',
            lastError: buildError('harness_export_cancelled', 'Harness export cancelled.'),
          },
          exportLastError: buildError('harness_export_cancelled', 'Harness export cancelled.'),
        },
      }));
      return Promise.resolve();
    },
  };

  const currentScenario = scenarios[scenarioId];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_color-mix(in_oklch,_var(--surface-highlight)_68%,_black_32%),_transparent_44%),_linear-gradient(180deg,_#18181c_0%,_#111214_100%)] px-6 py-6 text-[var(--text-primary)]">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1500px] grid-rows-[auto_minmax(0,1fr)] gap-4">
        <header className="grid gap-3 rounded-[28px] border border-[color-mix(in_oklch,_var(--border-subtle)_76%,_white_24%)] bg-[color-mix(in_oklch,_var(--surface-panel)_86%,_black_14%)] px-5 py-5 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.65)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Result Viewer Harness</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Agent-visible result scenarios</h1>
            </div>
            <div className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-1 text-xs text-[var(--text-secondary)]">
              `/?harness=results`
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
            <label className="grid gap-1">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Scenario</span>
              <select
                className="h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 text-sm outline-none"
                data-testid="harness-scenario-select"
                onChange={(event) => {
                  const nextScenarioId = event.target.value as HarnessScenarioId;
                  const nextScenario = scenarios[nextScenarioId];
                  setScenarioId(nextScenarioId);
                  setTab(nextScenario.tab);
                  setRows(nextScenario.rows);
                }}
                value={scenarioId}
              >
                {Object.values(scenarios).map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-secondary)]">
              <p className="font-medium text-[var(--text-primary)]">{currentScenario.label}</p>
              <p className="mt-1">{currentScenario.description}</p>
            </div>
          </div>
        </header>

        <section
          className="min-h-0 overflow-hidden rounded-[30px] border border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_84%,_black_16%)] shadow-[0_32px_90px_-46px_rgba(0,0,0,0.72)]"
          data-testid="result-viewer-harness"
        >
          <QueryResultsPanel
            activeSession={activeSession}
            activeView={activeView}
            onActiveViewChange={setActiveView}
            workspace={workspace}
          />
        </section>
      </div>
    </div>
  );
}

function buildScenarios(): Record<HarnessScenarioId, { tab: QueryTabState; rows: QueryResultCell[][]; label: string; description: string; id: HarnessScenarioId }> {
  const summary = buildSummary('harness-large-complete', baseRows.length, baseRows.length, 'completed');
  return {
    command: {
      id: 'command',
      label: 'Command result',
      description: 'Completed command-only query with no row grid.',
      rows: [],
      tab: buildTab({
        title: 'vacuum analyze',
        status: 'completed',
        result: { kind: 'command', commandTag: 'VACUUM', rowsAffected: null },
        resultState: emptyResultState(),
      }),
    },
    'small-complete': {
      id: 'small-complete',
      label: 'Small completed rows',
      description: 'A compact finished result set for fast iteration on alignment and labels.',
      rows: baseRows.slice(0, 24),
      tab: buildTab({
        title: 'select * from customers limit 24',
        status: 'completed',
        result: { kind: 'rows', ...buildSummary('harness-small-complete', 24, 24, 'completed') },
        resultState: {
          ...emptyResultState(),
          summary: buildSummary('harness-small-complete', 24, 24, 'completed'),
          exportOutputPath: './small-complete.csv',
        },
      }),
    },
    'query-running': {
      id: 'query-running',
      label: 'Query running',
      description: 'A running query before result metadata is available.',
      rows: [],
      tab: buildTab({
        title: 'select * from customers order by id',
        status: 'running',
        result: null,
        resultState: emptyResultState(),
      }),
    },
    'large-complete': {
      id: 'large-complete',
      label: 'Large completed rows',
      description: 'Full result with inline sort and per-column filters available.',
      rows: baseRows,
      tab: buildTab({
        title: 'select * from customers order by id',
        status: 'completed',
        result: { kind: 'rows', ...summary },
        resultState: {
          ...emptyResultState(),
          summary,
          exportOutputPath: './large-complete.csv',
        },
      }),
    },
    'query-failed': {
      id: 'query-failed',
      label: 'Query failed',
      description: 'Execution failed before a full result grid became available.',
      rows: [],
      tab: buildTab({
        title: 'select * from missing_table',
        status: 'failed',
        result: null,
        resultState: emptyResultState(),
        lastError: buildError('query_sql_execution_failed', 'relation "missing_table" does not exist'),
      }),
    },
    'query-cancelled': {
      id: 'query-cancelled',
      label: 'Query cancelled',
      description: 'A cancelled query before a result grid was available.',
      rows: [],
      tab: buildTab({
        title: 'select * from customers, generate_series(1, 100000)',
        status: 'cancelled',
        result: null,
        resultState: emptyResultState(),
        lastError: buildError('query_cancelled', 'The running query was cancelled.'),
      }),
    },
    'export-running': {
      id: 'export-running',
      label: 'Export running',
      description: 'Completed result with an in-flight CSV export.',
      rows: baseRows,
      tab: buildTab({
        title: 'select * from customers',
        status: 'completed',
        result: { kind: 'rows', ...summary },
        resultState: {
          ...emptyResultState(),
          summary,
          exportOutputPath: './export-running.csv',
          exportJobId: 'export-job-running',
          exportStatus: 'running',
          exportLastEvent: buildExportEvent('running', './export-running.csv', 540),
        },
      }),
    },
    'export-failed': {
      id: 'export-failed',
      label: 'Export failed',
      description: 'Completed result whose CSV export terminated with an error.',
      rows: baseRows,
      tab: buildTab({
        title: 'select * from customers',
        status: 'completed',
        result: { kind: 'rows', ...summary },
        resultState: {
          ...emptyResultState(),
          summary,
          exportOutputPath: './export-failed.csv',
          exportStatus: 'failed',
          exportLastEvent: buildExportEvent('failed', './export-failed.csv', 32),
          exportLastError: buildError('harness_export_failed', 'Harness export failed.'),
        },
      }),
    },
  };
}

function buildTab(input: {
  title: string;
  status: QueryExecutionProgressEvent['status'];
  result: QueryExecutionResult | null;
  resultState: QueryTabResultState;
  lastError?: AppError | null;
}): QueryTabState {
  return {
    id: 'tab-harness',
    title: input.title,
    sql: input.title,
    targetConnectionId: activeSession.connectionId,
    dirty: false,
    lastExecutionSummary: input.lastError?.message ?? 'Harness scenario',
    lastRunSql: input.title,
    execution: {
      status: input.status,
      jobId: input.status === 'running' ? 'query-job-harness' : null,
      lastAccepted: buildAccepted(),
      lastEvent: buildExecutionEvent(input.status, input.result, input.lastError ?? null),
      lastResult: input.result,
      lastError: input.lastError ?? null,
    },
    result: input.resultState,
  };
}

function loadScenarioWindow(tab: QueryTabState, visibleRows: QueryResultCell[][], offset: number, limit: number): QueryTabState {
  const nextRows = visibleRows.slice(offset, offset + limit);
  return {
    ...tab,
    result: {
      ...tab.result,
      window: {
        resultSetId: tab.result.summary?.resultSetId ?? 'harness-result',
        offset,
        limit,
        rows: nextRows,
        visibleRowCount: visibleRows.length,
        bufferedRowCount: tab.result.summary?.bufferedRowCount ?? visibleRows.length,
        totalRowCount: tab.result.summary?.totalRowCount ?? null,
        status: tab.result.summary?.status ?? 'running',
        sort: tab.result.sort,
        filters: tab.result.filters,
        quickFilter: tab.result.quickFilter,
      },
      windowStatus: 'ready',
      requestedWindowSignature: JSON.stringify([offset, limit, tab.result.sort, tab.result.filters, tab.result.quickFilter]),
      windowError: null,
    },
  };
}

function applyViewerDescriptors(
  rows: QueryResultCell[][],
  sort: QueryResultSort | null,
  filters: QueryResultFilter[],
  quickFilter: string,
): QueryResultCell[][] {
  const quickFilterValue = quickFilter.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    if (quickFilterValue) {
      const quickMatch = row.some((cell) => String(cell ?? '').toLowerCase().includes(quickFilterValue));
      if (!quickMatch) {
        return false;
      }
    }

    return filters.every((filter) =>
      String(row[filter.columnIndex] ?? '')
        .toLowerCase()
        .includes(filter.value.trim().toLowerCase()),
    );
  });

  if (!sort) {
    return filteredRows;
  }

  return filteredRows.toSorted((left, right) => {
    const leftValue = left[sort.columnIndex];
    const rightValue = right[sort.columnIndex];
    if (leftValue === rightValue) {
      return 0;
    }

    const normalized =
      typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
    return sort.direction === 'asc' ? normalized : normalized * -1;
  });
}

function invalidateHarnessWindow(tab: QueryTabState): QueryTabState {
  return {
    ...tab,
    result: {
      ...tab.result,
      window: null,
      windowStatus: 'idle',
      requestedWindowSignature: null,
      windowError: null,
    },
  };
}

function updateHarnessFilters(filters: QueryResultFilter[], columnIndex: number, value: string): QueryResultFilter[] {
  const nextFilters = filters.filter((filter) => filter.columnIndex !== columnIndex);
  if (!value.trim()) {
    return nextFilters;
  }

  return [
    ...nextFilters,
    {
      columnIndex,
      mode: 'contains' as const,
      value,
    },
  ].toSorted((left, right) => left.columnIndex - right.columnIndex);
}

function toggleHarnessSort(sort: QueryResultSort | null, columnIndex: number): QueryResultSort | null {
  if (!sort || sort.columnIndex !== columnIndex) {
    return { columnIndex, direction: 'asc' };
  }
  if (sort.direction === 'asc') {
    return { columnIndex, direction: 'desc' };
  }
  return null;
}

function emptyResultState(): QueryTabResultState {
  return {
    summary: null,
    window: null,
    windowStatus: 'idle',
    windowError: null,
    requestedWindowSignature: null,
    quickFilter: '',
    filters: [],
    sort: null,
    exportOutputPath: '',
    exportJobId: null,
    exportStatus: 'idle',
    exportLastEvent: null,
    exportLastError: null,
  };
}

function buildSummary(
  resultSetId: string,
  bufferedRowCount: number,
  totalRowCount: number | null,
  status: QueryResultStatus,
): QueryResultSetSummary {
  return {
    resultSetId,
    columns: [...baseColumns],
    bufferedRowCount,
    totalRowCount,
    status,
  };
}

function buildExportEvent(
  status: QueryResultExportProgressEvent['status'],
  outputPath: string,
  rowsWritten: number,
): QueryResultExportProgressEvent {
  return {
    jobId: 'export-job-harness',
    correlationId: 'export-correlation-harness',
    resultSetId: 'harness-large-complete',
    outputPath,
    status,
    rowsWritten,
    message:
      status === 'failed'
        ? 'Harness export failed.'
        : status === 'completed'
          ? 'Harness export completed.'
          : 'Harness export is running.',
    startedAt: '2026-03-12T08:10:00.000Z',
    finishedAt: status === 'running' ? null : '2026-03-12T08:10:01.000Z',
    lastError: status === 'failed' ? buildError('harness_export_failed', 'Harness export failed.') : null,
  };
}

function buildExecutionEvent(
  status: QueryExecutionProgressEvent['status'],
  result: QueryExecutionResult | null,
  error: AppError | null,
): QueryExecutionProgressEvent {
  return {
    jobId: 'query-job-harness',
    correlationId: 'query-correlation-harness',
    tabId: 'tab-harness',
    connectionId: activeSession.connectionId,
    status,
    elapsedMs: 48,
    message: error?.message ?? 'Harness execution event.',
    startedAt: '2026-03-12T08:00:00.000Z',
    finishedAt: status === 'running' ? null : '2026-03-12T08:00:00.048Z',
    lastError: error,
    result,
  };
}

function buildAccepted(): QueryExecutionAccepted {
  return {
    jobId: 'query-job-harness',
    correlationId: 'query-correlation-harness',
    tabId: 'tab-harness',
    connectionId: activeSession.connectionId,
    startedAt: '2026-03-12T08:00:00.000Z',
  };
}

function buildError(code: string, message: string): AppError {
  return {
    code,
    message,
    detail: null,
    retryable: false,
    correlationId: `harness-${code}`,
  };
}

function noop() {}

function noopAsync() {
  return Promise.resolve();
}
