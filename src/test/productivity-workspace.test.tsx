import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import connectionDetailsFixture from '../../fixtures/contracts/connection-details.json';
import connectionTestResultFixture from '../../fixtures/contracts/connection-test-result.json';
import databaseSessionSnapshotFixture from '../../fixtures/contracts/database-session-snapshot.json';
import historyEntryFixture from '../../fixtures/contracts/history-entry.json';
import listSchemaChildrenResultFixture from '../../fixtures/contracts/list-schema-children-result.json';
import savedQueryFixture from '../../fixtures/contracts/saved-query.json';
import schemaSearchResultFixture from '../../fixtures/contracts/schema-search-result.json';
import type {
  AppBootstrap,
  ConnectionDetails,
  DatabaseSessionSnapshot,
  HistoryEntry,
  SavedQuery,
} from '../lib/contracts';
import {
  bootstrapApp,
  getSavedConnection,
  listQueryHistory,
  listSavedQueries,
  saveSavedQuery,
  subscribeToQueryExecutionEvent,
  subscribeToQueryResultExportEvent,
  subscribeToSchemaRefreshEvent,
} from '../lib/ipc';

const appBootstrap = appBootstrapFixture as AppBootstrap;
const connectionDetails = connectionDetailsFixture as ConnectionDetails;
const databaseSession = databaseSessionSnapshotFixture as DatabaseSessionSnapshot;
const savedQuery = savedQueryFixture as SavedQuery;
const historyEntry = historyEntryFixture as HistoryEntry;
const rootSchemaChildrenFixture = {
  connectionId: databaseSession.connectionId,
  parentKind: 'root' as const,
  parentPath: null,
  cacheStatus: 'fresh' as const,
  refreshInFlight: false,
  refreshedAt: '2026-03-09T18:15:00.000Z',
  nodes: [
    {
      kind: 'schema' as const,
      id: 'conn-local-postgres:schema/public',
      connectionId: databaseSession.connectionId,
      name: 'public',
      path: 'schema/public',
      parentPath: null,
      schemaName: 'public',
      relationName: null,
      hasChildren: true,
      refreshedAt: '2026-03-09T18:15:00.000Z',
    },
  ],
};

vi.mock('../lib/ipc', () => ({
  bootstrapApp: vi.fn(() => Promise.resolve(appBootstrap)),
  listSavedConnections: vi.fn(() => Promise.resolve(appBootstrap.savedConnections)),
  getSavedConnection: vi.fn(() => Promise.resolve(connectionDetails)),
  saveConnection: vi.fn(() => Promise.resolve(connectionDetails)),
  testConnection: vi.fn(() => Promise.resolve(connectionTestResultFixture)),
  connectSavedConnection: vi.fn(() => Promise.resolve(databaseSession)),
  disconnectActiveConnection: vi.fn(() => Promise.resolve({ connectionId: databaseSession.connectionId })),
  deleteSavedConnection: vi.fn(() => Promise.resolve({ id: connectionDetails.id, disconnected: true })),
  subscribeToEvent: vi.fn(() => Promise.resolve(() => {})),
  listSchemaChildren: vi.fn((request: { parentKind: string }) =>
    Promise.resolve(request.parentKind === 'root' ? rootSchemaChildrenFixture : listSchemaChildrenResultFixture),
  ),
  refreshSchemaScope: vi.fn(() => Promise.resolve({})),
  searchSchemaCache: vi.fn(() => Promise.resolve(schemaSearchResultFixture)),
  startQueryExecution: vi.fn(() =>
    Promise.resolve({
      jobId: 'query-job-1',
      correlationId: 'query-corr-1',
      tabId: 'tab-1',
      connectionId: databaseSession.connectionId,
      startedAt: '2026-03-10T16:45:00.000Z',
    }),
  ),
  cancelQueryExecution: vi.fn(() => Promise.resolve({ jobId: 'query-job-1' })),
  getQueryResultWindow: vi.fn(() =>
    Promise.resolve({
      resultSetId: 'result-set-1',
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
    }),
  ),
  getQueryResultCount: vi.fn(() => Promise.resolve({ resultSetId: 'result-set-1', totalRowCount: 1 })),
  startQueryResultExport: vi.fn(() =>
    Promise.resolve({ jobId: 'export-job-1', outputPath: './sparow-result.csv' }),
  ),
  cancelQueryResultExport: vi.fn(() => Promise.resolve({ jobId: 'export-job-1' })),
  subscribeToQueryResultExportEvent: vi.fn(() => Promise.resolve(() => {})),
  subscribeToQueryExecutionEvent: vi.fn(() => Promise.resolve(() => {})),
  subscribeToSchemaRefreshEvent: vi.fn(() => Promise.resolve(() => {})),
  listQueryHistory: vi.fn(() => Promise.resolve({ entries: [historyEntry], hasMore: false })),
  listSavedQueries: vi.fn(() => Promise.resolve({ entries: [savedQuery], hasMore: false })),
  saveSavedQuery: vi.fn((request: { id: string | null; title: string; sql: string; tags: string[]; connectionProfileId: string | null }) =>
    Promise.resolve({
      ...savedQuery,
      id: request.id ?? savedQuery.id,
      title: request.title,
      sql: request.sql,
      tags: request.tags,
      connectionProfileId: request.connectionProfileId,
    }),
  ),
  deleteSavedQuery: vi.fn((id: string) => Promise.resolve({ id })),
}));

