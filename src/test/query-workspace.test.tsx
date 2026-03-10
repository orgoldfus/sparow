import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryExecutionProgressEvent,
} from '../lib/contracts';
import { cancelQueryExecution, startQueryExecution } from '../lib/ipc';
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

      <div data-testid="tab-count">{workspace.tabs.length}</div>
      <div data-testid="active-tab-id">{workspace.activeTab?.id ?? 'none'}</div>
      <div data-testid="active-tab-title">{workspace.activeTab?.title ?? 'none'}</div>
      <div data-testid="active-tab-status">{workspace.activeTab?.execution.status ?? 'idle'}</div>
      <div data-testid="active-tab-target">{workspace.activeTab?.targetConnectionId ?? 'none'}</div>
      <div data-testid="active-tab-dirty">{workspace.activeTab?.dirty ? 'dirty' : 'clean'}</div>
      <div data-testid="active-run-disabled">{workspace.runDisabledReason ?? 'enabled'}</div>
      <div data-testid="active-summary">{workspace.activeTab?.lastExecutionSummary ?? 'none'}</div>
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
});
