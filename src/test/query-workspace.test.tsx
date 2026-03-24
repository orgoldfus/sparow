import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryExecutionProgressEvent,
} from '../lib/contracts';
import {
  cancelQueryExecution,
  cancelQueryResultExport,
  getQueryResultCount,
  getQueryResultWindow,
  startQueryExecution,
  startQueryResultExport,
} from '../lib/ipc';
import { useQueryWorkspace } from '../features/query/useQueryWorkspace';

vi.mock('../lib/ipc', () => ({
  startQueryExecution: vi.fn((request: { tabId: string; connectionId: string }) =>
    Promise.resolve({
      jobId: 'query-job-1',
      correlationId: 'query-corr-1',
      tabId: request.tabId,
      connectionId: request.connectionId,
      startedAt: '2026-03-10T16:45:00.000Z',
    }),
  ),
  cancelQueryExecution: vi.fn(() => Promise.resolve({ jobId: 'query-job-1' })),
  getQueryResultWindow: vi.fn(() =>
    Promise.resolve({
      resultSetId: 'result-set-1',
      offset: 0,
      limit: 120,
      rows: [],
      visibleRowCount: 0,
      bufferedRowCount: 0,
      totalRowCount: null,
      hasMoreRows: false,
      status: 'completed',
      sort: null,
      filters: [],
      quickFilter: '',
    }),
  ),
  getQueryResultCount: vi.fn(() =>
    Promise.resolve({
      resultSetId: 'result-set-1',
      totalRowCount: 0,
    }),
  ),
  startQueryResultExport: vi.fn(() =>
    Promise.resolve({
      jobId: 'export-job-1',
      correlationId: 'export-corr-1',
      resultSetId: 'result-set-1',
      outputPath: './sparow-result.csv',
      startedAt: '2026-03-10T16:45:00.000Z',
    }),
  ),
  cancelQueryResultExport: vi.fn(() => Promise.resolve({ jobId: 'export-job-1' })),
}));

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
  {
    id: 'conn-staging',
    engine: 'postgresql',
    name: 'Staging',
    host: '10.0.0.10',
    port: 5432,
    database: 'app_staging',
    username: 'sparow',
    sslMode: 'prefer',
    hasStoredSecret: true,
    secretProvider: 'memory',
    lastTestedAt: null,
    lastConnectedAt: null,
    updatedAt: '2026-03-10T16:45:00.000Z',
  },
];

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

