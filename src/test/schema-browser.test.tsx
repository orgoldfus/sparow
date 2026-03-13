import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import connectionDetailsFixture from '../../fixtures/contracts/connection-details.json';
import connectionTestResultFixture from '../../fixtures/contracts/connection-test-result.json';
import databaseSessionSnapshotFixture from '../../fixtures/contracts/database-session-snapshot.json';
import listSchemaChildrenResultFixture from '../../fixtures/contracts/list-schema-children-result.json';
import schemaRefreshProgressFixture from '../../fixtures/contracts/schema-refresh-progress.json';
import schemaSearchResultFixture from '../../fixtures/contracts/schema-search-result.json';
import type {
  AppBootstrap,
  DatabaseSessionSnapshot,
  ListSchemaChildrenResult,
} from '../lib/contracts';
import { isAppBootstrap, isDatabaseSessionSnapshot } from '../lib/guards';
import { bootstrapApp } from '../lib/ipc';

function expectAppBootstrap(value: unknown): AppBootstrap {
  expect(isAppBootstrap(value)).toBe(true);
  return value as AppBootstrap;
}

function expectDatabaseSessionSnapshot(value: unknown): DatabaseSessionSnapshot {
  expect(isDatabaseSessionSnapshot(value)).toBe(true);
  return value as DatabaseSessionSnapshot;
}

const appBootstrap = expectAppBootstrap(appBootstrapFixture);
const databaseSession = expectDatabaseSessionSnapshot(databaseSessionSnapshotFixture);

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
} satisfies ListSchemaChildrenResult;

let schemaEventHandler: ((payload: typeof schemaRefreshProgressFixture) => void) | null = null;

vi.mock('../lib/ipc', () => ({
  bootstrapApp: vi.fn(() => Promise.resolve(appBootstrapFixture)),
  listSavedConnections: vi.fn(() => Promise.resolve(appBootstrap.savedConnections)),
  getSavedConnection: vi.fn(() => Promise.resolve(connectionDetailsFixture)),
  saveConnection: vi.fn(() => Promise.resolve(connectionDetailsFixture)),
  testConnection: vi.fn(() => Promise.resolve(connectionTestResultFixture)),
  connectSavedConnection: vi.fn(() => Promise.resolve(databaseSession)),
  disconnectActiveConnection: vi.fn(() => Promise.resolve({ connectionId: databaseSession.connectionId })),
  deleteSavedConnection: vi.fn(() => Promise.resolve({ id: connectionDetailsFixture.id, disconnected: true })),
  listSchemaChildren: vi.fn((request: { parentKind: string }) =>
    Promise.resolve(request.parentKind === 'root' ? rootSchemaChildrenFixture : listSchemaChildrenResultFixture),
  ),
  refreshSchemaScope: vi.fn(() => Promise.resolve({})),
  searchSchemaCache: vi.fn(() => Promise.resolve(schemaSearchResultFixture)),
  subscribeToEvent: vi.fn(() => Promise.resolve(() => {})),
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
  subscribeToQueryResultStreamEvent: vi.fn(() => Promise.resolve(() => {})),
  subscribeToQueryResultExportEvent: vi.fn(() => Promise.resolve(() => {})),
  subscribeToQueryExecutionEvent: vi.fn(() => Promise.resolve(() => {})),
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
    vi.mocked(bootstrapApp).mockResolvedValue(appBootstrap);
  });

  it('shows a disconnected empty state when no active session exists', async () => {
    vi.mocked(bootstrapApp).mockResolvedValue({
      ...appBootstrap,
      activeSession: null,
    });

    render(<App />);

    expect(
      await screen.findByText(/Connect a saved PostgreSQL target to browse cached schema and relation metadata/i),
    ).toBeInTheDocument();
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

  it('shows cached search matches in diagnostics after selection', async () => {
    render(<App />);

    const searchInput = await screen.findByPlaceholderText(/Search tables, views, columns/i);
    expect(searchInput).toHaveAttribute('aria-label', 'Search schema cache');
    fireEvent.change(searchInput, { target: { value: 'user' } });

    const emailResult = await screen.findByText('email');
    fireEvent.click(emailResult);
    fireEvent.click(screen.getByRole('button', { name: /diagnostics/i }));

    await waitFor(() => {
      expect(screen.getByText('Runtime visibility')).toBeInTheDocument();
      expect(screen.getByText('Kind: column')).toBeInTheDocument();
      expect(screen.getByText('Path: column/public/users/email')).toBeInTheDocument();
    });
  });

  it('renders schema refresh events in diagnostics', async () => {
    render(<App />);

    await screen.findByTestId('schema-node-schema/public');

    await act(async () => {
      await Promise.resolve();
      schemaEventHandler?.(schemaRefreshProgressFixture);
    });

    fireEvent.click(screen.getByRole('button', { name: /diagnostics/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Refreshed schema scope public/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(new RegExp(schemaRefreshProgressFixture.correlationId)).length).toBeGreaterThan(0);
    });
  });

  it('renders unknown SSL state explicitly', async () => {
    vi.mocked(bootstrapApp).mockResolvedValue({
      ...appBootstrap,
      activeSession: {
        ...databaseSession,
        sslInUse: null,
      },
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /diagnostics/i }));

    expect(await screen.findByText('SSL: unknown')).toBeInTheDocument();
  });
});
