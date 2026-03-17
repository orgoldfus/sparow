import { fireEvent, render, screen } from '@testing-library/react';
import App from '../App';
import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import connectionDetailsFixture from '../../fixtures/contracts/connection-details.json';
import connectionTestResultFixture from '../../fixtures/contracts/connection-test-result.json';
import databaseSessionSnapshotFixture from '../../fixtures/contracts/database-session-snapshot.json';
import listSchemaChildrenResultFixture from '../../fixtures/contracts/list-schema-children-result.json';
import schemaSearchResultFixture from '../../fixtures/contracts/schema-search-result.json';

const rootSchemaChildrenFixture = {
  connectionId: databaseSessionSnapshotFixture.connectionId,
  parentKind: 'root' as const,
  parentPath: null,
  cacheStatus: 'fresh' as const,
  refreshInFlight: false,
  refreshedAt: '2026-03-09T18:15:00.000Z',
  nodes: [
    {
      kind: 'schema' as const,
      id: 'conn-local-postgres:schema/public',
      connectionId: databaseSessionSnapshotFixture.connectionId,
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
  bootstrapApp: vi.fn(() => Promise.resolve(appBootstrapFixture)),
  listSavedConnections: vi.fn(() => Promise.resolve(appBootstrapFixture.savedConnections)),
  getSavedConnection: vi.fn(() => Promise.resolve(connectionDetailsFixture)),
  saveConnection: vi.fn(() => Promise.resolve(connectionDetailsFixture)),
  testConnection: vi.fn(() => Promise.resolve(connectionTestResultFixture)),
  connectSavedConnection: vi.fn(() => Promise.resolve(databaseSessionSnapshotFixture)),
  disconnectActiveConnection: vi.fn(() => Promise.resolve({ connectionId: databaseSessionSnapshotFixture.connectionId })),
  deleteSavedConnection: vi.fn(() => Promise.resolve({ id: connectionDetailsFixture.id, disconnected: true })),
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
      connectionId: databaseSessionSnapshotFixture.connectionId,
      startedAt: '2026-03-10T16:45:00.000Z',
    }),
  ),
  cancelQueryExecution: vi.fn(() => Promise.resolve({ jobId: 'query-job-1' })),
  subscribeToQueryResultExportEvent: vi.fn(() => Promise.resolve(() => {})),
  subscribeToQueryExecutionEvent: vi.fn(() => Promise.resolve(() => {})),
  subscribeToSchemaRefreshEvent: vi.fn(() => Promise.resolve(() => {})),
}));

describe('foundation smoke', () => {
  it('boots the shell and opens diagnostics on demand', async () => {
    render(<App />);

    expect(await screen.findByTestId('environment-value')).toHaveTextContent('development');
    expect(screen.getByTestId('results-region')).toBeInTheDocument();
    expect(screen.queryByTestId('diagnostics-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /diagnostics/i }));

    expect(await screen.findByTestId('diagnostics-dialog')).toBeInTheDocument();
  });
});
