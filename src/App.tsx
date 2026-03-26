import { useDeferredValue, useEffect, useEffectEvent, useState } from 'react';
import { ChevronDown, Database, Hash, HelpCircle, Settings2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
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
import {
  QueryResultsPanel,
  QueryTabStrip,
  QueryWorkspace,
  type QueryResultsView,
} from './features/query/QueryWorkspace';
import { useQueryCursorPosition } from './features/query/queryCursorPosition';
import { useQueryWorkspace } from './features/query/useQueryWorkspace';
import { SchemaSidebar } from './features/schema/SchemaWorkspace';
import { useSchemaBrowser } from './features/schema/useSchemaBrowser';
import { AppShell } from './features/shell/AppShell';
import {
  BACKGROUND_JOB_EVENT,
  QUERY_EXECUTION_EVENT,
  QUERY_RESULT_EXPORT_EVENT,
  SCHEMA_REFRESH_EVENT,
  type AppBootstrap,
  type AppError,
  type BackgroundJobProgressEvent,
  type QueryExecutionProgressEvent,
  type QueryResultExportProgressEvent,
  type SchemaRefreshProgressEvent,
} from './lib/contracts';
import {
  bootstrapApp,
  subscribeToEvent,
  subscribeToQueryExecutionEvent,
  subscribeToQueryResultExportEvent,
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
  const [resultExportEvents, setResultExportEvents] = useState<QueryResultExportProgressEvent[]>([]);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [isDiagnosticsDialogOpen, setIsDiagnosticsDialogOpen] = useState(false);
  const [activeResultsTab, setActiveResultsTab] = useState<QueryResultsView>('results');

  const deferredRecentEvents = useDeferredValue(recentEvents);
  const deferredSchemaEvents = useDeferredValue(schemaEvents);
  const deferredQueryEvents = useDeferredValue(queryEvents);
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
  const activeResultSummary = queryWorkspace.activeTab?.result.summary ?? null;
  const activeResultLabel = activeResultSummary
    ? `${activeResultSummary.bufferedRowCount}${activeResultSummary.hasMoreRows ? '+' : ''} rows${queryWorkspace.activeTab?.execution.lastEvent ? ` · ${queryWorkspace.activeTab.execution.lastEvent.elapsedMs}ms` : ''}`
    : 'No result';
  const connectionStatusLabel = workspace.activeSession
    ? `${workspace.activeSession.name} — ${workspace.activeSession.database}`
    : isDegraded
      ? (error?.message ?? 'Error')
      : 'No active session';
  const connectionStatusTone = isDegraded
    ? 'text-[var(--danger-text)]'
    : workspace.activeSession
      ? 'text-[var(--success-text)]'
      : 'text-[var(--warning-text)]';
  const headerConnectionName =
    workspace.activeSession?.name ??
    workspace.connections.find((connection) => connection.id === workspace.selectedConnectionId)?.name ??
    'No connection';
  const editableConnectionId = workspace.activeSession?.connectionId ?? workspace.selectedConnectionId ?? null;

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
                  recentSchemaEvents={deferredSchemaEvents}
                  selectedSchemaNode={schemaBrowser.selectedNode}
                />
              </DialogContent>
            </Dialog>
          }
          headerBar={
            <div className="flex h-10 items-center justify-between px-3">
              {/* Left: logo + divider + menu */}
              <div className="flex items-center">
                <div className="flex items-center gap-2 pr-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-muted)]">
                    <Database className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                  </div>
                  <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">Sparow</span>
                </div>
              </div>

              {/* Right: connection chip + icon buttons + avatar */}
              <div className="flex items-center gap-0.5">
                {/* Environment value – kept accessible for tests */}
                <span className="sr-only" data-testid="environment-value">{bootstrap?.environment ?? 'booting'}</span>

                {/* Connection indicator chip */}
                <button
                  className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs transition hover:bg-[var(--surface-panel-hover)] disabled:pointer-events-none disabled:opacity-50"
                  disabled={!editableConnectionId}
                  onClick={() => {
                    if (editableConnectionId) {
                      openEditConnectionDialog(editableConnectionId);
                    }
                  }}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full transition ${
                      workspace.activeSession
                        ? 'bg-[var(--success-text)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--success-text)_18%,transparent)]'
                        : 'bg-[var(--border-strong)]'
                    }`}
                  />
                  {(workspace.activeSession ?? workspace.selectedConnectionId) ? (
                    <span className="rounded bg-[color-mix(in_oklch,var(--accent-muted)_80%,transparent)] px-1 py-0.5 text-[9px] font-bold text-[var(--accent-text)]">
                      PG
                    </span>
                  ) : null}
                  {workspace.activeSession ? (
                    <>
                      <span className="font-medium text-[var(--text-primary)]">{headerConnectionName}</span>
                      <span className="text-[var(--text-muted)]">{workspace.activeSession.database}</span>
                    </>
                  ) : (
                    <span className="text-[var(--text-secondary)]">{headerConnectionName}</span>
                  )}
                  <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                </button>

                {/* Diagnostics (#) */}
                <button
                  aria-label="Diagnostics"
                  className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] transition hover:bg-[var(--surface-panel-hover)] hover:text-[var(--text-secondary)]"
                  onClick={() => { setIsDiagnosticsDialogOpen(true); }}
                  type="button"
                >
                  <Hash className="h-4 w-4" />
                </button>

                {/* Help */}
                <button
                  aria-label="Help"
                  className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] opacity-40 transition hover:bg-[var(--surface-panel-hover)] hover:text-[var(--text-secondary)] hover:opacity-100"
                  disabled
                  type="button"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>

                {/* Connection settings */}
                <button
                  aria-label="Connection settings"
                  className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] transition hover:bg-[var(--surface-panel-hover)] hover:text-[var(--text-secondary)]"
                  onClick={() => { openEditConnectionDialog(); }}
                  type="button"
                >
                  <Settings2 className="h-4 w-4" />
                </button>

                {/* User avatar */}
                <div
                  aria-hidden="true"
                  className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--accent-solid)_52%,var(--surface-panel)_48%)] text-[10px] font-bold uppercase text-[var(--accent-foreground)]"
                >
                  {userInitials(workspace.activeSession?.username)}
                </div>
              </div>
            </div>
          }
          editor={
            <QueryWorkspace
              activeSession={workspace.activeSession}
              onError={(caught) => {
                setError(logger.asAppError(caught, 'query_workspace'));
              }}
              showTabStrip={false}
              workspace={queryWorkspace}
            />
          }
          editorTabs={<QueryTabStrip workspace={queryWorkspace} />}
          isLoading={loading}
          leftSidebar={
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <ConnectionsRail
                activeSession={workspace.activeSession}
                canDisconnect={workspace.canDisconnect}
                connectingConnectionId={workspace.connectingConnectionId}
                connections={workspace.connections}
                onActivateConnection={workspace.activateConnection}
                onCreateConnection={openNewConnectionDialog}
                onDisconnectSelected={workspace.disconnectSelectedConnection}
                onEditSelected={(connectionId) => {
                  openEditConnectionDialog(connectionId);
                }}
                onSelectConnection={workspace.selectConnection}
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
            <AppStatusBar
              canEditConnection={Boolean(editableConnectionId)}
              connectionStatusLabel={connectionStatusLabel}
              connectionStatusTone={connectionStatusTone}
              onEditConnection={() => {
                openEditConnectionDialog();
              }}
              resultStatusLabel={activeResultLabel}
              serverVersion={workspace.activeSession?.serverVersion ?? null}
            />
          }
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

function userInitials(username?: string | null): string {
  if (!username) {
    return 'U';
  }
  return username.slice(0, 2).toUpperCase();
}

type AppStatusBarProps = {
  canEditConnection: boolean;
  connectionStatusLabel: string;
  connectionStatusTone: string;
  onEditConnection: () => void;
  resultStatusLabel: string;
  serverVersion: string | null;
};

function AppStatusBar({
  canEditConnection,
  connectionStatusLabel,
  connectionStatusTone,
  onEditConnection,
  resultStatusLabel,
  serverVersion,
}: AppStatusBarProps) {
  const cursorPosition = useQueryCursorPosition();

  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
      <div className="flex items-center gap-2.5">
        <button
          aria-label="Edit connection"
          className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 transition hover:bg-[var(--surface-panel-hover)] ${connectionStatusTone}`}
          disabled={!canEditConnection}
          onClick={onEditConnection}
          type="button"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
          <span>{connectionStatusLabel}</span>
        </button>
        {serverVersion ? (
          <>
            <span aria-hidden="true" className="h-3 w-px bg-[var(--border-subtle)]" />
            <span>{serverVersion}</span>
          </>
        ) : null}
      </div>

      <div className="flex items-center">
        <span>Line {cursorPosition.line}, Col {cursorPosition.column}</span>
        <span aria-hidden="true" className="mx-2.5 h-3 w-px bg-[var(--border-subtle)]" />
        <span>{resultStatusLabel}</span>
        <span aria-hidden="true" className="mx-2.5 h-3 w-px bg-[var(--border-subtle)]" />
        <span>UTF-8</span>
      </div>
    </div>
  );
}
