import { Command, Database, LoaderCircle, MoonStar } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import { TooltipLabel } from '../../components/ui/tooltip';

type AppShellProps = {
  bootstrapEnvironment: string | null;
  bootstrapPlatform: string | null;
  editor: ReactNode;
  editorTabs: ReactNode;
  isLoading: boolean;
  leftSidebar: ReactNode;
  results: ReactNode;
  statusBar: ReactNode;
  connectionDialog: ReactNode;
  diagnosticsDialog: ReactNode;
};

export function AppShell({
  bootstrapEnvironment,
  bootstrapPlatform,
  editor,
  editorTabs,
  isLoading,
  leftSidebar,
  results,
  statusBar,
  connectionDialog,
  diagnosticsDialog,
}: AppShellProps) {
  return (
    <main className="min-h-screen bg-[var(--surface-app)] px-4 py-4 text-[var(--text-primary)] sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1680px] flex-col overflow-hidden rounded-[28px] border border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-app)_90%,_black_10%)] shadow-[var(--shadow-shell)]">
        <header className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_86%,_black_14%)] px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent-text)]">
              <Database className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold tracking-[0.01em]">Sparow</p>
                <p className="text-[11px] text-[var(--text-muted)]">Query workspace</p>
              </div>
              <Separator className="hidden h-6 md:block" orientation="vertical" />
              <div className="hidden items-center gap-2 md:flex">
                <Badge data-testid="environment-value">{bootstrapEnvironment ?? 'booting'}</Badge>
                <Badge>{bootstrapPlatform ?? 'desktop'}</Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <TooltipLabel content="Command palette lands in a later pass.">
              <Button size="sm" type="button" variant="ghost">
                <Command className="h-3.5 w-3.5" />
                Cmd+K
              </Button>
            </TooltipLabel>
            <Badge className="hidden md:inline-flex" variant="accent">
              <MoonStar className="mr-1.5 h-3.5 w-3.5" />
              Dark by default
            </Badge>
            {isLoading ? (
              <div className="inline-flex items-center gap-2 rounded-md bg-[var(--surface-panel)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Booting shell
              </div>
            ) : null}
          </div>
        </header>

        <div className="grid flex-1 min-h-0 bg-[var(--border-subtle)] lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="min-h-0 bg-[var(--surface-sidebar)]" data-testid="connections-region">
            {leftSidebar}
          </aside>

          <section className="grid min-h-0 gap-px bg-[var(--border-subtle)] grid-rows-[auto_minmax(0,1fr)_320px]">
            <div className="bg-[var(--surface-panel)]" data-testid="editor-tabs-region">
              {editorTabs}
            </div>
            <div className="min-h-0 bg-[var(--surface-editor)]" data-testid="editor-region">
              {editor}
            </div>
            <div className="min-h-0 bg-[var(--surface-panel)]" data-testid="results-region">
              {results}
            </div>
          </section>
        </div>

        <footer
          className="border-t border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_90%,_black_10%)]"
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
