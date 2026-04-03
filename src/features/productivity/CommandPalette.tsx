import { Command, CornerDownLeft, FileClock, FolderOpenDot, LibraryBig, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import { cn } from '../../lib/utils';
import type { CommandPaletteItem } from './types';

type CommandPaletteProps = {
  items: CommandPaletteItem[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSearchQueryChange: (value: string) => void;
  open: boolean;
  searchQuery: string;
};

export function CommandPalette({
  items,
  loading,
  onOpenChange,
  onSearchQueryChange,
  open,
  searchQuery,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const groupedItems = useMemo(() => groupPaletteItems(items), [items]);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [open]);

  const boundedHighlightedIndex = Math.min(highlightedIndex, Math.max(items.length - 1, 0));

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setHighlightedIndex(0);
    }
    onOpenChange(nextOpen);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlightedIndex((current) => Math.min(current + 1, Math.max(items.length - 1, 0)));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlightedIndex((current) => Math.max(current - 1, 0));
        break;
      case 'Enter':
        if (items.length === 0) {
          return;
        }

        event.preventDefault();
        items[boundedHighlightedIndex]?.onSelect();
        break;
      case 'Escape':
        event.preventDefault();
        onOpenChange(false);
        break;
      default:
        break;
    }
  }

  let itemIndex = -1;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-3xl overflow-hidden p-0" data-testid="command-palette-dialog" showClose>
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Open queries, run actions, and jump between shell focus zones.</DialogDescription>
        </DialogHeader>

        <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_88%,_black_12%)] px-4 py-4">
          <label className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-3">
            <Command className="h-4 w-4 text-[var(--accent-text)]" />
            <Input
              aria-label="Search commands"
              autoComplete="off"
              className="h-auto border-none bg-transparent px-0 py-0 text-base shadow-none focus:border-none focus:ring-0"
              data-testid="command-palette-input"
              onChange={(event) => {
                setHighlightedIndex(0);
                onSearchQueryChange(event.currentTarget.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a command, saved query, or recent SQL"
              ref={inputRef}
              value={searchQuery}
            />
          </label>
        </div>

        <ScrollArea className="max-h-[70vh]">
          <div className="grid gap-4 px-3 py-3">
            {groupedItems.length > 0 ? (
              groupedItems.map((group) => (
                <section className="grid gap-2" key={group.label}>
                  <div className="flex items-center gap-2 px-2 text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
                    {iconForGroup(group.label)}
                    <span>{group.label}</span>
                  </div>
                  <div className="grid gap-1">
                    {group.items.map((item) => {
                      itemIndex += 1;
                      const currentItemIndex = itemIndex;
                      const isHighlighted = currentItemIndex === boundedHighlightedIndex;

                      return (
                        <button
                          className={cn(
                            'grid gap-1 rounded-2xl border px-3 py-3 text-left transition',
                            isHighlighted
                              ? 'border-[var(--border-accent)] bg-[color-mix(in_oklch,_var(--surface-highlight)_82%,_black_18%)]'
                              : 'border-transparent bg-[var(--surface-panel)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-panel-hover)]',
                          )}
                          data-testid={`command-palette-item-${item.id}`}
                          key={item.id}
                          onClick={() => {
                            item.onSelect();
                          }}
                          onMouseEnter={() => {
                            setHighlightedIndex(currentItemIndex);
                          }}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-[var(--text-primary)]">{item.title}</p>
                            {item.shortcut ? (
                              <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
                                {item.shortcut}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-sm text-[var(--text-secondary)]">{item.subtitle}</p>
                          {item.detail ? (
                            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                              <CornerDownLeft className="h-3.5 w-3.5" />
                              <span>{item.detail}</span>
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-panel)] px-4 py-6 text-sm text-[var(--text-secondary)]">
                {loading ? 'Searching saved queries and recent SQL...' : 'No matching actions or query entries.'}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function groupPaletteItems(items: CommandPaletteItem[]) {
  const groups = new Map<CommandPaletteItem['group'], CommandPaletteItem[]>();

  for (const item of items) {
    const existing = groups.get(item.group) ?? [];
    existing.push(item);
    groups.set(item.group, existing);
  }

  return Array.from(groups.entries()).map(([label, groupedItems]) => ({
    label,
    items: groupedItems,
  }));
}

function iconForGroup(group: CommandPaletteItem['group']) {
  switch (group) {
    case 'Actions':
      return <Search className="h-3.5 w-3.5" />;
    case 'Saved Queries':
      return <LibraryBig className="h-3.5 w-3.5" />;
    case 'History':
      return <FileClock className="h-3.5 w-3.5" />;
    default:
      return <FolderOpenDot className="h-3.5 w-3.5" />;
  }
}
