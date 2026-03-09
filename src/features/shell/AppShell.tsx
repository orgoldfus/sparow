import { Database, PanelBottom, PanelLeftClose, ShieldCheck, TerminalSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppBootstrap, AppError, BackgroundJobProgressEvent } from '../../lib/contracts';

type AppShellProps = {
  bootstrap: AppBootstrap | null;
  connectionEditor: ReactNode;
  connectionResults: ReactNode;
  connectionsRail: ReactNode;
  diagnosticsPanel: ReactNode;
  error: AppError | null;
  isLoading: boolean;
  recentEvents: BackgroundJobProgressEvent[];
  statusHeadline: string;
};

export function AppShell({
  bootstrap,
  connectionEditor,
  connectionResults,
  connectionsRail,
  diagnosticsPanel,
  error,
  isLoading,
  recentEvents,
  statusHeadline,
}: AppShellProps) {
  const statusTone = error ? 'text-[var(--danger-ink)]' : 'text-[var(--accent-strong)]';

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(229,122,76,0.16),_transparent_32%),linear-gradient(180deg,_var(--surface-0),_var(--surface-1))] px-4 py-4 text-[var(--ink-1)] sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1600px] flex-col border border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-0)_92%,_white_8%)] shadow-[var(--shadow-shell)]">
        <header className="grid gap-6 border-b border-[var(--line-soft)] px-5 py-5 md:grid-cols-[1.45fr_0.95fr] md:px-7">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.28em] text-[var(--ink-3)]">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent-strong)]" />
              Sparow / Phase 2 Connections
            </div>
            <div className="max-w-3xl">
              <h1 className="font-display text-4xl leading-none text-[var(--ink-1)] sm:text-5xl">
                Secure PostgreSQL targets with native-feeling control surfaces.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--ink-2)]">{statusHeadline}</p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
              <span className="border border-[var(--line-soft)] px-3 py-2">Typed IPC only</span>
              <span className="border border-[var(--line-soft)] px-3 py-2">Secrets stay outside SQLite</span>
              <span className="border border-[var(--line-soft)] px-3 py-2">One active session</span>
            </div>
          </div>

          <section className="grid gap-3 border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-[0.24em] text-[var(--ink-3)]">Boot Status</span>
              <span className={`font-medium ${statusTone}`}>{error ? 'Degraded' : isLoading ? 'Loading' : 'Ready'}</span>
            </div>
            <dl className="grid gap-3 text-sm text-[var(--ink-2)] sm:grid-cols-2">
              <div>
                <dt className="text-[var(--ink-3)]">Environment</dt>
                <dd data-testid="environment-value">{bootstrap?.environment ?? 'pending'}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-3)]">Platform</dt>
                <dd>{bootstrap?.platform ?? 'pending'}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-3)]">Saved targets</dt>
                <dd>{bootstrap?.savedConnections.length ?? 0}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-3)]">Recent events</dt>
                <dd>{recentEvents.length}</dd>
              </div>
            </dl>
          </section>
        </header>

        <div className="grid flex-1 gap-px bg-[var(--line-soft)] lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="flex flex-col bg-[var(--surface-1)]" data-testid="connections-region">
            <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
              <div className="flex items-center gap-2">
                <PanelLeftClose className="h-4 w-4 text-[var(--accent-strong)]" />
                <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--ink-3)]">
                  Connections
                </h2>
              </div>
              <span className="text-xs text-[var(--ink-3)]">Native workspace rail</span>
            </div>
            {connectionsRail}
          </aside>

          <section className="grid min-h-0 gap-px bg-[var(--line-soft)] xl:grid-rows-[auto_minmax(0,1fr)_280px]">
            <div className="bg-[var(--surface-0)]" data-testid="editor-tabs-region">
              <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[var(--accent-strong)]" />
                  <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--ink-3)]">Workspace</h2>
                </div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">
                  <ShieldCheck className="h-4 w-4" />
                  PostgreSQL only
                </div>
              </div>
              <div className="flex flex-wrap gap-2 px-4 py-4">
                <div className="border border-[var(--line-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--ink-1)]">
                  Connection editor
                </div>
                <div className="border border-[var(--line-soft)] px-3 py-2 text-sm text-[var(--ink-3)]">
                  Secure secrets
                </div>
                <div className="border border-[var(--line-soft)] px-3 py-2 text-sm text-[var(--ink-3)]">
                  Session status
                </div>
              </div>
            </div>

            <section className="grid min-h-0 gap-px bg-[var(--line-soft)] xl:grid-cols-[minmax(0,1fr)_360px]" data-testid="editor-region">
              {connectionEditor}
              <div className="min-h-[300px] bg-[var(--surface-0)]">{diagnosticsPanel}</div>
            </section>

            <section className="bg-[var(--surface-1)]" data-testid="results-region">
              <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <PanelBottom className="h-4 w-4 text-[var(--accent-strong)]" />
                  <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--ink-3)]">
                    Connection status
                  </h2>
                </div>
                <span className="text-xs text-[var(--ink-3)]">Tests and live session state</span>
              </div>
              {connectionResults}
            </section>
          </section>
        </div>

        <footer
          className="flex flex-col gap-2 border-t border-[var(--line-soft)] bg-[var(--surface-0)] px-4 py-3 text-xs uppercase tracking-[0.18em] text-[var(--ink-3)] md:flex-row md:items-center md:justify-between"
          data-testid="status-region"
        >
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4" />
            <span>{import.meta.env.DEV ? 'Diagnostics visible in development' : 'Production shell'}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            <span>Selection persists</span>
            <span>Secrets externalized</span>
            <span>Rust owns sessions</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