function Harness({
  queryEvents,
  onError,
}: {
  queryEvents: QueryExecutionProgressEvent[];
  onError: (error: AppError) => void;
}) {
  const workspace = useQueryWorkspace({
    activeSession,
    connections,
    queryEvents,
    resultExportEvents: [],
    selectedConnectionId: activeSession.connectionId,
    onError,
  });

  return (
    <div>
      <button onClick={workspace.createTab} type="button">
        new-tab
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            workspace.setTabSql(workspace.activeTabId, 'select 1');
          }
        }}
        type="button"
      >
        update-sql
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            workspace.setTabTargetConnection(workspace.activeTabId, 'conn-staging');
          }
        }}
        type="button"
      >
        retarget
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            void workspace.startTabQuery(workspace.activeTabId, {
              sql: 'select 1',
              origin: 'current-statement',
              isSelectionMultiStatement: false,
            });
          }
        }}
        type="button"
      >
        run
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            void workspace.cancelTabQuery(workspace.activeTabId);
          }
        }}
        type="button"
      >
        cancel
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            workspace.closeTab(workspace.activeTabId);
          }
        }}
        type="button"
      >
        close
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            workspace.setTabQuickFilter(workspace.activeTabId, 'hidden-filter');
          }
        }}
        type="button"
      >
        set-quick-filter
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            workspace.setTabColumnFilter(workspace.activeTabId, 0, 'hidden-column-filter');
          }
        }}
        type="button"
      >
        set-column-filter
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            workspace.toggleTabSort(workspace.activeTabId, 0);
          }
        }}
        type="button"
      >
        toggle-sort
      </button>
      <button
        onClick={() => {
          if (workspace.activeTabId) {
            void workspace.loadTabResultWindow(workspace.activeTabId, 0, 120);
          }
        }}
        type="button"
      >
        load-window
      </button>

      <div data-testid="tab-count">{workspace.tabs.length}</div>
      <div data-testid="active-tab-id">{workspace.activeTab?.id ?? 'none'}</div>
      <div data-testid="active-tab-title">{workspace.activeTab?.title ?? 'none'}</div>
      <div data-testid="active-tab-status">{workspace.activeTab?.execution.status ?? 'idle'}</div>
      <div data-testid="active-tab-target">{workspace.activeTab?.targetConnectionId ?? 'none'}</div>
      <div data-testid="active-tab-dirty">{workspace.activeTab?.dirty ? 'dirty' : 'clean'}</div>
      <div data-testid="active-run-disabled">{workspace.runDisabledReason ?? 'enabled'}</div>
      <div data-testid="active-summary">{workspace.activeTab?.lastExecutionSummary ?? 'none'}</div>
      <div data-testid="active-summary-result-set">{workspace.activeTab?.result.summary?.resultSetId ?? 'none'}</div>
      <div data-testid="active-total-row-count">{workspace.activeTab?.result.summary?.totalRowCount ?? 'none'}</div>
      <div data-testid="active-window-result-set">{workspace.activeTab?.result.window?.resultSetId ?? 'none'}</div>
      <div data-testid="active-window-row-width">{workspace.activeTab?.result.window?.rows[0]?.length ?? 0}</div>
      <div data-testid="active-visible-row-count">{workspace.activeTab?.result.window?.visibleRowCount ?? 'none'}</div>
      <div data-testid="active-count-status">{workspace.activeTab?.result.countStatus ?? 'idle'}</div>
      <div data-testid="active-quick-filter">{workspace.activeTab?.result.quickFilter ?? ''}</div>
      <div data-testid="active-filter-count">{workspace.activeTab?.result.filters.length ?? 0}</div>
      <div data-testid="active-sort-column">{workspace.activeTab?.result.sort?.columnIndex ?? 'none'}</div>
      {workspace.tabs.map((tab) => (
        <div data-testid={`tab-status-${tab.id}`} key={tab.id}>
          {tab.execution.status}
        </div>
      ))}
    </div>
  );
}

