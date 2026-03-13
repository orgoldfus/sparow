import { useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Bug, Dot, PencilLine } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { TooltipProvider } from './components/ui/tooltip';
import { DiagnosticsPanel } from './features/diagnostics/DiagnosticsPanel';
import { ConnectionEditor, ConnectionsRail } from './features/connections/ConnectionWorkspace';
import { useConnectionWorkspace } from './features/connections/useConnectionWorkspace';
import { QueryResultsPanel, QueryWorkspace } from './features/query/QueryWorkspace';
import { useQueryWorkspace } from './features/query/useQueryWorkspace';
import { SchemaSidebar } from './features/schema/SchemaWorkspace';
import { useSchemaBrowser } from './features/schema/useSchemaBrowser';
import { AppShell } from './features/shell/AppShell';
import {
  BACKGROUND_JOB_EVENT,
  QUERY_EXECUTION_EVENT,
  QUERY_RESULT_EXPORT_EVENT,
  QUERY_RESULT_STREAM_EVENT,
  SCHEMA_REFRESH_EVENT,
  type AppBootstrap,
  type AppError,
  type BackgroundJobProgressEvent,
  type QueryExecutionProgressEvent,
  type QueryResultExportProgressEvent,
  type QueryResultStreamEvent,
  type SchemaRefreshProgressEvent,
} from './lib/contracts';
import {
  bootstrapApp,
  subscribeToEvent,
  subscribeToQueryExecutionEvent,
  subscribeToQueryResultExportEvent,
  subscribeToQueryResultStreamEvent,
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
  const [resultStreamEvents, setResultStreamEvents] = useState<QueryResultStreamEvent[]>([]);
  const [resultExportEvents, setResultExportEvents] = useState<QueryResultExportProgressEvent[]>([]);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [isDiagnosticsDialogOpen, setIsDiagnosticsDialogOpen] = useState(false);
  const [activeResultsTab, setActiveResultsTab] = useState<'messages' | 'results'>('results');

  const deferredRecentEvents = useDeferredValue(recentEvents);
  const deferredSchemaEvents = useDeferredValue(schemaEvents);
  const deferredQueryEvents = useDeferredValue(queryEvents);
  const deferredResultStreamEvents = useDeferredValue(resultStreamEvents);
  const deferredResultExportEvents = useDeferredValue(resultExportEvents);

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
    resultStreamEvents: deferredResultStreamEvents,
    resultExportEvents: deferredResultExportEvents,
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

  const handleResultStreamEvent = useEffectEvent((event: QueryResultStreamEvent) => {
    setResultStreamEvents((current) => [event, ...current].slice(0, 12));
  });

  const handleResultExportEvent = useEffectEvent((event: QueryResultExportProgressEvent) => {
    setResultExportEvents((current) => [event, ...current].slice(0, 12));
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

    subscribeToQueryResultStreamEvent(QUERY_RESULT_STREAM_EVENT, (event) => {
      if (active) {
        handleResultStreamEvent(event);
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
        setError(logger.asAppError(caught, 'listen_query_result_stream_event'));
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    subscribeToQueryResultExportEvent(QUERY_RESULT_EXPORT_EVENT, (event) => {
      if (active) {
        handleResultExportEvent(event);
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
        setError(logger.asAppError(caught, 'listen_query_result_export_event'));
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

  const activeQueryError = queryWorkspace.activeTab?.execution.lastError ?? null;
  const isDegraded = Boolean(error || activeQueryError);
  const healthTone = isDegraded ? 'danger' : workspace.activeSession ? 'success' : 'warning';
  const latestStatusText = useMemo(() => {
    if (error) {
      return error.message;
    }
    if (activeQueryError) {
      return activeQueryError.message;
    }
    if (workspace.activeSession) {
      return `Connected to ${workspace.activeSession.name}.`;
    }
    return 'No active database session.';
  }, [activeQueryError, error, workspace.activeSession]);

  function openNewConnectionDialog() {
    workspace.createConnection();
    setEditingConnectionId(null);
    setIsConnectionDialogOpen(true);
  }

  function openEditConnectionDialog(connectionId?: string | null) {
    const nextConnectionId = connectionId ?? workspace.selectedConnectionId;
    if (!nextConnectionId) {
      return;
    }

    workspace.selectConnection(nextConnectionId);
    setEditingConnectionId(nextConnectionId);
    setIsConnectionDialogOpen(true);
  }

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={150}>
        <AppShell
          bootstrapEnvironment={bootstrap?.environment ?? null}
          bootstrapPlatform={bootstrap?.platform ?? null}
          connectionDialog={
            <Dialog
              onOpenChange={(open) => {
                setIsConnectionDialogOpen(open);
                if (!open) {
                  setEditingConnectionId(null);
                }
              }}
              open={isConnectionDialogOpen}
            >
              <DialogContent className="p-0" showClose>
                <DialogHeader className="sr-only">
                  <DialogTitle>{editingConnectionId ? 'Edit connection' : 'New connection'}</DialogTitle>
                  <DialogDescription>Connection metadata, security, and transport settings.</DialogDescription>
                </DialogHeader>
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
                  selectedConnectionId={editingConnectionId ?? workspace.selectedConnectionId}
                  onConnect={workspace.connectSelectedConnection}
                  onDelete={workspace.deleteSelectedConnection}
                  onDisconnect={workspace.disconnectSelectedConnection}
                  onSave={workspace.saveSelectedConnection}
                  onTest={workspace.testSelectedConnection}
                  onToggleReplacePassword={workspace.setReplacePassword}
                  onUpdateDraft={workspace.updateDraft}
                />
              </DialogContent>
            </Dialog>
          }
          diagnosticsDialog={
            <Dialog onOpenChange={setIsDiagnosticsDialogOpen} open={isDiagnosticsDialogOpen}>
              <DialogContent className="p-0" showClose>
                <DialogHeader className="sr-only">
                  <DialogTitle>Diagnostics</DialogTitle>
                  <DialogDescription>Background jobs and runtime metadata.</DialogDescription>
                </DialogHeader>
                <DiagnosticsPanel
                  activeSession={workspace.activeSession}
                  bootstrap={bootstrap}
                  lastError={error ?? bootstrap?.diagnostics.lastError ?? null}
                  recentEvents={deferredRecentEvents}
                  recentQueryEvents={deferredQueryEvents}
                  recentResultExportEvents={deferredResultExportEvents}
                  recentResultStreamEvents={deferredResultStreamEvents}
                  recentSchemaEvents={deferredSchemaEvents}
                  selectedSchemaNode={schemaBrowser.selectedNode}
                />
              </DialogContent>
            </Dialog>
          }
          editor={
            <QueryWorkspace
              activeSession={workspace.activeSession}
              connections={workspace.connections}
              onError={(caught) => {
                setError(logger.asAppError(caught, 'query_workspace'));
              }}
              workspace={queryWorkspace}
            />
          }
          editorTabs={null}
          isLoading={loading}
          leftSidebar={
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <ConnectionsRail
                activeSession={workspace.activeSession}
                canConnect={workspace.canConnect}
                canDisconnect={workspace.canDisconnect}
                connections={workspace.connections}
                onConnectSelected={workspace.connectSelectedConnection}
                onCreateConnection={openNewConnectionDialog}
                onDisconnectSelected={workspace.disconnectSelectedConnection}
                onEditSelected={() => {
                  openEditConnectionDialog();
                }}
                onSelectConnection={workspace.selectConnection}
                pending={workspace.pending}
                selectedConnectionId={workspace.selectedConnectionId}
              />
              <SchemaSidebar activeSession={workspace.activeSession} schema={schemaBrowser} />
            </div>
          }
          results={
            <QueryResultsPanel
              activeSession={workspace.activeSession}
              activeView={activeResultsTab}
              onActiveViewChange={setActiveResultsTab}
              workspace={queryWorkspace}
            />
          }
          statusBar={
            <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
                <Badge variant={healthTone}>{isDegraded ? 'Degraded' : workspace.activeSession ? 'Ready' : 'Idle'}</Badge>
                <span>{workspace.activeSession?.name ?? 'No active session'}</span>
                <span className="inline-flex items-center gap-1">
                  <Dot className="h-4 w-4" />
                  {queryWorkspace.activeTab?.execution.status ?? 'idle'}
                </span>
                <span>{queryWorkspace.activeTab?.title ?? 'No tab selected'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden max-w-[560px] truncate text-sm text-[var(--text-secondary)] lg:block">
                  {latestStatusText}
                </div>
                <Button
                  onClick={() => {
                    setIsDiagnosticsDialogOpen(true);
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Bug className="h-3.5 w-3.5" />
                  Diagnostics
                </Button>
                <Button
                  onClick={() => {
                    openEditConnectionDialog();
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  Edit connection
                </Button>
              </div>
            </div>
          }
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
