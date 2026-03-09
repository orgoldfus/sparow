import { useDeferredValue, useEffect, useEffectEvent, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DiagnosticsPanel } from './features/diagnostics/DiagnosticsPanel';
import { ConnectionResults, ConnectionEditor, ConnectionsRail } from './features/connections/ConnectionWorkspace';
import { useConnectionWorkspace } from './features/connections/useConnectionWorkspace';
import { AppShell } from './features/shell/AppShell';
import {
  BACKGROUND_JOB_EVENT,
  type AppBootstrap,
  type AppError,
  type BackgroundJobProgressEvent,
} from './lib/contracts';
import { bootstrapApp, subscribeToEvent } from './lib/ipc';
import { logger } from './lib/logger';

export default function App() {
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [recentEvents, setRecentEvents] = useState<BackgroundJobProgressEvent[]>([]);

  const deferredRecentEvents = useDeferredValue(recentEvents);

  const workspace = useConnectionWorkspace({
    bootstrap,
    onError: setError,
  });

  const handleJobEvent = useEffectEvent((event: BackgroundJobProgressEvent) => {
    setRecentEvents((current) => [event, ...current].slice(0, 12));
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

  useEffect(() => {
    let cancelled = false;

    bootstrapApp()
      .then((nextBootstrap) => {
        if (cancelled) {
          return;
        }

        setBootstrap(nextBootstrap);
        setRecentEvents(nextBootstrap.diagnostics.recentEvents);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(logger.asAppError(caught, 'bootstrap_app'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
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
      .catch((caught) => {
        setError(logger.asAppError(caught, 'listen_background_job_event'));
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const statusHeadline = error
    ? 'The connection workspace loaded with a degraded service. Review diagnostics before trusting the current state.'
    : workspace.activeSession
      ? 'One PostgreSQL session is active in Rust. The UI stays focused on selection, editing, and verification.'
      : 'Phase 2 promotes saved PostgreSQL targets to a first-class native workspace with explicit, inspectable state.';

  return (
    <ErrorBoundary>
      <AppShell
        bootstrap={bootstrap}
        connectionEditor={
          <ConnectionEditor
            canConnect={workspace.canConnect}
            canDelete={workspace.canDelete}
            canDisconnect={workspace.canDisconnect}
            canSave={workspace.canSave}
            canTest={workspace.canTest}
            draft={workspace.draft}
            draftErrors={workspace.draftErrors}
            hasStoredSecret={workspace.hasStoredSecret}
            isDirty={workspace.isDirty}
            latestError={error ?? bootstrap?.diagnostics.lastError ?? null}
            pending={workspace.pending}
            replacePassword={workspace.replacePassword}
            selectedConnectionId={workspace.selectedConnectionId}
            onConnect={workspace.connectSelectedConnection}
            onDelete={workspace.deleteSelectedConnection}
            onDisconnect={workspace.disconnectSelectedConnection}
            onSave={workspace.saveSelectedConnection}
            onTest={workspace.testSelectedConnection}
            onToggleReplacePassword={workspace.setReplacePassword}
            onUpdateDraft={workspace.updateDraft}
          />
        }
        connectionResults={
          <ConnectionResults activeSession={workspace.activeSession} latestTestResult={workspace.latestTestResult} />
        }
        connectionsRail={
          <ConnectionsRail
            activeSession={workspace.activeSession}
            connections={workspace.connections}
            onCreateConnection={workspace.createConnection}
            onSelectConnection={workspace.selectConnection}
            selectedConnectionId={workspace.selectedConnectionId}
          />
        }
        diagnosticsPanel={
          <DiagnosticsPanel
            bootstrap={bootstrap}
            lastError={error ?? bootstrap?.diagnostics.lastError ?? null}
            recentEvents={deferredRecentEvents}
          />
        }
        error={error}
        isLoading={loading}
        recentEvents={deferredRecentEvents}
        statusHeadline={statusHeadline}
      />
    </ErrorBoundary>
  );
}
