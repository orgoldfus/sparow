import { useDeferredValue, useEffect, useEffectEvent, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DiagnosticsPanel } from './features/diagnostics/DiagnosticsPanel';
import { ConnectionEditor } from './features/connections/ConnectionWorkspace';
import { useConnectionWorkspace } from './features/connections/useConnectionWorkspace';
import { QueryResultsPanel, QueryWorkspace } from './features/query/QueryWorkspace';
import { useQueryWorkspace } from './features/query/useQueryWorkspace';
import { SchemaSidebar } from './features/schema/SchemaWorkspace';
import { useSchemaBrowser } from './features/schema/useSchemaBrowser';
import { AppShell } from './features/shell/AppShell';
import {
  BACKGROUND_JOB_EVENT,
  QUERY_EXECUTION_EVENT,
  SCHEMA_REFRESH_EVENT,
  type AppBootstrap,
  type AppError,
  type BackgroundJobProgressEvent,
  type QueryExecutionProgressEvent,
  type SchemaRefreshProgressEvent,
} from './lib/contracts';
import {
  bootstrapApp,
  subscribeToEvent,
  subscribeToQueryExecutionEvent,
  subscribeToSchemaRefreshEvent,
} from './lib/ipc';
import { logger } from './lib/logger';

export default function App() {
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [recentEvents, setRecentEvents] = useState<BackgroundJobProgressEvent[]>([]);
  const [schemaEvents, setSchemaEvents] = useState<SchemaRefreshProgressEvent[]>([]);
  const [queryEvents, setQueryEvents] = useState<QueryExecutionProgressEvent[]>([]);

  const deferredRecentEvents = useDeferredValue(recentEvents);
  const deferredSchemaEvents = useDeferredValue(schemaEvents);
  const deferredQueryEvents = useDeferredValue(queryEvents);

  const workspace = useConnectionWorkspace({
    bootstrap,
    onError: setError,
  });
  const schemaBrowser = useSchemaBrowser({
    activeConnectionId: workspace.activeSession?.connectionId ?? null,
    schemaEvents: deferredSchemaEvents,
    onError: setError,
  });
  const queryWorkspace = useQueryWorkspace({
    activeSession: workspace.activeSession,
    connections: workspace.connections,
    queryEvents: deferredQueryEvents,
    selectedConnectionId: workspace.selectedConnectionId,
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

  const handleSchemaEvent = useEffectEvent((event: SchemaRefreshProgressEvent) => {
    setSchemaEvents((current) => [event, ...current].slice(0, 12));
  });

  const handleQueryEvent = useEffectEvent((event: QueryExecutionProgressEvent) => {
    setQueryEvents((current) => [event, ...current].slice(0, 12));
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

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    subscribeToSchemaRefreshEvent(SCHEMA_REFRESH_EVENT, (event) => {
      if (active) {
        handleSchemaEvent(event);
      }
    })
      .then((cleanup) => {
        if (active) {
          unsubscribe = cleanup;
        } else {
          cleanup();
        }
      })
      .catch((caught) => {
        setError(logger.asAppError(caught, 'listen_schema_refresh_event'));
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    subscribeToQueryExecutionEvent(QUERY_EXECUTION_EVENT, (event) => {
      if (active) {
        handleQueryEvent(event);
      }
    })
      .then((cleanup) => {
        if (active) {
          unsubscribe = cleanup;
        } else {
          cleanup();
        }
      })
      .catch((caught) => {
        setError(logger.asAppError(caught, 'listen_query_execution_event'));
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const statusHeadline = error
    ? 'The connection workspace loaded with a degraded service. Review diagnostics before trusting the current state.'
    : workspace.activeSession
      ? 'One PostgreSQL session is active in Rust. Phase 4 adds a Monaco-based SQL workspace, per-tab targeting, cancellation, and capped result previews without giving up the explicit schema explorer.'
      : 'Connect a saved PostgreSQL target to unlock schema browsing, Monaco editing, and query execution inside the same native-feeling shell.';

  return (
    <ErrorBoundary>
      <AppShell
        bootstrap={bootstrap}
        connectionEditor={
          <QueryWorkspace
            activeSession={workspace.activeSession}
            connections={workspace.connections}
            onError={(caught) => {
              setError(logger.asAppError(caught, 'query_workspace'));
            }}
            workspace={queryWorkspace}
          />
        }
        connectionResults={
          <QueryResultsPanel
            activeSession={workspace.activeSession}
            result={queryWorkspace.activeTab?.execution.lastResult ?? null}
            tab={queryWorkspace.activeTab}
          />
        }
        connectionsRail={
          <SchemaSidebar
            activeSession={workspace.activeSession}
            connections={workspace.connections}
            onCreateConnection={workspace.createConnection}
            onSelectConnection={workspace.selectConnection}
            schema={schemaBrowser}
            selectedConnectionId={workspace.selectedConnectionId}
          />
        }
        diagnosticsPanel={
          <div className="grid h-full min-h-[300px] grid-rows-[minmax(0,1fr)_420px]">
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
            <DiagnosticsPanel
              activeSession={workspace.activeSession}
              bootstrap={bootstrap}
              lastError={error ?? bootstrap?.diagnostics.lastError ?? null}
              recentEvents={deferredRecentEvents}
              recentQueryEvents={deferredQueryEvents}
              recentSchemaEvents={deferredSchemaEvents}
              selectedSchemaNode={schemaBrowser.selectedNode}
            />
          </div>
        }
        error={error}
        isLoading={loading}
        recentEvents={deferredRecentEvents}
        recentQueryEvents={deferredQueryEvents}
        statusHeadline={statusHeadline}
      />
    </ErrorBoundary>
  );
}