describe('useQueryWorkspace', () => {
  beforeEach(() => {
    vi.mocked(startQueryExecution).mockClear();
    vi.mocked(cancelQueryExecution).mockClear();
    vi.mocked(getQueryResultWindow).mockClear();
    vi.mocked(getQueryResultCount).mockClear();
    vi.mocked(startQueryResultExport).mockClear();
    vi.mocked(cancelQueryResultExport).mockClear();
  });

  it('creates tabs and derives titles from SQL edits', () => {
    const onError = vi.fn();
    render(<Harness onError={onError} queryEvents={[]} />);

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByText('new-tab'));
    expect(screen.getByTestId('tab-count')).toHaveTextContent('2');

    fireEvent.click(screen.getByText('update-sql'));
    expect(screen.getByTestId('active-tab-title')).toHaveTextContent('select 1');
    expect(screen.getByTestId('active-tab-dirty')).toHaveTextContent('dirty');
  });

  it('blocks running when the tab target does not match the active session', async () => {
    const onError = vi.fn();
    render(<Harness onError={onError} queryEvents={[]} />);

    fireEvent.click(screen.getByText('retarget'));
    expect(screen.getByTestId('active-run-disabled')).toHaveTextContent('different saved profile');

    fireEvent.click(screen.getByText('run'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(vi.mocked(startQueryExecution)).not.toHaveBeenCalled();
  });

  it('starts and cancels the active tab query', async () => {
    const onError = vi.fn();
    render(<Harness onError={onError} queryEvents={[]} />);

    fireEvent.click(screen.getByText('run'));

    await waitFor(() => {
      expect(startQueryExecution).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('active-tab-status')).toHaveTextContent('queued');
    expect(screen.getByTestId('active-summary')).toHaveTextContent('queued');

    fireEvent.click(screen.getByText('cancel'));

    await waitFor(() => {
      expect(cancelQueryExecution).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('active-summary')).toHaveTextContent('Cancellation requested.');
  });

  it('prevents closing a running tab until it reaches a terminal state', async () => {
    const onError = vi.fn();
    const { rerender } = render(<Harness onError={onError} queryEvents={[]} />);

    fireEvent.click(screen.getByText('run'));

    await waitFor(() => {
      expect(startQueryExecution).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText('close'));
    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    expect(onError).toHaveBeenCalled();

    rerender(
      <Harness
        onError={onError}
        queryEvents={[
          {
            jobId: 'query-job-1',
            correlationId: 'query-corr-1',
            tabId: screen.getByTestId('active-tab-id').textContent ?? 'none',
            connectionId: 'conn-local-postgres',
            status: 'completed',
            elapsedMs: 12,
            message: 'Query completed.',
            startedAt: '2026-03-10T16:45:00.000Z',
            finishedAt: '2026-03-10T16:45:00.012Z',
            lastError: null,
            result: {
              kind: 'command',
              commandTag: 'SELECT',
              rowsAffected: 1,
            },
          },
        ]}
      />,
    );

    const completedTabId = screen.getByTestId('active-tab-id').textContent;
    const errorCallsBeforeClose = onError.mock.calls.length;

    fireEvent.click(screen.getByText('close'));
    expect(screen.getByTestId('active-tab-id')).not.toHaveTextContent(completedTabId ?? '');
    expect(onError).toHaveBeenCalledTimes(errorCallsBeforeClose);
  });

  it('replaces the last tab cleanly under StrictMode when closing the active tab', async () => {
    const onError = vi.fn();
    render(
      <StrictMode>
        <Harness onError={onError} queryEvents={[]} />
      </StrictMode>,
    );

    const initialTabId = screen.getByTestId('active-tab-id').textContent ?? 'none';

    fireEvent.click(screen.getByText('close'));

    await waitFor(() => {
      expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
      expect(screen.getByTestId('active-tab-id')).not.toHaveTextContent(initialTabId);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('applies multiple queued query events from a single batched update', async () => {
    const onError = vi.fn();
    const { rerender } = render(<Harness onError={onError} queryEvents={[]} />);

    const firstTabId = screen.getByTestId('active-tab-id').textContent ?? 'none';
    fireEvent.click(screen.getByText('new-tab'));
    const secondTabId = screen.getByTestId('active-tab-id').textContent ?? 'none';

    rerender(
      <Harness
        onError={onError}
        queryEvents={[
          {
            jobId: 'query-job-2',
            correlationId: 'query-corr-2',
            tabId: secondTabId,
            connectionId: 'conn-local-postgres',
            status: 'running',
            elapsedMs: 5,
            message: 'Second tab running.',
            startedAt: '2026-03-10T16:45:00.005Z',
            finishedAt: null,
            lastError: null,
            result: null,
          },
          {
            jobId: 'query-job-1',
            correlationId: 'query-corr-1',
            tabId: firstTabId,
            connectionId: 'conn-local-postgres',
            status: 'completed',
            elapsedMs: 12,
            message: 'First tab completed.',
            startedAt: '2026-03-10T16:45:00.000Z',
            finishedAt: '2026-03-10T16:45:00.012Z',
            lastError: null,
            result: {
              kind: 'command',
              commandTag: 'SELECT',
              rowsAffected: 1,
            },
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`tab-status-${firstTabId}`)).toHaveTextContent('completed');
      expect(screen.getByTestId(`tab-status-${secondTabId}`)).toHaveTextContent('running');
    });
  });

  it('clears a stale cached window when a completed query swaps in a new result set', async () => {
    const onError = vi.fn();
    vi.mocked(getQueryResultWindow).mockResolvedValueOnce({
      resultSetId: 'result-set-old',
      offset: 0,
      limit: 120,
      rows: [[1]],
      visibleRowCount: 1,
      bufferedRowCount: 1,
      totalRowCount: 1,
      hasMoreRows: false,
      status: 'completed',
      sort: null,
      filters: [],
      quickFilter: '',
    });

    const { rerender } = render(<Harness onError={onError} queryEvents={[]} />);

    const tabId = await screen.findByTestId('active-tab-id').then((element) => element.textContent ?? 'none');

    rerender(
      <Harness
        onError={onError}
        queryEvents={[
          {
            jobId: 'query-job-old',
            correlationId: 'query-corr-old',
            tabId,
            connectionId: 'conn-local-postgres',
            status: 'completed',
            elapsedMs: 12,
            message: 'Old query completed.',
            startedAt: '2026-03-10T16:45:00.000Z',
            finishedAt: '2026-03-10T16:45:00.012Z',
            lastError: null,
            result: {
              kind: 'rows',
              resultSetId: 'result-set-old',
              columns: [{ name: 'id', postgresType: 'int4', semanticType: 'number', isNullable: false }],
              bufferedRowCount: 1,
              totalRowCount: 1,
              hasMoreRows: false,
              status: 'completed',
            },
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-summary-result-set')).toHaveTextContent('result-set-old');
    });

    fireEvent.click(screen.getByText('load-window'));

    await waitFor(() => {
      expect(screen.getByTestId('active-window-result-set')).toHaveTextContent('result-set-old');
      expect(screen.getByTestId('active-window-row-width')).toHaveTextContent('1');
    });

    rerender(
      <Harness
        onError={onError}
        queryEvents={[
          {
            jobId: 'query-job-old',
            correlationId: 'query-corr-old',
            tabId,
            connectionId: 'conn-local-postgres',
            status: 'completed',
            elapsedMs: 12,
            message: 'Old query completed.',
            startedAt: '2026-03-10T16:45:00.000Z',
            finishedAt: '2026-03-10T16:45:00.012Z',
            lastError: null,
            result: {
              kind: 'rows',
              resultSetId: 'result-set-old',
              columns: [{ name: 'id', postgresType: 'int4', semanticType: 'number', isNullable: false }],
              bufferedRowCount: 1,
              totalRowCount: 1,
              hasMoreRows: false,
              status: 'completed',
            },
          },
          {
            jobId: 'query-job-new',
            correlationId: 'query-corr-new',
            tabId,
            connectionId: 'conn-local-postgres',
            status: 'completed',
            elapsedMs: 18,
            message: 'New query completed.',
            startedAt: '2026-03-10T16:46:00.000Z',
            finishedAt: '2026-03-10T16:46:00.018Z',
            lastError: null,
            result: {
              kind: 'rows',
              resultSetId: 'result-set-new',
              columns: [
                { name: 'id', postgresType: 'int4', semanticType: 'number', isNullable: false },
                { name: 'name', postgresType: 'text', semanticType: 'text', isNullable: false },
              ],
              bufferedRowCount: 2,
              totalRowCount: 2,
              hasMoreRows: false,
              status: 'completed',
            },
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-summary-result-set')).toHaveTextContent('result-set-new');
      expect(screen.getByTestId('active-window-result-set')).toHaveTextContent('none');
      expect(screen.getByTestId('active-window-row-width')).toHaveTextContent('0');
    });
  });

  it('clears viewer sort and filters when a completed query swaps in a new result set', async () => {
    const onError = vi.fn();
    const { rerender } = render(<Harness onError={onError} queryEvents={[]} />);

    const tabId = await screen.findByTestId('active-tab-id').then((element) => element.textContent ?? 'none');

    fireEvent.click(screen.getByText('set-quick-filter'));
    fireEvent.click(screen.getByText('set-column-filter'));
    fireEvent.click(screen.getByText('toggle-sort'));

    expect(screen.getByTestId('active-quick-filter')).toHaveTextContent('hidden-filter');
    expect(screen.getByTestId('active-filter-count')).toHaveTextContent('1');
    expect(screen.getByTestId('active-sort-column')).toHaveTextContent('0');

    rerender(
      <Harness
        onError={onError}
        queryEvents={[
          {
            jobId: 'query-job-new',
            correlationId: 'query-corr-new',
            tabId,
            connectionId: 'conn-local-postgres',
            status: 'completed',
            elapsedMs: 18,
            message: 'New query completed.',
            startedAt: '2026-03-10T16:46:00.000Z',
            finishedAt: '2026-03-10T16:46:00.018Z',
            lastError: null,
            result: {
              kind: 'rows',
              resultSetId: 'result-set-new',
              columns: [
                { name: 'id', postgresType: 'int4', semanticType: 'number', isNullable: false },
                { name: 'name', postgresType: 'text', semanticType: 'text', isNullable: false },
              ],
              bufferedRowCount: 10,
              totalRowCount: 10,
              hasMoreRows: false,
              status: 'completed',
            },
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-summary-result-set')).toHaveTextContent('result-set-new');
      expect(screen.getByTestId('active-quick-filter')).toHaveTextContent('');
      expect(screen.getByTestId('active-filter-count')).toHaveTextContent('0');
      expect(screen.getByTestId('active-sort-column')).toHaveTextContent('none');
    });
  });

  it('automatically counts rows after loading a window with an unknown total', async () => {
    const onError = vi.fn();
    vi.mocked(getQueryResultWindow).mockResolvedValueOnce({
      resultSetId: 'result-set-async-count',
      offset: 0,
      limit: 120,
      rows: [[1]],
      visibleRowCount: 1,
      bufferedRowCount: 1,
      totalRowCount: null,
      hasMoreRows: true,
      status: 'completed',
      sort: null,
      filters: [],
      quickFilter: '',
    });
    vi.mocked(getQueryResultCount).mockResolvedValueOnce({
      resultSetId: 'result-set-async-count',
      totalRowCount: 42,
    });

    const { rerender } = render(<Harness onError={onError} queryEvents={[]} />);
    const tabId = await screen.findByTestId('active-tab-id').then((element) => element.textContent ?? 'none');

    rerender(
      <Harness
        onError={onError}
        queryEvents={[
          {
            jobId: 'query-job-count',
            correlationId: 'query-corr-count',
            tabId,
            connectionId: 'conn-local-postgres',
            status: 'completed',
            elapsedMs: 18,
            message: 'Query completed.',
            startedAt: '2026-03-10T16:46:00.000Z',
            finishedAt: '2026-03-10T16:46:00.018Z',
            lastError: null,
            result: {
              kind: 'rows',
              resultSetId: 'result-set-async-count',
              columns: [{ name: 'id', postgresType: 'int4', semanticType: 'number', isNullable: false }],
              bufferedRowCount: 1,
              totalRowCount: null,
              hasMoreRows: true,
              status: 'completed',
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('load-window'));

    await waitFor(() => {
      expect(getQueryResultCount).toHaveBeenCalledWith({
        resultSetId: 'result-set-async-count',
        filters: [],
        quickFilter: '',
      });
      expect(screen.getByTestId('active-count-status')).toHaveTextContent('ready');
      expect(screen.getByTestId('active-total-row-count')).toHaveTextContent('42');
      expect(screen.getByTestId('active-visible-row-count')).toHaveTextContent('1');
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not start a count request from a stale window response', async () => {
    const onError = vi.fn();
    type WindowResponse = Awaited<ReturnType<typeof getQueryResultWindow>>;
    let resolveWindow: ((value: WindowResponse) => void) | undefined;
    vi.mocked(getQueryResultWindow).mockImplementationOnce(
      () =>
        new Promise<WindowResponse>((resolve) => {
          resolveWindow = resolve;
        }),
    );

    const { rerender } = render(<Harness onError={onError} queryEvents={[]} />);
    const tabId = await screen.findByTestId('active-tab-id').then((element) => element.textContent ?? 'none');

    rerender(
      <Harness
        onError={onError}
        queryEvents={[
          {
            jobId: 'query-job-stale-count',
            correlationId: 'query-corr-stale-count',
            tabId,
            connectionId: 'conn-local-postgres',
            status: 'completed',
            elapsedMs: 18,
            message: 'Query completed.',
            startedAt: '2026-03-10T16:46:00.000Z',
            finishedAt: '2026-03-10T16:46:00.018Z',
            lastError: null,
            result: {
              kind: 'rows',
              resultSetId: 'result-set-stale-count',
              columns: [{ name: 'id', postgresType: 'int4', semanticType: 'number', isNullable: false }],
              bufferedRowCount: 1,
              totalRowCount: null,
              hasMoreRows: true,
              status: 'completed',
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('load-window'));
    fireEvent.click(screen.getByText('set-quick-filter'));

    resolveWindow?.({
      resultSetId: 'result-set-stale-count',
      offset: 0,
      limit: 120,
      rows: [[1]],
      visibleRowCount: 1,
      bufferedRowCount: 1,
      totalRowCount: null,
      hasMoreRows: true,
      status: 'completed',
      sort: null,
      filters: [],
      quickFilter: '',
    });

    await waitFor(() => {
      expect(getQueryResultCount).not.toHaveBeenCalled();
      expect(screen.getByTestId('active-quick-filter')).toHaveTextContent('hidden-filter');
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
