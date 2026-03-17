import { useMemo, useState } from 'react';
import { Bug, ChevronDown, Database, Settings2, UserRound } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { TooltipProvider } from '../../components/ui/tooltip';
import { ConnectionsRail } from '../connections/ConnectionWorkspace';
import { QueryResultsPanel, QueryTabStrip, QueryWorkspace, type QueryResultsView } from '../query/QueryWorkspace';
import type {
  QueryTabState,
  QueryWorkspaceState,
} from '../query/useQueryWorkspace';
import { SchemaSidebar } from '../schema/SchemaWorkspace';
import { AppShell } from './AppShell';
import type {
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryExecutionResult,
  QueryResultCell,
  QueryResultColumn,
  QueryResultFilter,
  QueryResultSetSummary,
  QueryResultSort,
  QueryResultWindow,
  SchemaNode,
} from '../../lib/contracts';

const connections: ConnectionSummary[] = [
  {
    id: 'conn-production',
    engine: 'postgresql',
    name: 'Production',
    host: 'prod.internal',
    port: 5432,
    database: 'acme_prod',
    username: 'acme_prod',
    sslMode: 'require',
    hasStoredSecret: true,
    secretProvider: 'os-keychain',
    lastTestedAt: '2026-03-11T10:00:00.000Z',
    lastConnectedAt: '2026-03-11T10:12:00.000Z',
    updatedAt: '2026-03-11T10:12:00.000Z',
  },
  {
    id: 'conn-staging',
    engine: 'postgresql',
    name: 'Staging',
    host: 'c9srcab37moub2.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com',
    port: 5432,
    database: 'd5l1u89pljf0v',
    username: 'ufteshubblio40h',
    sslMode: 'prefer',
    hasStoredSecret: true,
    secretProvider: 'os-keychain',
    lastTestedAt: '2026-03-11T10:00:00.000Z',
    lastConnectedAt: '2026-03-11T10:12:00.000Z',
    updatedAt: '2026-03-11T10:12:00.000Z',
  },
  {
    id: 'conn-analytics',
    engine: 'postgresql',
    name: 'Analytics DW',
    host: 'warehouse.internal',
    port: 5432,
    database: 'analytics',
    username: 'analytics_ro',
    sslMode: 'require',
    hasStoredSecret: true,
    secretProvider: 'os-keychain',
    lastTestedAt: '2026-03-11T10:00:00.000Z',
    lastConnectedAt: null,
    updatedAt: '2026-03-11T10:12:00.000Z',
  },
  {
    id: 'conn-local',
    engine: 'postgresql',
    name: 'Local Dev',
    host: '127.0.0.1',
    port: 5432,
    database: 'sparow_dev',
    username: 'sparow',
    sslMode: 'insecure',
    hasStoredSecret: true,
    secretProvider: 'os-keychain',
    lastTestedAt: '2026-03-11T10:00:00.000Z',
    lastConnectedAt: null,
    updatedAt: '2026-03-11T10:12:00.000Z',
  },
];

const columns: QueryResultColumn[] = [
  { name: 'id', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'name', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'email', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'role', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'order_count', postgresType: 'int4', semanticType: 'number', isNullable: false },
  { name: 'lifetime_value', postgresType: 'numeric', semanticType: 'number', isNullable: false },
  { name: 'last_order_at', postgresType: 'timestamptz', semanticType: 'temporal', isNullable: false },
];

const baseRows: QueryResultCell[][] = Array.from({ length: 140 }, (_, index) => [
  `${(index + 1).toString(16).padStart(8, '0')}`,
  ['Sarah Chen', 'Marcus Webb', 'Priya Nair', 'Tom Russo', 'Aiko Tanaka', 'Lena Bauer', 'Carlos Vega', 'Olivia Kim'][index % 8] ?? 'Analyst',
  `person-${String(index + 1).padStart(3, '0')}@acme.com`,
  index % 5 === 0 ? 'admin' : 'user',
  48 - (index % 17),
  `$${(12_840 - index * 48.25).toFixed(2)}`,
  `2026-03-${String(11 - (index % 7)).padStart(2, '0')} 1${index % 9}:2${index % 6}:0${index % 5}`,
]);

const schemaRows = buildSchemaRows();

