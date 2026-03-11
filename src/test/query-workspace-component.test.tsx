import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { TooltipProvider } from '../components/ui/tooltip';
import { QueryWorkspace } from '../features/query/QueryWorkspace';
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
  };
}

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
});