const bootstrapAppMock = vi.mocked(bootstrapApp);
const getSavedConnectionMock = vi.mocked(getSavedConnection);
const listQueryHistoryMock = vi.mocked(listQueryHistory);
const listSavedQueriesMock = vi.mocked(listSavedQueries);
const saveSavedQueryMock = vi.mocked(saveSavedQuery);
const subscribeToQueryExecutionEventMock = vi.mocked(subscribeToQueryExecutionEvent);
const subscribeToQueryResultExportEventMock = vi.mocked(subscribeToQueryResultExportEvent);
const subscribeToSchemaRefreshEventMock = vi.mocked(subscribeToSchemaRefreshEvent);

describe('Productivity workspace', () => {
  beforeEach(() => {
    bootstrapAppMock.mockReset();
    getSavedConnectionMock.mockReset();
    listQueryHistoryMock.mockReset();
    listSavedQueriesMock.mockReset();
    saveSavedQueryMock.mockReset();
    subscribeToQueryExecutionEventMock.mockReset();
    subscribeToQueryResultExportEventMock.mockReset();
    subscribeToSchemaRefreshEventMock.mockReset();

    bootstrapAppMock.mockResolvedValue(appBootstrap);
    getSavedConnectionMock.mockResolvedValue(connectionDetails);
    listQueryHistoryMock.mockResolvedValue({ entries: [historyEntry], hasMore: false });
    listSavedQueriesMock.mockResolvedValue({ entries: [savedQuery], hasMore: false });
    saveSavedQueryMock.mockImplementation((request) =>
      Promise.resolve({
        ...savedQuery,
        id: request.id ?? savedQuery.id,
        title: request.title,
        sql: request.sql,
        tags: request.tags,
        connectionProfileId: request.connectionProfileId,
      }),
    );
    subscribeToQueryExecutionEventMock.mockResolvedValue(() => {});
    subscribeToQueryResultExportEventMock.mockResolvedValue(() => {});
    subscribeToSchemaRefreshEventMock.mockResolvedValue(() => {});
  });

  it('opens the query library and lists saved queries from the backend search command', async () => {
    render(<App />);

    await screen.findByTestId('environment-value');
    fireEvent.click(screen.getByRole('button', { name: /query library/i }));

    await waitFor(() => {
      expect(listSavedQueriesMock).toHaveBeenCalledWith({
        searchQuery: '',
        connectionId: null,
        limit: 24,
        offset: 0,
      });
    });

    expect(await screen.findByTestId(`query-library-saved-entry-${savedQuery.id}`)).toBeInTheDocument();
    expect(screen.getByText(savedQuery.title)).toBeInTheDocument();
  });

  it('opens the save-query dialog with Mod+S and persists metadata for the active tab', async () => {
    render(<App />);

    await screen.findByTestId('environment-value');
    fireEvent.keyDown(window, { ctrlKey: true, key: 's' });

    await screen.findByTestId('save-query-dialog');
    fireEvent.change(screen.getByTestId('save-query-title-input'), {
      target: { value: 'Active users by role' },
    });
    fireEvent.change(screen.getByTestId('save-query-tags-input'), {
      target: { value: 'ops, reporting, ops' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save query$/i }));

    await waitFor(() => {
      expect(saveSavedQueryMock).toHaveBeenCalledWith({
        id: null,
        title: 'Active users by role',
        sql: 'select current_database(), current_user, now();',
        tags: ['ops', 'reporting'],
        connectionProfileId: databaseSession.connectionId,
      });
    });
  });

  it('opens the command palette with Mod+K and loads matching saved queries and history rows', async () => {
    render(<App />);

    await screen.findByTestId('environment-value');
    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' });

    expect(await screen.findByTestId('command-palette-input')).toBeInTheDocument();

    await waitFor(() => {
      expect(listSavedQueriesMock).toHaveBeenCalledWith({
        searchQuery: '',
        connectionId: null,
        limit: 6,
        offset: 0,
      });
      expect(listQueryHistoryMock).toHaveBeenCalledWith({
        searchQuery: '',
        connectionId: null,
        limit: 6,
        offset: 0,
      });
    });

    expect(screen.getByText('New query tab')).toBeInTheDocument();
    expect(await screen.findByTestId(`command-palette-item-saved-${savedQuery.id}`)).toBeInTheDocument();
  });

  it('moves focus to the results quick filter with Mod+4', async () => {
    render(<App />);

    await screen.findByTestId('environment-value');
    fireEvent.keyDown(window, { ctrlKey: true, key: '4' });

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('result-quick-filter'));
    });
  });
});