export function ShellHarness() {
  const [selectedConnectionId, setSelectedConnectionId] = useState('conn-staging');
  const [activeSession, setActiveSession] = useState<DatabaseSessionSnapshot | null>(() =>
    toSession('conn-staging'),
  );
  const [activeResultsView, setActiveResultsView] = useState<QueryResultsView>('results');
  const [tabs, setTabs] = useState<QueryTabState[]>(() => createInitialTabs('conn-staging'));
  const [activeTabId, setActiveTabId] = useState<string>('tab-lifetime');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSchemaPath, setSelectedSchemaPath] = useState<string | null>('schema/public');

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const schemaSearchResults = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }

    return schemaRows
      .map((row) => row.node)
      .filter((node) => node.name.toLowerCase().includes(trimmed) || node.path.toLowerCase().includes(trimmed))
      .slice(0, 16);
  }, [searchQuery]);

  const workspace: QueryWorkspaceState = {
    activeTab,
    activeTabId,
    runDisabledReason: activeSession ? null : 'Connect the matching saved profile before running a query.',
    tabs,
    createTab: () => {
      const nextTab = buildTab(`tab-${tabs.length + 1}`, 'new_query.sql', activeSession?.connectionId ?? null);
      setTabs((current) => [...current, nextTab]);
      setActiveTabId(nextTab.id);
    },
    createNewTab: () => {},
    closeTab: (tabId) => {
      setTabs((current) => {
        const nextTabs = current.filter((tab) => tab.id !== tabId);
        const fallback = nextTabs[0] ?? buildTab('tab-fallback', 'scratch.sql', activeSession?.connectionId ?? null);
        if (activeTabId === tabId) {
          setActiveTabId(fallback.id);
        }
        return nextTabs.length > 0 ? nextTabs : [fallback];
      });
    },
    selectTab: setActiveTabId,
    setTabSql: (tabId, sql) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                sql,
                title: sql.split('\n')[0]?.trim() || 'query.sql',
                dirty: true,
              }
            : tab,
        ),
      );
    },
    updateTabSql: () => {},
    setTabTargetConnection: (tabId, connectionId) => {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? refreshTabResult({ ...tab, targetConnectionId: connectionId }) : tab)));
    },
    updateTabTargetConnection: () => {},
    startTabQuery: (tabId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? refreshTabResult({
                ...tab,
                execution: {
                  ...tab.execution,
                  status: 'completed',
                  jobId: null,
                  lastAccepted: {
                    jobId: 'harness-query-job',
                    correlationId: 'harness-query-corr',
                    tabId,
                    connectionId: activeSession?.connectionId ?? '',
                    startedAt: '2026-03-11T10:15:00.000Z',
                  },
                  lastEvent: {
                    jobId: 'harness-query-job',
                    correlationId: 'harness-query-corr',
                    tabId,
                    connectionId: activeSession?.connectionId ?? '',
                    status: 'completed',
                    elapsedMs: 42,
                    message: 'Harness query completed.',
                    startedAt: '2026-03-11T10:15:00.000Z',
                    finishedAt: '2026-03-11T10:15:00.042Z',
                    lastError: null,
                    result: buildResultSummary(tab.id),
                  },
                  lastResult: buildResultSummary(tab.id),
                  lastError: null,
                },
              })
            : tab,
        ),
      );
      return Promise.resolve();
    },
    runActiveTab: async () => {},
    cancelTabQuery: (tabId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                execution: {
                  ...tab.execution,
                  status: 'cancelled',
                  jobId: null,
                },
              }
            : tab,
        ),
      );
      return Promise.resolve();
    },
    cancelActiveTab: async () => {},
    loadTabResultWindow: (tabId, offset, limit) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? refreshTabResult(tab, {
                offset,
                limit,
              })
            : tab,
        ),
      );
      return Promise.resolve();
    },
    setTabQuickFilter: (tabId, value) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? refreshTabResult({
                ...tab,
                result: {
                  ...tab.result,
                  quickFilter: value,
                },
              })
            : tab,
        ),
      );
    },
    setTabColumnFilter: (tabId, columnIndex, value) => {
      setTabs((current) =>
        current.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }

          const nextFilters = tab.result.filters.filter((filter) => filter.columnIndex !== columnIndex);
          if (value.trim()) {
            nextFilters.push({
              columnIndex,
              mode: 'contains',
              value,
            });
          }

          return refreshTabResult({
            ...tab,
            result: {
              ...tab.result,
              filters: nextFilters,
            },
          });
        }),
      );
    },
    toggleTabSort: (tabId, columnIndex) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? refreshTabResult({
                ...tab,
                result: {
                  ...tab.result,
                  sort:
                    tab.result.sort?.columnIndex === columnIndex
                      ? tab.result.sort.direction === 'asc'
                        ? { columnIndex, direction: 'desc' }
                        : null
                      : { columnIndex, direction: 'asc' },
                },
              })
            : tab,
        ),
      );
    },
    setTabExportOutputPath: (tabId, outputPath) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                result: {
                  ...tab.result,
                  exportOutputPath: outputPath,
                },
              }
            : tab,
        ),
      );
    },
    startTabResultExport: (tabId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                result: {
                  ...tab.result,
                  exportJobId: 'export-job-harness',
                  exportStatus: 'running',
                },
              }
            : tab,
        ),
      );
      return Promise.resolve();
    },
    cancelTabResultExport: (tabId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                result: {
                  ...tab.result,
                  exportJobId: null,
                  exportStatus: 'cancelled',
                },
              }
            : tab,
        ),
      );
      return Promise.resolve();
    },
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="h-dvh overflow-hidden" data-testid="shell-harness">
        <AppShell
        connectionDialog={null}
        diagnosticsDialog={null}
        editor={
          <QueryWorkspace
            activeSession={activeSession}
            connections={connections}
            onError={() => {}}
            showTabStrip={false}
            workspace={workspace}
          />
        }
        editorTabs={<QueryTabStrip workspace={workspace} />}
        headerBar={
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-muted)] text-[var(--accent-text)]">
                  <Database className="h-4 w-4" />
                </div>
                <p className="text-lg font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Sparow</p>
              </div>
              <div className="hidden items-center gap-1 text-sm text-[var(--text-secondary)] md:flex">
                {['File', 'Edit', 'View', 'Query', 'Tools'].map((label) => (
                  <button className="rounded-lg px-3 py-2 transition hover:bg-[var(--surface-panel-hover)] hover:text-[var(--text-primary)]" key={label} type="button">
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge>development</Badge>
              <Badge>darwin-aarch64</Badge>
              <Button className="min-w-[210px] justify-between" size="sm" type="button" variant="secondary">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--success-text)]" />
                  <span className="text-left">
                    <span className="block text-sm font-medium text-[var(--text-primary)]">{activeSession?.name ?? 'No connection'}</span>
                    <span className="block text-[11px] text-[var(--text-muted)]">{activeSession?.database ?? 'Select a target'}</span>
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
              </Button>
              <Button size="sm" type="button" variant="ghost">
                <Bug className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" type="button" variant="ghost">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_oklch,_var(--accent-solid)_52%,_var(--surface-panel)_48%)] text-[var(--accent-foreground)]">
                <UserRound className="h-4 w-4" />
              </div>
            </div>
          </div>
        }
        isLoading={false}
        leftSidebar={
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <ConnectionsRail
              activeSession={activeSession}
              canDisconnect={Boolean(activeSession)}
              connectingConnectionId={null}
              connections={connections}
              onActivateConnection={(connectionId) => {
                setSelectedConnectionId(connectionId);
                setActiveSession(toSession(connectionId));
                setTabs((current) => current.map((tab) => refreshTabResult({ ...tab, targetConnectionId: connectionId })));
                return Promise.resolve();
              }}
              onCreateConnection={() => {}}
              onDisconnectSelected={() => {
                setActiveSession(null);
                return Promise.resolve();
              }}
              onEditSelected={() => {}}
              onSelectConnection={setSelectedConnectionId}
              selectedConnectionId={selectedConnectionId}
            />
            <SchemaSidebar
              activeSession={activeSession}
              schema={{
                activeConnectionId: activeSession?.connectionId ?? null,
                isDisabled: activeSession === null,
                isLoadingRoot: false,
                latestRefreshEvent: null,
                searchQuery,
                searchResults: schemaSearchResults,
                scopes: {},
                selectedNode: schemaRows.find((row) => row.node.path === selectedSchemaPath)?.node ?? null,
                visibleRows: schemaRows,
                setSearchQuery,
                selectNode: (node) => {
                  setSelectedSchemaPath(node.path);
                },
                toggleNode: (node) => {
                  setSelectedSchemaPath(node.path);
                  return Promise.resolve();
                },
                refreshSelectedScope: async () => {},
                handleTreeNavigation: async () => {},
              }}
            />
          </div>
        }
        results={
          <QueryResultsPanel
            activeSession={activeSession}
            activeView={activeResultsView}
            onActiveViewChange={setActiveResultsView}
            workspace={workspace}
          />
        }
        statusBar={
          <div className="flex flex-col gap-2 px-4 py-2 text-sm text-[var(--text-secondary)] md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={activeSession ? 'success' : 'warning'}>{activeSession ? 'Ready' : 'Idle'}</Badge>
              <span>{activeSession ? `${activeSession.name} — ${activeSession.database}` : 'No active session'}</span>
              <span className="hidden lg:inline">{activeSession?.serverVersion ?? 'No server version'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span>{activeTab?.execution.status ?? 'idle'}</span>
              <span>{activeTab?.result.summary?.bufferedRowCount ?? 0} rows</span>
              <span>{activeTab?.execution.lastEvent?.elapsedMs ?? 0} ms</span>
            </div>
          </div>
        }
        />
      </div>
    </TooltipProvider>
  );
}

