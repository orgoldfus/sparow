import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import connectionDetailsFixture from '../../fixtures/contracts/connection-details.json';
import connectionTestResultFixture from '../../fixtures/contracts/connection-test-result.json';
import databaseSessionSnapshotFixture from '../../fixtures/contracts/database-session-snapshot.json';
import listSchemaChildrenResultFixture from '../../fixtures/contracts/list-schema-children-result.json';
import schemaSearchResultFixture from '../../fixtures/contracts/schema-search-result.json';
import type {
  ConnectionDetails,
  DatabaseSessionSnapshot,
  ListSchemaChildrenResult,
  SaveConnectionRequest,
} from '../lib/contracts';
import { isConnectionDetails, isDatabaseSessionSnapshot } from '../lib/guards';
import {
  getSavedConnection,
  saveConnection,
  subscribeToQueryExecutionEvent,
  subscribeToSchemaRefreshEvent,
} from '../lib/ipc';

function expectConnectionDetails(value: unknown): ConnectionDetails {
  expect(isConnectionDetails(value)).toBe(true);
  return value as ConnectionDetails;
}

function expectDatabaseSessionSnapshot(value: unknown): DatabaseSessionSnapshot {
  expect(isDatabaseSessionSnapshot(value)).toBe(true);
  return value as DatabaseSessionSnapshot;
}

const connectionDetails = expectConnectionDetails(connectionDetailsFixture);
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

vi.mock('../lib/ipc', () => ({
  bootstrapApp: vi.fn(() => Promise.resolve(appBootstrapFixture)),
  listSavedConnections: vi.fn(() => Promise.resolve(appBootstrapFixture.savedConnections)),
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
  subscribeToQueryExecutionEvent: vi.fn(() => Promise.resolve(() => {})),
  subscribeToSchemaRefreshEvent: vi.fn(() => Promise.resolve(() => {})),
}));

const saveConnectionMock = vi.mocked(saveConnection);
const getSavedConnectionMock = vi.mocked(getSavedConnection);
const subscribeToQueryExecutionEventMock = vi.mocked(subscribeToQueryExecutionEvent);
const subscribeToSchemaRefreshEventMock = vi.mocked(subscribeToSchemaRefreshEvent);

describe('App shell', () => {
  beforeEach(() => {
    saveConnectionMock.mockClear();
    getSavedConnectionMock.mockReset();
    subscribeToQueryExecutionEventMock.mockReset();
    subscribeToSchemaRefreshEventMock.mockReset();
    getSavedConnectionMock.mockResolvedValue(connectionDetails);
    saveConnectionMock.mockResolvedValue(connectionDetails);
    subscribeToQueryExecutionEventMock.mockResolvedValue(() => {});
    subscribeToSchemaRefreshEventMock.mockResolvedValue(() => {});
  });

  it('renders the five shell regions after bootstrap', async () => {
    render(<App />);

    await screen.findByTestId('environment-value');

    expect(screen.getByTestId('connections-region')).toBeInTheDocument();
    expect(screen.getByTestId('editor-tabs-region')).toBeInTheDocument();
    expect(screen.getByTestId('editor-region')).toBeInTheDocument();
    expect(screen.getByTestId('results-region')).toBeInTheDocument();
    expect(screen.getByTestId('status-region')).toBeInTheDocument();
  });

  it('opens the selected connection in the modal editor with saved profile details', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /edit connection/i }));

    expect(await screen.findByDisplayValue(connectionDetails.name)).toBeInTheDocument();
    expect(screen.getByText(/Saved profile selected/i)).toBeInTheDocument();
    expect(screen.getByText(/Credentials are already stored securely/i)).toBeInTheDocument();
  });

  it('opens a blank modal when creating a new connection', async () => {
    render(<App />);

    fireEvent.click(await screen.findByTestId('new-connection-button'));

    expect(await screen.findByTestId('connection-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('connection-name-input')).toHaveValue('');
    expect(screen.getByTestId('connection-host-input')).toHaveValue('');
  });

  it('disables connect when the selected profile has unsaved changes', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /edit connection/i }));
    const hostInput = await screen.findByDisplayValue(connectionDetails.host);
    const connectButton = screen.getByTestId('connect-connection-button');

    expect(connectButton).toBeEnabled();

    fireEvent.change(hostInput, {
      target: {
        value: '127.0.0.2',
      },
    });

    await waitFor(() => {
      expect(connectButton).toBeDisabled();
    });
  });

  it('switches into replacement-password mode for stored secrets', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /edit connection/i }));
    const replaceButton = await screen.findByText(/Replace password/i);
    fireEvent.click(replaceButton);

    expect(await screen.findByPlaceholderText(/Set a new secret/i)).toBeInTheDocument();
  });

  it('sends a password when saving a selected profile without a stored secret', async () => {
    const connectionWithoutSecret = {
      ...connectionDetails,
      hasStoredSecret: false,
      secretProvider: null,
    } satisfies ConnectionDetails;

    getSavedConnectionMock.mockResolvedValue(connectionWithoutSecret);
    saveConnectionMock.mockResolvedValue({
      ...connectionWithoutSecret,
      hasStoredSecret: true,
      secretProvider: 'os-keychain',
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /edit connection/i }));
    await screen.findByDisplayValue(connectionWithoutSecret.name);
    fireEvent.change(screen.getByTestId('connection-password-input'), {
      target: { value: 'sup3r-secret' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('save-connection-button')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('save-connection-button'));

    await waitFor(() => {
      expect(saveConnectionMock).toHaveBeenCalledTimes(1);
    });

    const request: SaveConnectionRequest | undefined = saveConnectionMock.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error('Expected saveConnection to receive a request payload.');
    }

    expect(request.id).toBe(connectionWithoutSecret.id);
    expect(request.draft.password).toBe('sup3r-secret');
  });

  it('keeps diagnostics hidden by default and opens them from the status bar', async () => {
    render(<App />);

    await screen.findByTestId('environment-value');
    expect(screen.queryByTestId('diagnostics-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /diagnostics/i }));

    expect(await screen.findByTestId('diagnostics-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Runtime visibility/i)).toBeInTheDocument();
  });

  it('cleans up a schema listener that resolves after unmount', async () => {
    let resolveCleanup: ((cleanup: () => void) => void) | undefined;
    const cleanup = vi.fn();

    subscribeToSchemaRefreshEventMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveCleanup = resolve;
        }),
    );

    const view = render(<App />);
    await screen.findByTestId('environment-value');

    view.unmount();
    resolveCleanup?.(cleanup);
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans up a query listener that resolves after unmount', async () => {
    let resolveCleanup: ((cleanup: () => void) => void) | undefined;
    const cleanup = vi.fn();

    subscribeToQueryExecutionEventMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveCleanup = resolve;
        }),
    );

    const view = render(<App />);
    await screen.findByTestId('environment-value');

    view.unmount();
    resolveCleanup?.(cleanup);
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
