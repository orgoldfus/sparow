import type { ReactNode } from 'react';

const SHELL_COLUMNS_CLASS = 'lg:grid-cols-[clamp(360px,34vw,460px)_minmax(0,1fr)]';

type AppShellProps = {
  connectionDialog: ReactNode;
  diagnosticsDialog: ReactNode;
  editor: ReactNode;
  editorTabs: ReactNode;
  headerBar: ReactNode;
  isLoading: boolean;
  leftSidebar: ReactNode;
  results: ReactNode;
  statusBar: ReactNode;
};

export function AppShell({
  connectionDialog,
  diagnosticsDialog,
  editor,
  editorTabs,
  headerBar,
  isLoading,
  leftSidebar,
  results,
  statusBar,
}: AppShellProps) {
  return (
    <main className="h-dvh overflow-hidden bg-[var(--surface-app)] text-[var(--text-primary)]">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header
          className="shrink-0 border-b border-[var(--border-subtle)] bg-[linear-gradient(180deg,_color-mix(in_oklch,_var(--surface-panel)_78%,_black_22%),_color-mix(in_oklch,_var(--surface-panel)_88%,_black_12%))]"
          data-testid="app-header"
        >
          {headerBar}
          {isLoading ? (
            <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--text-muted)] sm:px-5">
              Booting shell…
            </div>
          ) : null}
        </header>

        <div className={`grid min-h-0 flex-1 bg-[var(--border-subtle)] ${SHELL_COLUMNS_CLASS}`}>
          <aside
            className="min-h-0 overflow-hidden bg-[linear-gradient(180deg,_color-mix(in_oklch,_var(--surface-sidebar)_92%,_black_8%),_color-mix(in_oklch,_var(--surface-sidebar)_84%,_black_16%))]"
            data-testid="connections-region"
          >
            {leftSidebar}
          </aside>

          <section
            className="grid min-h-0 overflow-hidden bg-[var(--border-subtle)]"
            style={{ gridTemplateRows: editorTabs ? 'auto minmax(300px, 1.18fr) minmax(250px, 0.92fr)' : 'minmax(300px, 1.18fr) minmax(250px, 0.92fr)' }}
          >
            {editorTabs ? (
              <div className="min-h-0 overflow-hidden bg-[var(--surface-panel)]" data-testid="editor-tabs-region">
                {editorTabs}
              </div>
            ) : (
              <div className="hidden" data-testid="editor-tabs-region" />
            )}

            <div className="min-h-0 overflow-hidden bg-[var(--surface-editor)]" data-testid="editor-region">
              {editor}
            </div>

            <div className="min-h-0 overflow-hidden border-t border-[var(--border-subtle)] bg-[var(--surface-panel)]" data-testid="results-region">
              {results}
            </div>
          </section>
        </div>

        <footer
          className="shrink-0 border-t border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_90%,_black_10%)]"
          data-testid="status-region"
        >
          {statusBar}
        </footer>
      </div>

      {connectionDialog}
      {diagnosticsDialog}
    </main>
  );
}