function createInitialTabs(connectionId: string): QueryTabState[] {
  return [
    refreshTabResult(buildTab('tab-lifetime', 'user_lifetime.sql', connectionId)),
    refreshTabResult(buildTab('tab-revenue', 'revenue_report.sql', connectionId)),
    refreshTabResult(buildTab('tab-users', 'users.sql', connectionId)),
  ];
}

function buildTab(id: string, title: string, connectionId: string | null): QueryTabState {
  const result = buildResultSummary(id);
  return {
    id,
    title,
    sql: `select current_database(), current_user, now();`,
    targetConnectionId: connectionId,
    dirty: false,
    lastExecutionSummary: 'Query completed with rows ready.',
    lastRunSql: 'select current_database(), current_user, now();',
    execution: {
      status: 'completed',
      jobId: null,
      lastAccepted: {
        jobId: 'harness-job',
        correlationId: 'harness-corr',
        tabId: id,
        connectionId: connectionId ?? '',
        startedAt: '2026-03-11T10:15:00.000Z',
      },
      lastEvent: {
        jobId: 'harness-job',
        correlationId: 'harness-corr',
        tabId: id,
        connectionId: connectionId ?? '',
        status: 'completed',
        elapsedMs: 42,
        message: 'Harness query completed.',
        startedAt: '2026-03-11T10:15:00.000Z',
        finishedAt: '2026-03-11T10:15:00.042Z',
        lastError: null,
        result,
      },
      lastResult: result,
      lastError: null,
    },
    result: {
      summary: buildSummary(id, baseRows.length),
      window: null,
      windowStatus: 'idle',
      windowError: null,
      requestedWindowSignature: null,
      quickFilter: '',
      filters: [],
      sort: null,
      exportOutputPath: './sparow-result.csv',
      exportJobId: null,
      exportStatus: 'idle',
      exportLastEvent: null,
      exportLastError: null,
    },
  };
}

