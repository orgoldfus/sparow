import { Bug, DatabaseZap, FileClock, ShieldAlert } from 'lucide-react';
import type {
  AppBootstrap,
  AppError,
  BackgroundJobProgressEvent,
  SchemaRefreshProgressEvent,
} from '../../lib/contracts';

type DiagnosticsPanelProps = {
  bootstrap: AppBootstrap | null;
  lastError: AppError | null;
  recentEvents: BackgroundJobProgressEvent[];
  recentSchemaEvents: SchemaRefreshProgressEvent[];
};

export function DiagnosticsPanel({
  bootstrap,
  lastError,
  recentEvents,
  recentSchemaEvents,
}: DiagnosticsPanelProps) {
  return (
    <aside className="flex h-full min-h-[320px] flex-col">
      <div className="border-b border-[var(--line-soft)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-[var(--accent-strong)]" />
          <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--ink-3)]">
            Diagnostics Surface
          </h2>
        </div>
      </div>
      <div className="grid flex-1 gap-4 p-4">
        <section className="border border-[var(--line-soft)] bg-[var(--surface-1)] p-4">
          <div className="flex items-center gap-2 text-[var(--ink-1)]">
            <DatabaseZap className="h-4 w-4 text-[var(--accent-strong)]" />
            <h3 className="font-medium">Runtime paths</h3>
          </div>
          <dl className="mt-3 grid gap-3 text-sm text-[var(--ink-2)]">
            <div>
              <dt className="text-[var(--ink-3)]">SQLite store</dt>
              <dd className="break-all">{bootstrap?.storage.databasePath ?? 'pending'}</dd>
            </div>
            <div>
              <dt className="text-[var(--ink-3)]">Log file</dt>
              <dd className="break-all">{bootstrap?.storage.logFilePath ?? 'pending'}</dd>
            </div>
          </dl>
        </section>

        <section className="border border-[var(--line-soft)] bg-[var(--surface-1)] p-4">
          <div className="flex items-center gap-2 text-[var(--ink-1)]">
            <ShieldAlert className="h-4 w-4 text-[var(--accent-strong)]" />
            <h3 className="font-medium">Last error</h3>
          </div>
          <div className="mt-3 text-sm text-[var(--ink-2)]">
            {lastError ? (
              <>
                <p>{lastError.message}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
                  {lastError.code} / {lastError.correlationId}
                </p>
              </>
            ) : (
              <p>No recorded error.</p>
            )}
          </div>
        </section>

        <section className="border border-[var(--line-soft)] bg-[var(--surface-1)] p-4">
          <div className="flex items-center gap-2 text-[var(--ink-1)]">
            <FileClock className="h-4 w-4 text-[var(--accent-strong)]" />
            <h3 className="font-medium">Recent events</h3>
          </div>
          <ul className="mt-3 grid gap-2 text-sm text-[var(--ink-2)]">
            {recentEvents.length > 0 || recentSchemaEvents.length > 0 ? (
              <>
                {recentSchemaEvents.slice(0, 3).map((event) => (
                  <li
                    className="border border-[var(--line-soft)] bg-[var(--surface-0)] px-3 py-2"
                    key={`${event.jobId}-${event.status}-${event.timestamp}`}
                  >
                    <p>{event.message}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
                      {event.status} / {event.scopePath ?? 'root'} / {event.correlationId}
                    </p>
                  </li>
                ))}
                {recentEvents.slice(0, 3).map((event) => (
                <li
                  className="border border-[var(--line-soft)] bg-[var(--surface-0)] px-3 py-2"
                  key={`${event.jobId}-${event.status}-${event.timestamp}`}
                >
                  <p>{event.message}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
                    {event.status} / {event.correlationId}
                  </p>
                </li>
                ))}
              </>
            ) : (
              <li className="border border-dashed border-[var(--line-soft)] bg-[var(--surface-0)] px-3 py-2">
                Event history will appear here as background tasks report status.
              </li>
            )}
          </ul>
        </section>

        <section className="border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 text-sm text-[var(--ink-2)]">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">Connection snapshot</p>
          <div className="mt-3 grid gap-2">
            <p>Saved targets: {bootstrap?.savedConnections.length ?? 0}</p>
            <p>Selected id: {bootstrap?.selectedConnectionId ?? 'none'}</p>
            <p>Active session: {bootstrap?.activeSession?.name ?? 'none'}</p>
          </div>
        </section>
      </div>
    </aside>
  );
}
