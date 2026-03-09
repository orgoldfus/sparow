import { useEffect, useEffectEvent, useState, startTransition, useDeferredValue } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DiagnosticsPanel } from './features/diagnostics/DiagnosticsPanel';
import { AppShell } from './features/shell/AppShell';
import {
  BACKGROUND_JOB_EVENT,
  type AppBootstrap,
  type AppError,
  type BackgroundJobAccepted,
  type BackgroundJobProgressEvent,
  type BackgroundJobRequest,
} from './lib/contracts';
import { bootstrapApp, cancelMockJob, startMockJob, subscribeToEvent } from './lib/ipc';
import { logger } from './lib/logger';

type JobViewState = {
  activeJob: BackgroundJobAccepted | null;
  recentEvents: BackgroundJobProgressEvent[];
};

const DEFAULT_JOB_REQUEST: BackgroundJobRequest = {
  label: 'Phase 1 responsiveness proof',
  steps: 6,
  delayMs: 350,
};

export default function App() {
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [jobState, setJobState] = useState<JobViewState>({
    activeJob: null,
    recentEvents: [],
  });

  const recentEvents = useDeferredValue(jobState.recentEvents);

  const handleJobEvent = useEffectEvent((event: BackgroundJobProgressEvent) => {
    startTransition(() => {
      setJobState((current) => {
        const nextEvents = [event, ...current.recentEvents].slice(0, 12);
        const shouldClearActive =
          event.status === 'cancelled' || event.status === 'completed' || event.status === 'failed';

        return {
          activeJob:
            shouldClearActive && current.activeJob?.jobId === event.jobId ? null : current.activeJob,
          recentEvents: nextEvents,
        };
      });

      setBootstrap((current) =>
        current
          ? {
              ...current,
              diagnostics: {
                ...current.diagnostics,
                lastError: event.lastError ?? current.diagnostics.lastError,
                recentEvents: [event, ...current.diagnostics.recentEvents].slice(0, 12),
              },
            }
          : current,
      );
    });
  });

  useEffect(() => {
    let cancelled = false;

    async function loadBootstrap() {
      try {
        const nextBootstrap = await bootstrapApp();
        if (cancelled) {
          return;
        }

        setBootstrap(nextBootstrap);
        setJobState((current) => ({
          ...current,
          recentEvents: nextBootstrap.diagnostics.recentEvents,
        }));
      } catch (caught) {
        if (cancelled) {
          return;
        }

        const nextError = logger.asAppError(caught, 'bootstrap_app');
        setError(nextError);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadBootstrap().catch((caught: unknown) => {
      const nextError = logger.asAppError(caught, 'bootstrap_app_unhandled');
      setError(nextError);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    subscribeToEvent(BACKGROUND_JOB_EVENT, (event) => {
      if (active) {
        handleJobEvent(event);
      }
    })
      .then((cleanup) => {
        unsubscribe = cleanup;
      })
      .catch((caught: unknown) => {
        const nextError = logger.asAppError(caught, 'listen_background_job_event');
        setError(nextError);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const isRunning = Boolean(jobState.activeJob);

  const statusHeadline = error
    ? 'The shell is alive, but one of the foundation services failed.'
    : isRunning
      ? 'The UI is intentionally still interactive while the mock backend job runs.'
      : 'Phase 1 foundation is wired for typed commands, diagnostics, and background work.';

  async function handleRunJob() {
    setError(null);

    try {
      const accepted = await startMockJob(DEFAULT_JOB_REQUEST);
      setJobState((current) => ({
        ...current,
        activeJob: accepted,
      }));
      logger.info('jobs', 'Mock job started.', accepted);
    } catch (caught) {
      setError(logger.asAppError(caught, 'run_mock_job'));
    }
  }

  async function handleCancelJob() {
    if (!jobState.activeJob) {
      return;
    }

    try {
      await cancelMockJob(jobState.activeJob.jobId);
      logger.info('jobs', 'Mock job cancellation requested.', {
        jobId: jobState.activeJob.jobId,
      });
    } catch (caught) {
      setError(logger.asAppError(caught, 'cancel_mock_job'));
    }
  }

  return (
    <ErrorBoundary>
      <AppShell
        bootstrap={bootstrap}
        deferredRecentEvents={recentEvents}
        error={error}
        isLoading={loading}
        isRunning={isRunning}
        onCancelJob={handleCancelJob}
        onRunJob={handleRunJob}
        statusHeadline={statusHeadline}
      >
        <DiagnosticsPanel
          bootstrap={bootstrap}
          lastError={error ?? bootstrap?.diagnostics.lastError ?? null}
          recentEvents={recentEvents}
        />
      </AppShell>
    </ErrorBoundary>
  );
}
