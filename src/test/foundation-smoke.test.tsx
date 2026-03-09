import { render, screen } from '@testing-library/react';
import App from '../App';
import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';

vi.mock('../lib/ipc', () => ({
  bootstrapApp: vi.fn(() => Promise.resolve(appBootstrapFixture)),
  startMockJob: vi.fn(() => Promise.resolve({
    jobId: 'job-smoke',
    correlationId: 'corr-smoke',
    startedAt: '2026-03-08T17:00:00.000Z',
  })),
  cancelMockJob: vi.fn(() => Promise.resolve({ jobId: 'job-smoke' })),
  subscribeToEvent: vi.fn(() => Promise.resolve(() => {})),
}));

describe('foundation smoke', () => {
  it('boots the shell with diagnostics visible', async () => {
    render(<App />);

    expect(await screen.findByTestId('environment-value')).toHaveTextContent('development');
    expect(screen.getByText(/Diagnostics Surface/i)).toBeInTheDocument();
  });
});
