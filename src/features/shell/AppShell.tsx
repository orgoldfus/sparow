import { ArrowUpRight, Database, PanelBottom, PanelLeftClose, Play, Square, TerminalSquare } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import type { AppBootstrap, AppError, BackgroundJobProgressEvent } from '../../lib/contracts';

type AppShellProps = PropsWithChildren<{
  bootstrap: AppBootstrap | null;
  deferredRecentEvents: BackgroundJobProgressEvent[];
  error: AppError | null;
  isLoading: boolean;
  isRunning: boolean;
  onRunJob: () => Promise<void>;
  onCancelJob: () => Promise<void>;
  statusHeadline: string;
}>;

const placeholderConnections = [
  'Local analytics',
  'Staging warehouse',
  'Production mirror',
];

const placeholderTabs = ['scratch.sql', 'history-preview.sql', 'phase-1-checklist.sql'];

export function AppShell({
  bootstrap,
  children,
  deferredRecentEvents,
  error,
  isLoading,
  isRunning,
  onCancelJob,
  onRunJob,
  statusHeadline,
}: AppShellProps) {
  const statusTone = error ? 'text-[var(--danger-ink)]' : 'text-[var(--accent-strong)]';

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(229,122,76,0.16),_transparent_32%),linear-gradient(180deg,_var(--surface-0),_var(--surface-1))] px-4 py-4 text-[var(--ink-1)] sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1600px] flex-col border border-[var(--line-soft)] bg-[color-mix(in_oklch,_var(--surface-0)_92%,_white_8%)] shadow-[var(--shadow-shell)]">
        <header className="grid gap-6 border-b border-[var(--line-soft)] px-5 py-5 md:grid-cols-[1.5fr_1fr] md:px-7">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.28em] text-[var(--ink-3)]">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent-strong)]" />
              Sparow / Phase 1 Foundation
            </div>
            <div className="max-w-3xl">
              <h1 className="font-display text-4xl leading-none text-[var(--ink-1)] sm:text-5xl">
                A desktop shell built to stay inspectable under pressure.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--ink-2)]">{statusHeadline}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex items-center gap-2 border border-[var(--line-strong)] bg-[var(--accent-soft)] px-4 py-2.5 text-sm font-medium text-[var(--ink-1)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-softer)]"
                data-testid="run-mock-job"
                disabled={isRunning || isLoading}
                onClick={() => {
                  void onRunJob();
                }}
                type="button"
              >
                <Play className="h-4 w-4" />
                Run deterministic job
              </button>
              <button
                className="inline-flex items-center gap-2 border border-[var(--line-soft)] bg-[var(--surface-1)] px-4 py-2.5 text-sm font-medium text-[var(--ink-2)] transition hover:-translate-y-0.5 hover:border-[var(--line-strong)] disabled:cursor-not-allowed disabled:opacity-55"
                data-testid="cancel-mock-job"
                disabled={!isRunning}
                onClick={() => {
                  void onCancelJob();
                }}
                type="button"
              >
                <Square className="h-4 w-4" />
                Cancel job
              </button>
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
                <dt className="text-[var(--ink-3)]">Database path</dt>
                <dd className="truncate">{bootstrap?.storage.databasePath ?? 'pending'}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-3)]">Log file</dt>
                <dd className="truncate">{bootstrap?.storage.logFilePath ?? 'pending'}</dd>
              </div>
            </dl>
          </section>
        </header>

        <div className="grid flex-1 gap-px bg-[var(--line-soft)] lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside
            className="flex flex-col bg-[var(--surface-1)]"
            data-testid="connections-region"
          >
            <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
              <div className="flex items-center gap-2">
                <PanelLeftClose className="h-4 w-4 text-[var(--accent-strong)]" />
                <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--ink-3)]">
                  Connections + Schema
                </h2>
              </div>
              <span className="text-xs text-[var(--ink-3)]">Placeholder</span>
            </div>
            <div className="space-y-5 p-4">
              <section>
                <p className="mb-3 text-xs uppercase tracking-[0.2em] text-[var(--ink-3)]">Saved Targets</p>
                <ul className="space-y-2">
                  {placeholderConnections.map((connection, index) => (
                    <li
                      className="border border-[var(--line-soft)] bg-[var(--surface-0)] px-3 py-3 text-sm"
                      key={connection}
                    >
                      <div className="flex items-center justify-between">
                        <span>{connection}</span>
                        <span className="text-xs text-[var(--ink-3)]">0{index + 1}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="border border-dashed border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
                <p className="text-sm text-[var(--ink-2)]">
                  Future schema nodes will lazy-load here. Phase 1 keeps the region real so later work replaces
                  content instead of layout.
                </p>
              </section>
            </div>
          </aside>

          <section className="grid min-h-0 gap-px bg-[var(--line-soft)] xl:grid-rows-[auto_minmax(0,1fr)_280px]">
            <div
              className="bg-[var(--surface-0)]"
              data-testid="editor-tabs-region"
            >
              <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[var(--accent-strong)]" />
                  <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--ink-3)]">
                    Workspace
                  </h2>
                </div>
                <span className="text-xs text-[var(--ink-3)]">Tabs staged for Monaco</span>
              </div>
              <div className="flex flex-wrap gap-2 px-4 py-4">
                {placeholderTabs.map((tab, index) => (
                  <div
                    className={`border px-3 py-2 text-sm ${
                      index === 0
                        ? 'border-[var(--line-strong)] bg-[var(--surface-1)] text-[var(--ink-1)]'
                        : 'border-[var(--line-soft)] bg-transparent text-[var(--ink-3)]'
                    }`}
                    key={tab}
                  >
                    {tab}
                  </div>
                ))}
              </div>
            </div>

            <section
              className="grid min-h-0 gap-px bg-[var(--line-soft)] xl:grid-cols-[minmax(0,1fr)_360px]"
              data-testid="editor-region"
            >
              <div className="min-h-[300px] bg-[var(--surface-1)] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-3)]">Editor Surface</p>
                    <h3 className="mt-2 font-display text-2xl">A quiet shell for the real SQL workspace.</h3>
                  </div>
                  <ArrowUpRight className="h-5 w-5 text-[var(--accent-strong)]" />
                </div>
                <div className="mt-6 grid h-[calc(100%-5rem)] min-h-[260px] gap-4 md:grid-cols-[1fr_220px]">
                  <div className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
                    <pre className="h-full whitespace-pre-wrap font-mono text-sm leading-6 text-[var(--ink-2)]">
                      {`-- Phase 1 intentionally keeps the editor mocked.\n-- The important part is the shell boundary:\n-- UI triggers typed commands\n-- Rust owns background work\n-- Events stream back without freezing the interface`}
                    </pre>
                  </div>
                  <div className="space-y-3 border border-[var(--line-soft)] bg-[var(--surface-0)] p-4 text-sm text-[var(--ink-2)]">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Counts</p>
                      <p className="mt-2">History records: {bootstrap?.sampleData.historyEntries ?? 0}</p>
                      <p>Saved queries: {bootstrap?.sampleData.savedQueries ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Contract rule</p>
                      <p className="mt-2">Every boundary payload has a fixture and a runtime guard.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-h-[300px] bg-[var(--surface-0)]">{children}</div>
            </section>

            <section
              className="bg-[var(--surface-1)]"
              data-testid="results-region"
            >
              <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <PanelBottom className="h-4 w-4 text-[var(--accent-strong)]" />
                  <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-[var(--ink-3)]">
                    Results + Event Stream
                  </h2>
                </div>
                <span className="text-xs text-[var(--ink-3)]">Most recent first</span>
              </div>
              <div className="grid gap-4 p-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                <div className="border border-[var(--line-soft)] bg-[var(--surface-0)] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-3)]">Run state</p>
                  <div className="mt-3 text-sm text-[var(--ink-2)]">
                    <p>{isRunning ? 'Mock job running.' : 'No active job.'}</p>
                    <p className="mt-2">Captured events: {deferredRecentEvents.length}</p>
                    <p className="mt-2">Latest error: {error?.message ?? 'none'}</p>
                  </div>
                </div>
                <ol className="grid gap-2">
                  {deferredRecentEvents.length > 0 ? (
                    deferredRecentEvents.map((event) => (
                      <li
                        className="grid gap-1 border border-[var(--line-soft)] bg-[var(--surface-0)] p-3 text-sm text-[var(--ink-2)]"
                        key={`${event.jobId}-${event.timestamp}-${event.step}-${event.status}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[var(--ink-1)]">{event.message}</span>
                          <span className="uppercase tracking-[0.18em] text-[var(--ink-3)]">{event.status}</span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-[var(--ink-3)]">
                          <span>{event.jobId}</span>
                          <span>
                            step {event.step} / {event.totalSteps}
                          </span>
                          <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="border border-dashed border-[var(--line-soft)] bg-[var(--surface-0)] p-4 text-sm text-[var(--ink-2)]">
                      Run the deterministic job to populate the Phase 1 event stream.
                    </li>
                  )}
                </ol>
              </div>
            </section>
          </section>
        </div>

        <footer
          className="flex flex-col gap-2 border-t border-[var(--line-soft)] bg-[var(--surface-0)] px-4 py-3 text-xs uppercase tracking-[0.18em] text-[var(--ink-3)] md:flex-row md:items-center md:justify-between"
          data-testid="status-region"
        >
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4" />
            <span>{import.meta.env.DEV ? 'Development diagnostics visible' : 'Production shell'}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            <span>IPC typed</span>
            <span>SQLite ready</span>
            <span>Logs correlated</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
