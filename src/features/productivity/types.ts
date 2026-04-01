import type { ConnectionSummary, HistoryEntry, SavedQuery } from '../../lib/contracts';

export type QueryLibraryTab = 'history' | 'saved';
export type SaveQueryDialogMode = 'create' | 'update';

export type SaveQueryDialogState = {
  tabId: string | null;
  existingId: string | null;
  title: string;
  sql: string;
  tagsText: string;
  connectionProfileId: string | null;
  hasExplicitConnectionProfileId: boolean;
  mode: SaveQueryDialogMode;
  sourceLabel: string;
  allowSaveAsNew: boolean;
};

export type CommandPaletteItem = {
  id: string;
  group: 'Actions' | 'Saved Queries' | 'History';
  title: string;
  subtitle: string;
  detail?: string | null;
  shortcut?: string | null;
  onSelect: () => void;
};

export type QueryLibraryProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: QueryLibraryTab;
  onActiveTabChange: (tab: QueryLibraryTab) => void;
  connections: ConnectionSummary[];
  historyEntries: HistoryEntry[];
  historyHasMore: boolean;
  historyLoading: boolean;
  historySearchQuery: string;
  historyConnectionId: string | null;
  onHistorySearchQueryChange: (value: string) => void;
  onHistoryConnectionIdChange: (connectionId: string | null) => void;
  onOpenHistoryEntry: (entry: HistoryEntry) => void;
  onRunHistoryEntry: (entry: HistoryEntry) => void;
  onSaveHistoryEntry: (entry: HistoryEntry) => void;
  savedQueries: SavedQuery[];
  savedQueriesHasMore: boolean;
  savedQueriesLoading: boolean;
  savedQueriesSearchQuery: string;
  onSavedQueriesSearchQueryChange: (value: string) => void;
  onOpenSavedQuery: (savedQuery: SavedQuery) => void;
  onRunSavedQuery: (savedQuery: SavedQuery) => void;
  onEditSavedQuery: (savedQuery: SavedQuery) => void;
  onDeleteSavedQuery: (savedQuery: SavedQuery) => void;
  deletingSavedQueryId: string | null;
};
