import { AlertTriangle, DatabaseZap, FileClock, ShieldAlert, Waves } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { ScrollArea } from '../../components/ui/scroll-area';
import type {
  AppBootstrap,
  AppError,
  BackgroundJobProgressEvent,
  DatabaseSessionSnapshot,
  QueryExecutionProgressEvent,
  QueryResultExportProgressEvent,
  QueryResultStreamEvent,
  SchemaNode,
  SchemaRefreshProgressEvent,
} from '../../lib/contracts';

type DiagnosticsPanelProps = {
  activeSession: DatabaseSessionSnapshot | null;
  bootstrap: AppBootstrap | null;
  lastError: AppError | null;
  recentEvents: BackgroundJobProgressEvent[];
  recentQueryEvents: QueryExecutionProgressEvent[];
  recentResultExportEvents: QueryResultExportProgressEvent[];
  recentResultStreamEvents: QueryResultStreamEvent[];
  recentSchemaEvents: SchemaRefreshProgressEvent[];
  selectedSchemaNode: SchemaNode | null;
};

export function DiagnosticsPanel({
  activeSession,
  bootstrap,
  lastError,
  recentEvents,
  recentQueryEvents,
  recentResultExportEvents,
  recentResultStreamEvents,
  recentSchemaEvents,
  selectedSchemaNode,
}: DiagnosticsPanelProps) {
  return (
    <div className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)]" data-testid="diagnostics-dialog">
      <div className="border-b border-[var(--border-subtle)] px-6 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Diagnostics</p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">Runtime visibility</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
          Background jobs, storage paths, recent failures, and schema selection details live here so the workspace can
          stay clean by default.
        </p>
      </div>

      <ScrollArea className="min-h-0 px-6 pb-6 pt-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            icon={<DatabaseZap className="h-4 w-4" />}
            title="Runtime paths"
            content={
              <dl className="grid gap-3 text-sm text-[var(--text-secondary)]">
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">SQLite store</dt>
                  <dd className="mt-1 break-all">{bootstrap?.storage.databasePath ?? 'pending'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Log file</dt>
                  <dd className="mt-1 break-all">{bootstrap?.storage.logFilePath ?? 'pending'}</dd>
                </div>
              </dl>
            }
          />

          <Card
            icon={<ShieldAlert className="h-4 w-4" />}
            title="Last error"
            content={
              lastError ? (
                <div className="grid gap-3 text-sm text-[var(--text-secondary)]">
                  <p className="text-[var(--danger-text)]">{lastError.message}</p>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {lastError.code} / {lastError.correlationId}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">No recorded error.</p>
              )
            }
          />

          <Card
            icon={<Waves className="h-4 w-4" />}
            title="Connection snapshot"
            content={
              <div className="grid gap-2 text-sm text-[var(--text-secondary)]">
                <p>Saved targets: {bootstrap?.savedConnections.length ?? 0}</p>
                <p>Selected id: {bootstrap?.selectedConnectionId ?? 'none'}</p>
                <p>Active session: {activeSession?.name ?? 'none'}</p>
                <p>
                  SSL:{' '}
                  {activeSession?.sslInUse === true
                    ? 'enabled'
                    : activeSession?.sslInUse === false
                      ? 'disabled'
                      : activeSession
                        ? 'unknown'
                        : 'n/a'}
                </p>
              </div>
            }
          />

          <Card
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Selected schema node"
            content={
              <div className="grid gap-2 text-sm text-[var(--text-secondary)]">
                <p>Name: {selectedSchemaNode?.name ?? 'none'}</p>
                <p>Kind: {selectedSchemaNode?.kind ?? 'none'}</p>
                <p className="break-all">Path: {selectedSchemaNode?.path ?? 'none'}</p>
              </div>
            }
          />
        </div>

        <section className="mt-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4">
          <div className="flex items-center gap-2">
            <FileClock className="h-4 w-4 text-[var(--accent-text)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recent events</h3>
            <Badge className="ml-auto">
              {recentEvents.length +
                recentSchemaEvents.length +
                recentQueryEvents.length +
                recentResultStreamEvents.length +
                recentResultExportEvents.length}
            </Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {recentQueryEvents.length > 0 ||
            recentSchemaEvents.length > 0 ||
            recentEvents.length > 0 ||
            recentResultStreamEvents.length > 0 ||
            recentResultExportEvents.length > 0 ? (
              <>
                {recentQueryEvents.slice(0, 4).map((event) => (
                  <EventRow
                    key={`${event.jobId}-${event.status}-${event.startedAt}`}
                    label={`${event.status} / ${event.tabId}`}
                    message={event.message}
                    meta={`Job ${event.jobId} / ${event.connectionId} / ${event.elapsedMs} ms`}
                    tone={event.lastError ? 'danger' : 'default'}
                  />
                ))}
                {recentResultStreamEvents.slice(0, 4).map((event) => (
                  <EventRow
                    key={`${event.jobId}-${event.status}-${event.timestamp}`}
                    label={`${event.status} / ${event.resultSetId.slice(0, 8)}`}
                    message={event.message}
                    meta={`${event.connectionId} / ${event.bufferedRowCount} buffered`}
                    tone={event.lastError ? 'danger' : 'default'}
                  />
                ))}
                {recentResultExportEvents.slice(0, 4).map((event) => (
                  <EventRow
                    key={`${event.jobId}-${event.status}-${event.outputPath}`}
                    label={`${event.status} / export`}
                    message={event.message}
                    meta={`${event.outputPath} / ${event.rowsWritten} rows`}
                    tone={event.lastError ? 'danger' : 'default'}
                  />
                ))}
                {recentSchemaEvents.slice(0, 4).map((event) => (
                  <EventRow
                    key={`${event.jobId}-${event.status}-${event.timestamp}`}
                    label={`${event.status} / ${event.scopePath ?? 'root'}`}
                    message={event.message}
                    meta={event.correlationId}
                    tone={event.status === 'failed' ? 'danger' : 'default'}
                  />
                ))}
                {recentEvents.slice(0, 4).map((event) => (
                  <EventRow
                    key={`${event.jobId}-${event.status}-${event.timestamp}`}
                    label={event.status}
                    message={event.message}
                    meta={event.correlationId}
                    tone={event.lastError ? 'danger' : 'default'}
                  />
                ))}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-4 text-sm text-[var(--text-secondary)]">
                Event history will appear here as background tasks report status.
              </div>
            )}
          </div>
        </section>
      </ScrollArea>
    </div>
  );
}

function Card({
  content,
  icon,
  title,
}: {
  content: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-[var(--surface-highlight)] p-2 text-[var(--accent-text)]">{icon}</div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
      <div className="mt-4">{content}</div>
    </section>
  );
}

function EventRow({
  label,
  message,
  meta,
  tone,
}: {
  label: string;
  message: string;
  meta: string;
  tone: 'danger' | 'default';
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-[var(--text-primary)]">{message}</p>
        <Badge variant={tone === 'danger' ? 'danger' : 'default'}>{label}</Badge>
      </div>
      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{meta}</p>
    </div>
  );
}
