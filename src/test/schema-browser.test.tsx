import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import connectionDetailsFixture from '../../fixtures/contracts/connection-details.json';
import connectionTestResultFixture from '../../fixtures/contracts/connection-test-result.json';
import databaseSessionSnapshotFixture from '../../fixtures/contracts/database-session-snapshot.json';
import listSchemaChildrenResultFixture from '../../fixtures/contracts/list-schema-children-result.json';
import schemaRefreshProgressFixture from '../../fixtures/contracts/schema-refresh-progress.json';
import schemaSearchResultFixture from '../../fixtures/contracts/schema-search-result.json';
import { bootstrapApp } from '../lib/ipc';

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
      id: 'schema/public',
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

let schemaEventHandler: ((payload: typeof schemaRefreshProgressFixture) => void) | null = null;

vi.mock('../lib/ipc', () => ({
  bootstrapApp: vi.fn(() => Promise.resolve(appBootstrapFixture)),
  listSavedConnections: vi.fn(() => Promise.resolve(appBootstrapFixture.savedConnections)),
  getSavedConnection: vi.fn(() => Promise.resolve(connectionDetailsFixture)),
  saveConnection: vi.fn(() => Promise.resolve(connectionDetailsFixture)),
  testConnection: vi.fn(() => Promise.resolve(connectionTestResultFixture)),
  connectSavedConnection: vi.fn(() => Promise.resolve(databaseSessionSnapshotFixture)),
  disconnectActiveConnection: vi.fn(() => Promise.resolve({ connectionId: databaseSessionSnapshotFixture.connectionId })),
  deleteSavedConnection: vi.fn(() => Promise.resolve({ id: connectionDetailsFixture.id, disconnected: true })),
  listSchemaChildren: vi.fn((request: { parentKind: string }) =>
    Promise.resolve(request.parentKind === 'root' ? rootSchemaChildrenFixture : listSchemaChildrenResultFixture),
  ),
  refreshSchemaScope: vi.fn(() => Promise.resolve({})),
  searchSchemaCache: vi.fn(() => Promise.resolve(schemaSearchResultFixture)),
  subscribeToEvent: vi.fn(() => Promise.resolve(() => {})),
  subscribeToSchemaRefreshEvent: vi.fn(
    (_eventName: string, handler: (payload: typeof schemaRefreshProgressFixture) => void) => {
      schemaEventHandler = handler;
      return Promise.resolve(() => {
        schemaEventHandler = null;
      });
    },
  ),
}));

describe('schema browser', () => {
  beforeEach(() => {
    schemaEventHandler = null;
    vi.mocked(bootstrapApp).mockResolvedValue(appBootstrapFixture);
  });

  it('shows a disconnected empty state when no active session exists', async () => {
    vi.mocked(bootstrapApp).mockResolvedValue({
      ...appBootstrapFixture,
      activeSession: null,
    });

    render(<App />);

    expect(await screen.findByText(/Connect a saved PostgreSQL target to browse schemas/i)).toBeInTheDocument();
  });

  it('expands the schema tree with keyboard navigation', async () => {
    render(<App />);

    await screen.findByTestId('schema-node-schema/public');
    const tree = screen.getByTestId('schema-tree');
    expect(tree).toHaveAttribute('role', 'tree');
    expect(tree).toHaveAttribute('aria-label', 'Schema browser');

    const rootNode = screen.getByTestId('schema-node-schema/public');
    expect(rootNode).toHaveAttribute('role', 'treeitem');
    expect(rootNode).toHaveAttribute('aria-selected', 'true');
    expect(rootNode).toHaveAttribute('aria-expanded', 'false');

    tree.focus();

    fireEvent.keyDown(tree, { key: 'ArrowRight' });

    expect(await screen.findByText('users')).toBeInTheDocument();
  });

  it('shows cached search matches in the details panel', async () => {
    render(<App />);

    const searchInput = await screen.findByPlaceholderText(/Search cached schema/i);
    expect(searchInput).toHaveAttribute('aria-label', 'Search schema cache');
    fireEvent.change(searchInput, { target: { value: 'user' } });

    const emailResult = await screen.findByText('email');
    fireEvent.click(emailResult);

    await waitFor(() => {
      expect(screen.getByText('Data type')).toBeInTheDocument();
      expect(screen.getByText('text')).toBeInTheDocument();
    });
  });

  it('renders schema refresh events in diagnostics', () => {
    render(<App />);

    return screen.findByTestId('schema-node-schema/public').then(async () => {
      await act(async () => {
        await Promise.resolve();
        schemaEventHandler?.(schemaRefreshProgressFixture);
      });

      await waitFor(() => {
        expect(screen.getAllByText(/Refreshed schema scope public/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(new RegExp(schemaRefreshProgressFixture.correlationId)).length).toBeGreaterThan(0);
      });
    });
  });

  it('renders unknown SSL state explicitly', async () => {
    vi.mocked(bootstrapApp).mockResolvedValue({
      ...appBootstrapFixture,
      activeSession: {
        ...databaseSessionSnapshotFixture,
        sslInUse: null,
      },
    });

    render(<App />);

    expect(await screen.findByText('SSL: unknown')).toBeInTheDocument();
  });
});