function buildSummary(id: string, rowCount: number): QueryResultSetSummary {
  return {
    resultSetId: `result-${id}`,
    columns,
    bufferedRowCount: rowCount,
    totalRowCount: rowCount,
    status: 'completed',
  };
}

function buildResultSummary(id: string): QueryExecutionResult {
  return {
    kind: 'rows',
    ...buildSummary(id, baseRows.length),
  };
}

function refreshTabResult(tab: QueryTabState, windowRequest?: { offset: number; limit: number }): QueryTabState {
  const visibleRows = applyRows(baseRows, tab.result.sort, tab.result.filters, tab.result.quickFilter);
  const offset = windowRequest?.offset ?? tab.result.window?.offset ?? 0;
  const limit = windowRequest?.limit ?? tab.result.window?.limit ?? 28;
  const nextWindow = buildWindow(tab.result.summary?.resultSetId ?? `result-${tab.id}`, visibleRows, offset, limit, tab.result.sort, tab.result.filters, tab.result.quickFilter);

  return {
    ...tab,
    result: {
      ...tab.result,
      summary: buildSummary(tab.id, visibleRows.length),
      window: nextWindow,
      windowStatus: 'ready',
      requestedWindowSignature: `${offset}:${limit}:${tab.result.quickFilter}:${JSON.stringify(tab.result.filters)}:${JSON.stringify(tab.result.sort)}`,
    },
  };
}

