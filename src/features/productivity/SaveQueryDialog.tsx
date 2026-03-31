import { BookmarkPlus, CopyPlus, Database, Tags } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import type { ConnectionSummary } from '../../lib/contracts';
import type { SaveQueryDialogState } from './types';

type SaveQueryDialogProps = {
  connections: ConnectionSummary[];
  draft: SaveQueryDialogState | null;
  onConnectionProfileIdChange: (connectionProfileId: string | null) => void;
  onOpenChange: (open: boolean) => void;
  onSaveAsNew: (() => void) | null;
  onSubmit: () => void;
  onTagsTextChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  open: boolean;
  pending: boolean;
};

export function SaveQueryDialog({
  connections,
  draft,
  onConnectionProfileIdChange,
  onOpenChange,
  onSaveAsNew,
  onSubmit,
  onTagsTextChange,
  onTitleChange,
  open,
  pending,
}: SaveQueryDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl p-0" showClose>
        <DialogHeader className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_88%,_black_12%)] px-6 py-5">
          <DialogTitle>{draft?.mode === 'update' ? 'Update saved query' : 'Save query'}</DialogTitle>
          <DialogDescription>
            Edit metadata only. The SQL text continues to live in the main query editor.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 px-6 py-5" data-testid="save-query-dialog">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            Source: {draft?.sourceLabel ?? 'Current query tab'}
          </div>

          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Title</span>
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3">
              <BookmarkPlus className="h-4 w-4 text-[var(--accent-text)]" />
              <Input
                className="border-none bg-transparent px-0 shadow-none focus:border-none focus:ring-0"
                data-testid="save-query-title-input"
                onChange={(event) => {
                  onTitleChange(event.currentTarget.value);
                }}
                placeholder="Active users by role"
                value={draft?.title ?? ''}
              />
            </div>
          </label>

          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Default connection</span>
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3">
              <Database className="h-4 w-4 text-[var(--text-muted)]" />
              <select
                className="h-11 w-full bg-transparent text-sm text-[var(--text-primary)] outline-none"
                data-testid="save-query-connection-select"
                onChange={(event) => {
                  const nextValue = event.currentTarget.value.trim();
                  onConnectionProfileIdChange(nextValue.length > 0 ? nextValue : null);
                }}
                value={draft?.connectionProfileId ?? ''}
              >
                <option value="">No default connection</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Tags</span>
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3">
              <Tags className="h-4 w-4 text-[var(--text-muted)]" />
              <Input
                className="border-none bg-transparent px-0 shadow-none focus:border-none focus:ring-0"
                data-testid="save-query-tags-input"
                onChange={(event) => {
                  onTagsTextChange(event.currentTarget.value);
                }}
                placeholder="ops, reporting, nightly"
                value={draft?.tagsText ?? ''}
              />
            </div>
          </label>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {draft?.allowSaveAsNew && onSaveAsNew ? (
              <Button
                disabled={pending}
                onClick={onSaveAsNew}
                type="button"
                variant="secondary"
              >
                <CopyPlus className="h-3.5 w-3.5" />
                Save as new
              </Button>
            ) : null}
            <Button disabled={pending} onClick={onSubmit} type="button">
              <BookmarkPlus className="h-3.5 w-3.5" />
              {draft?.mode === 'update' ? 'Update saved query' : 'Save query'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
