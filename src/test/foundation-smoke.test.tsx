import { render, screen } from '@testing-library/react';
import App from '../App';
import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import connectionDetailsFixture from '../../fixtures/contracts/connection-details.json';
import connectionTestResultFixture from '../../fixtures/contracts/connection-test-result.json';
import databaseSessionSnapshotFixture from '../../fixtures/contracts/database-session-snapshot.json';

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
}));

describe('foundation smoke', () => {
  it('boots the shell with diagnostics visible', async () => {
    render(<App />);

    expect(await screen.findByTestId('environment-value')).toHaveTextContent('development');
    expect(screen.getByText(/Diagnostics Surface/i)).toBeInTheDocument();
    expect(screen.getByText(/Connection status/i)).toBeInTheDocument();
  });
});