function applyRows(
  rows: QueryResultCell[][],
  sort: QueryResultSort | null,
  filters: QueryResultFilter[],
  quickFilter: string,
) {
  const filteredRows = rows.filter((row) => {
    const quick = quickFilter.trim().toLowerCase();
    if (quick && !row.some((cell) => String(cell ?? '').toLowerCase().includes(quick))) {
      return false;
    }

    return filters.every((filter) => String(row[filter.columnIndex] ?? '').toLowerCase().includes(filter.value.toLowerCase()));
  });

  if (!sort) {
    return filteredRows;
  }

  return filteredRows.toSorted((left, right) => {
    const leftValue = String(left[sort.columnIndex] ?? '');
    const rightValue = String(right[sort.columnIndex] ?? '');
    return sort.direction === 'asc' ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
  });
}

function buildWindow(
  resultSetId: string,
  rows: QueryResultCell[][],
  offset: number,
  limit: number,
  sort: QueryResultSort | null,
  filters: QueryResultFilter[],
  quickFilter: string,
): QueryResultWindow {
  return {
    resultSetId,
    offset,
    limit,
    rows: rows.slice(offset, offset + limit),
    visibleRowCount: rows.length,
    bufferedRowCount: rows.length,
    totalRowCount: rows.length,
    status: 'completed',
    sort,
    filters,
    quickFilter,
  };
}

function toSession(connectionId: string): DatabaseSessionSnapshot | null {
  const connection = connections.find((entry) => entry.id === connectionId);
  if (!connection) {
    return null;
  }

  return {
    connectionId: connection.id,
    name: connection.name,
    engine: connection.engine,
    database: connection.database,
    username: connection.username,
    host: connection.host,
    port: connection.port,
    connectedAt: '2026-03-11T10:12:00.000Z',
    serverVersion: 'PostgreSQL 16.2',
    sslInUse: true,
    status: 'connected',
  };
}

function buildSchemaRows() {
  const publicNode: SchemaNode = {
    kind: 'schema',
    id: 'schema/public',
    connectionId: 'conn-staging',
    name: 'public',
    path: 'schema/public',
    parentPath: null,
    schemaName: 'public',
    relationName: null,
    hasChildren: true,
    refreshedAt: '2026-03-11T10:00:00.000Z',
  };

  const tables = [
    'account',
    'account_member',
    'api_key',
    'asset',
    'banner',
    'blackout_time_slot',
    'refund_credit_transaction',
    'schedule',
    'service_subscription',
    'shipment_tracker',
    'shipping_destination',
    'slug',
    'submission_extension',
    'team_allocation',
    'time_slot_adjustment',
    'typeorm_metadata',
    'user',
    'vendor',
    'vendor_assignment_offer',
    'vendor_attendance_confirmation',
    'vendor_availability',
    'vendor_event_confirmation',
    'vendor_no_show_report',
    'vendor_poc',
    'virtual_meeting',
    'pg_stat_statements',
    'pg_stat_statements_info',
  ];

  return [
    {
      node: publicNode,
      depth: 0,
      childScopeStatus: 'fresh' as const,
      isExpanded: true,
      isRefreshing: false,
    },
    ...tables.map((tableName) => ({
      node: {
        kind: 'table' as const,
        id: `table/${tableName}`,
        connectionId: 'conn-staging',
        name: tableName,
        path: `table/public/${tableName}`,
        parentPath: 'schema/public',
        schemaName: 'public',
        relationName: tableName,
        hasChildren: false,
        refreshedAt: '2026-03-11T10:00:00.000Z',
      },
      depth: 1,
      childScopeStatus: null,
      isExpanded: false,
      isRefreshing: false,
    })),
  ];
}
