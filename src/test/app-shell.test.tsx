import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import appBootstrapFixture from '../../fixtures/contracts/app-bootstrap.json';
import backgroundJobAcceptedFixture from '../../fixtures/contracts/background-job-accepted.json';
import backgroundJobProgressFixture from '../../fixtures/contracts/background-job-progress.json';

const subscribeHandlers = new Set<(payload: typeof backgroundJobProgressFixture) => void>();

vi.mock('../lib/ipc', () => ({
  bootstrapApp: vi.fn(() => Promise.resolve(appBootstrapFixture)),
  startMockJob: vi.fn(() => Promise.resolve(backgroundJobAcceptedFixture)),
  cancelMockJob: vi.fn(() => Promise.resolve({ jobId: backgroundJobAcceptedFixture.jobId })),
  subscribeToEvent: vi.fn((_eventName: string, handler: (payload: typeof backgroundJobProgressFixture) => void) => {
    subscribeHandlers.add(handler);
    return Promise.resolve(() => {
      subscribeHandlers.delete(handler);
    });
  }),
}));

describe('App shell', () => {
  afterEach(() => {
    subscribeHandlers.clear();
  });

  it('renders the five shell regions after bootstrap', async () => {
    render(<App />);

    await screen.findByText(/A desktop shell built to stay inspectable under pressure/i);

    expect(screen.getByTestId('connections-region')).toBeInTheDocument();
    expect(screen.getByTestId('editor-tabs-region')).toBeInTheDocument();
    expect(screen.getByTestId('editor-region')).toBeInTheDocument();
    expect(screen.getByTestId('results-region')).toBeInTheDocument();
    expect(screen.getByTestId('status-region')).toBeInTheDocument();
  });

  it('shows event updates after the job starts', async () => {
    render(<App />);

    const runButton = await screen.findByTestId('run-mock-job');
    fireEvent.click(runButton);

    act(() => {
      for (const handler of subscribeHandlers) {
        handler(backgroundJobProgressFixture);
      }
    });

    await waitFor(() => {
      expect(screen.getAllByText(backgroundJobProgressFixture.message).length).toBeGreaterThan(0);
    });
  });
});
