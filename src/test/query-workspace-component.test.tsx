import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { TooltipProvider } from '../components/ui/tooltip';
import { QueryResultsPanel, QueryWorkspace } from '../features/query/QueryWorkspace';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
} from '../lib/contracts';
import type {
  QueryTabState,
  QueryWorkspaceState,
} from '../features/query/useQueryWorkspace';

vi.mock('../features/query/executionSlice', () => ({
  resolveExecutionSlice: vi.fn(() => ({
    sql: 'select 1',
    origin: 'current-statement',
    isSelectionMultiStatement: false,
  })),
}));

const activeSession: DatabaseSessionSnapshot = {
  connectionId: 'conn-local-postgres',
  name: 'Local Postgres',
  engine: 'postgresql',
  database: 'app_dev',
  username: 'sparow',
  host: '127.0.0.1',
  port: 5432,
  connectedAt: '2026-03-10T16:45:00.000Z',
  serverVersion: 'PostgreSQL 17',
  sslInUse: true,
  status: 'connected',
};

const connections: ConnectionSummary[] = [
  {
    id: 'conn-local-postgres',
    engine: 'postgresql',
    name: 'Local Postgres',
    host: '127.0.0.1',
    port: 5432,
    database: 'app_dev',
    username: 'sparow',
    sslMode: 'prefer',
    hasStoredSecret: true,
    secretProvider: 'memory',
    lastTestedAt: null,
    lastConnectedAt: null,
    updatedAt: '2026-03-10T16:45:00.000Z',
  },
];

const baseExecution = {
  status: 'idle',
  jobId: null,
  lastAccepted: null,
  lastEvent: null,
  lastResult: null,
  lastError: null,
} as const;

const originalResizeObserver = globalThis.ResizeObserver;

function createTab(id: string, title: string, sql: string): QueryTabState {
  return {
    id,
    title,
    sql,
    targetConnectionId: 'conn-local-postgres',
    dirty: false,
    lastExecutionSummary: null,
    lastRunSql: null,
    execution: { ...baseExecution },
    result: {
      summary: null,
      latestStreamEvent: null,
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
    },
  };
}

class MockResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  disconnect() {}

  observe(target: Element) {
    this.callback(
      [
        {
          contentRect: {
            bottom: 480,
            height: 480,
            left: 0,
            right: 960,
            top: 0,
            width: 960,
            x: 0,
            y: 0,
            toJSON() {
              return {};
            },
          },
          target,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterAll(() => {
  if (originalResizeObserver) {
    vi.stubGlobal('ResizeObserver', originalResizeObserver);
    return;
  }

  vi.unstubAllGlobals();
});

function WorkspaceHarness({
  onError,
  onStartTabQuery,
}: {
  onError: (error: AppError | Error) => void;
  onStartTabQuery: QueryWorkspaceState['startTabQuery'];
}) {
  const [tabs, setTabs] = useState<QueryTabState[]>([
    createTab('tab-1', 'select 1', 'select 1'),
    createTab('tab-2', 'select 2', 'select 2'),
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const workspace: QueryWorkspaceState = {
    activeTab,
    activeTabId,
    runDisabledReason: null,
    tabs,
    createTab: vi.fn(),
    createNewTab: vi.fn(),
    closeTab: vi.fn(),
    selectTab: (tabId) => {
      setActiveTabId(tabId);
    },
    setTabSql: (tabId, sql) => {
      setTabs((currentTabs) =>
        currentTabs.map((tab) => (tab.id === tabId ? { ...tab, sql } : tab)),
      );
    },
    updateTabSql: (tabId, sql) => {
      setTabs((currentTabs) =>
        currentTabs.map((tab) => (tab.id === tabId ? { ...tab, sql } : tab)),
      );
    },
    setTabTargetConnection: vi.fn(),
    updateTabTargetConnection: vi.fn(),
    startTabQuery: onStartTabQuery,
    runActiveTab: vi.fn(),
    cancelTabQuery: vi.fn(),
    cancelActiveTab: vi.fn(),
    loadTabResultWindow: vi.fn(() => Promise.resolve()),
    setTabQuickFilter: vi.fn(),
    setTabColumnFilter: vi.fn(),
    toggleTabSort: vi.fn(),
    setTabExportOutputPath: vi.fn(),
    startTabResultExport: vi.fn(() => Promise.resolve()),
    cancelTabResultExport: vi.fn(() => Promise.resolve()),
  };

  return (
    <TooltipProvider>
      <QueryWorkspace
        activeSession={activeSession}
        connections={connections}
        onError={onError}
        workspace={workspace}
      />
    </TooltipProvider>
  );
}

describe('QueryWorkspace', () => {
  it('runs the currently selected tab when Cmd/Ctrl+Enter is pressed after switching tabs', async () => {
    const onError = vi.fn();
    const startTabQuery = vi.fn(() => Promise.resolve());
    render(<WorkspaceHarness onError={onError} onStartTabQuery={startTabQuery} />);

    fireEvent.click(screen.getByTestId('query-tab-tab-2'));
    fireEvent.keyDown(screen.getByTestId('monaco-editor'), {
      ctrlKey: true,
      key: 'Enter',
    });

    await waitFor(() => {
      expect(startTabQuery).toHaveBeenCalledWith('tab-2', {
        sql: 'select 1',
        origin: 'current-statement',
        isSelectionMultiStatement: false,
      });
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not render placeholder query actions that are not wired yet', () => {
    const onError = vi.fn();
    const startTabQuery = vi.fn(() => Promise.resolve());
    render(<WorkspaceHarness onError={onError} onStartTabQuery={startTabQuery} />);

    expect(screen.getByRole('button', { name: /^Run$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Format$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Explain$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^History$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export CSV/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Explain$/i })).not.toBeInTheDocument();
  });

  it('resets the result-grid scroll position when a new result set arrives', async () => {
    const loadTabResultWindow = vi.fn(() => Promise.resolve());
    const onActiveViewChange = vi.fn();

    function createResultsWorkspace(
      resultSetId: string,
      totalRowCount: number,
      rows: (string | number | boolean | null)[][],
    ): QueryWorkspaceState {
      const summary = {
        kind: 'rows' as const,
        resultSetId,
        columns: [
          { name: 'id', postgresType: 'int4', semanticType: 'number' as const, isNullable: false },
          { name: 'email', postgresType: 'varchar', semanticType: 'text' as const, isNullable: false },
        ],
        bufferedRowCount: totalRowCount,
        totalRowCount,
        status: 'completed' as const,
      };

      const tab: QueryTabState = {
        ...createTab('tab-results', `select * from ${resultSetId}`, `select * from ${resultSetId}`),
        execution: {
          ...baseExecution,
          status: 'completed',
          lastResult: summary,
        },
        result: {
          summary,
          latestStreamEvent: null,
          window: {
            resultSetId,
            offset: 0,
            limit: 120,
            rows,
            visibleRowCount: totalRowCount,
            bufferedRowCount: totalRowCount,
            totalRowCount,
            status: 'completed',
            sort: null,
            filters: [],
            quickFilter: '',
          },
          windowStatus: 'ready',
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

      return {
        activeTab: tab,
        activeTabId: tab.id,
        runDisabledReason: null,
        tabs: [tab],
        createTab: vi.fn(),
        createNewTab: vi.fn(),
        closeTab: vi.fn(),
        selectTab: vi.fn(),
        setTabSql: vi.fn(),
        updateTabSql: vi.fn(),
        setTabTargetConnection: vi.fn(),
        updateTabTargetConnection: vi.fn(),
        startTabQuery: vi.fn(() => Promise.resolve()),
        runActiveTab: vi.fn(() => Promise.resolve()),
        cancelTabQuery: vi.fn(() => Promise.resolve()),
        cancelActiveTab: vi.fn(() => Promise.resolve()),
        loadTabResultWindow,
        setTabQuickFilter: vi.fn(),
        setTabColumnFilter: vi.fn(),
        toggleTabSort: vi.fn(),
        setTabExportOutputPath: vi.fn(),
        startTabResultExport: vi.fn(() => Promise.resolve()),
        cancelTabResultExport: vi.fn(() => Promise.resolve()),
      };
    }

    const { rerender } = render(
      <TooltipProvider>
        <QueryResultsPanel
          activeSession={activeSession}
          activeView="results"
          onActiveViewChange={onActiveViewChange}
          workspace={createResultsWorkspace('result-set-large', 200, [
            [1, 'first@example.com'],
            [2, 'second@example.com'],
          ])}
        />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(loadTabResultWindow).toHaveBeenCalledWith('tab-results', 0, 120);
    });

    const scrollContainer = screen.getByTestId('query-result-grid-scroll');
    scrollContainer.scrollTop = 1700;
    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(loadTabResultWindow).toHaveBeenLastCalledWith('tab-results', 38, 120);
    });

    const dispatchEventSpy = vi
      .spyOn(scrollContainer, 'dispatchEvent')
      .mockImplementation(() => true);

    rerender(
      <TooltipProvider>
        <QueryResultsPanel
          activeSession={activeSession}
          activeView="results"
          onActiveViewChange={onActiveViewChange}
          workspace={createResultsWorkspace('result-set-small', 8, [
            [1, 'small@example.com'],
          ])}
        />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(loadTabResultWindow).toHaveBeenLastCalledWith('tab-results', 0, 120);
    });
    expect(screen.getByTestId('query-result-grid-scroll').scrollTop).toBe(0);
    expect(dispatchEventSpy).toHaveBeenCalled();
    dispatchEventSpy.mockRestore();
  });
});
