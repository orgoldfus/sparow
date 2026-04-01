import {
  useCallback,
  startTransition,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ConnectionWorkspaceState } from '../connections/useConnectionWorkspace';
import { deriveTabTitle } from '../query/sqlStatement';
import type { QueryExecutionIntent, QueryWorkspaceState } from '../query/useQueryWorkspace';
import type { ShellFocusZone } from './useShellFocusRegistry';
import type { CommandPaletteItem, QueryLibraryTab, SaveQueryDialogState } from './types';
import type { AppError, HistoryEntry, SavedQuery } from '../../lib/contracts';
import {
  deleteSavedQuery,
  listQueryHistory,
  listSavedQueries,
  saveSavedQuery,
} from '../../lib/ipc';
import { logger } from '../../lib/logger';

const LIBRARY_LIMIT = 24;
const PALETTE_LIMIT = 6;
const SEARCH_DEBOUNCE_MS = 150;
type SearchTarget = 'library' | 'palette';

type UseProductivityWorkspaceArgs = {
  connectionWorkspace: ConnectionWorkspaceState;
  focusTarget: (zone: ShellFocusZone) => void;
  onError: (error: AppError) => void;
  queryWorkspace: QueryWorkspaceState;
};

type PendingRunRequest = {
  connectionId: string | null;
  sql: string;
  tabId: string;
};

export function useProductivityWorkspace({
  connectionWorkspace,
  focusTarget,
  onError,
  queryWorkspace,
}: UseProductivityWorkspaceArgs) {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteSearchQuery, setCommandPaletteSearchQuery] = useState('');
  const [paletteHistoryEntries, setPaletteHistoryEntries] = useState<HistoryEntry[]>([]);
  const [paletteSavedQueries, setPaletteSavedQueries] = useState<SavedQuery[]>([]);
  const [isPaletteLoading, setIsPaletteLoading] = useState(false);
  const [isQueryLibraryOpen, setIsQueryLibraryOpen] = useState(false);
  const [queryLibraryTab, setQueryLibraryTab] = useState<QueryLibraryTab>('history');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyConnectionId, setHistoryConnectionId] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savedQueriesSearchQuery, setSavedQueriesSearchQuery] = useState('');
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [savedQueriesHasMore, setSavedQueriesHasMore] = useState(false);
  const [savedQueriesLoading, setSavedQueriesLoading] = useState(false);
  const [saveDialogState, setSaveDialogState] = useState<SaveQueryDialogState | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isSavePending, setIsSavePending] = useState(false);
  const [deletingSavedQueryId, setDeletingSavedQueryId] = useState<string | null>(null);
  const [pendingRunRequest, setPendingRunRequest] = useState<PendingRunRequest | null>(null);
  const [savedQueryCache, setSavedQueryCache] = useState<Record<string, SavedQuery>>({});
  const historyRequestIdsRef = useRef<Record<SearchTarget, number>>({ library: 0, palette: 0 });
  const savedQueryRequestIdsRef = useRef<Record<SearchTarget, number>>({ library: 0, palette: 0 });

  const activeTab = queryWorkspace.activeTab;

  const rememberSavedQueries = useCallback((entries: SavedQuery[]) => {
    if (entries.length === 0) {
      return;
    }

    startTransition(() => {
      setSavedQueryCache((current) => {
        const next = { ...current };
        for (const entry of entries) {
          next[entry.id] = entry;
        }
        return next;
      });
    });
  }, []);

  const loadHistoryEntries = useCallback(async (params: {
    connectionId: string | null;
    limit: number;
    offset: number;
    searchQuery: string;
    target: SearchTarget;
  }) => {
    const requestId = historyRequestIdsRef.current[params.target] + 1;
    historyRequestIdsRef.current[params.target] = requestId;
    const result = await listQueryHistory({
      connectionId: params.connectionId,
      limit: params.limit,
      offset: params.offset,
      searchQuery: params.searchQuery,
    });

    if (historyRequestIdsRef.current[params.target] !== requestId) {
      return;
    }

    startTransition(() => {
      if (params.target === 'library') {
        setHistoryEntries(result.entries);
        setHistoryHasMore(result.hasMore);
        return;
      }

      setPaletteHistoryEntries(result.entries);
    });
  }, []);

  const loadSavedQueries = useCallback(async (params: {
    connectionId: string | null;
    limit: number;
    offset: number;
    searchQuery: string;
    target: SearchTarget;
  }) => {
    const requestId = savedQueryRequestIdsRef.current[params.target] + 1;
    savedQueryRequestIdsRef.current[params.target] = requestId;
    const result = await listSavedQueries({
      connectionId: params.connectionId,
      limit: params.limit,
      offset: params.offset,
      searchQuery: params.searchQuery,
    });

    if (savedQueryRequestIdsRef.current[params.target] !== requestId) {
      return;
    }

    rememberSavedQueries(result.entries);

    startTransition(() => {
      if (params.target === 'library') {
        setSavedQueries(result.entries);
        setSavedQueriesHasMore(result.hasMore);
        return;
      }

      setPaletteSavedQueries(result.entries);
    });
  }, [rememberSavedQueries]);

  useEffect(() => {
    if (!isQueryLibraryOpen || queryLibraryTab !== 'history') {
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);

    const timeout = window.setTimeout(() => {
      loadHistoryEntries({
        connectionId: historyConnectionId,
        limit: LIBRARY_LIMIT,
        offset: 0,
        searchQuery: historySearchQuery.trim(),
        target: 'library',
      })
        .catch((caught) => {
          if (!cancelled) {
            onError(logger.asAppError(caught, 'list_query_history'));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setHistoryLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [historyConnectionId, historySearchQuery, isQueryLibraryOpen, loadHistoryEntries, onError, queryLibraryTab]);

  useEffect(() => {
    if (!isQueryLibraryOpen || queryLibraryTab !== 'saved') {
      return;
    }

    let cancelled = false;
    setSavedQueriesLoading(true);

    const timeout = window.setTimeout(() => {
      loadSavedQueries({
        connectionId: null,
        limit: LIBRARY_LIMIT,
        offset: 0,
        searchQuery: savedQueriesSearchQuery.trim(),
        target: 'library',
      })
        .catch((caught) => {
          if (!cancelled) {
            onError(logger.asAppError(caught, 'list_saved_queries'));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSavedQueriesLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [isQueryLibraryOpen, loadSavedQueries, onError, queryLibraryTab, savedQueriesSearchQuery]);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      return;
    }

    let cancelled = false;
    setIsPaletteLoading(true);

    const timeout = window.setTimeout(() => {
      Promise.all([
        loadHistoryEntries({
          connectionId: null,
          limit: PALETTE_LIMIT,
          offset: 0,
          searchQuery: commandPaletteSearchQuery.trim(),
          target: 'palette',
        }),
        loadSavedQueries({
          connectionId: null,
          limit: PALETTE_LIMIT,
          offset: 0,
          searchQuery: commandPaletteSearchQuery.trim(),
          target: 'palette',
        }),
      ])
        .catch((caught) => {
          if (!cancelled) {
            onError(logger.asAppError(caught, 'load_command_palette'));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsPaletteLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [commandPaletteSearchQuery, isCommandPaletteOpen, loadHistoryEntries, loadSavedQueries, onError]);

  const handleRunQueryFailure = useCallback((caught: unknown) => {
    setPendingRunRequest(null);
    onError(logger.asAppError(caught, 'run_productivity_query'));
  }, [onError]);

  useEffect(() => {
    if (!pendingRunRequest) {
      return;
    }

    if (
      pendingRunRequest.connectionId &&
      connectionWorkspace.activeSession?.connectionId !== pendingRunRequest.connectionId
    ) {
      if (connectionWorkspace.connectingConnectionId === null) {
        setPendingRunRequest(null);
      }
      return;
    }

    const readyRequest = pendingRunRequest;
    setPendingRunRequest(null);

    void queryWorkspace
      .startTabQuery(readyRequest.tabId, buildExecutionIntent(readyRequest.sql))
      .catch(handleRunQueryFailure);
  }, [
    connectionWorkspace.activeSession?.connectionId,
    connectionWorkspace.connectingConnectionId,
    handleRunQueryFailure,
    pendingRunRequest,
    queryWorkspace,
  ]);

  async function refreshSavedQueryViews() {
    try {
      await Promise.all([
        isQueryLibraryOpen && queryLibraryTab === 'saved'
          ? loadSavedQueries({
              connectionId: null,
              limit: LIBRARY_LIMIT,
              offset: 0,
              searchQuery: savedQueriesSearchQuery.trim(),
              target: 'library',
            })
          : Promise.resolve(),
        isCommandPaletteOpen
          ? loadSavedQueries({
              connectionId: null,
              limit: PALETTE_LIMIT,
              offset: 0,
              searchQuery: commandPaletteSearchQuery.trim(),
              target: 'palette',
            })
          : Promise.resolve(),
      ]);
    } catch (caught) {
      onError(logger.asAppError(caught, 'refresh_saved_queries'));
    }
  }

  function closeTransientOverlays() {
    setIsCommandPaletteOpen(false);
    setIsQueryLibraryOpen(false);
  }

  function closeTopOverlay() {
    if (isSaveDialogOpen) {
      setIsSaveDialogOpen(false);
      return;
    }

    if (isQueryLibraryOpen) {
      setIsQueryLibraryOpen(false);
      return;
    }

    if (isCommandPaletteOpen) {
      setIsCommandPaletteOpen(false);
    }
  }

  function openCommandPalette() {
    setCommandPaletteSearchQuery('');
    setIsCommandPaletteOpen(true);
  }

  function openQueryLibrary(nextTab: QueryLibraryTab = 'history') {
    setQueryLibraryTab(nextTab);
    setIsQueryLibraryOpen(true);
    setIsCommandPaletteOpen(false);
  }

  function openSaveDialog(state: SaveQueryDialogState) {
    setSaveDialogState(state);
    setIsSaveDialogOpen(true);
    setIsCommandPaletteOpen(false);
  }

  function openSaveDialogForActiveTab() {
    if (!activeTab) {
      return;
    }

    const existingSavedQuery = activeTab.savedQueryId ? savedQueryCache[activeTab.savedQueryId] ?? null : null;
    const canUpdateExisting = activeTab.savedQueryId !== null && existingSavedQuery !== null;
    openSaveDialog({
      tabId: activeTab.id,
      existingId: canUpdateExisting ? activeTab.savedQueryId : null,
      title: existingSavedQuery?.title ?? activeTab.title,
      sql: activeTab.sql,
      tagsText: existingSavedQuery?.tags.join(', ') ?? '',
      hasExplicitConnectionProfileId: canUpdateExisting || activeTab.targetConnectionId !== null,
      connectionProfileId: existingSavedQuery
        ? existingSavedQuery.connectionProfileId
        : activeTab.targetConnectionId ??
          connectionWorkspace.activeSession?.connectionId ??
          connectionWorkspace.selectedConnectionId ??
          connectionWorkspace.connections[0]?.id ??
          null,
      mode: canUpdateExisting ? 'update' : 'create',
      sourceLabel: canUpdateExisting
        ? `Current tab linked to "${existingSavedQuery?.title ?? activeTab.title}"`
        : `Current tab: ${activeTab.title}`,
      allowSaveAsNew: canUpdateExisting,
    });
  }

  function openSaveDialogForHistoryEntry(entry: HistoryEntry) {
    openSaveDialog({
      tabId: null,
      existingId: null,
      title: deriveTabTitle(entry.sql),
      sql: entry.sql,
      tagsText: '',
      hasExplicitConnectionProfileId: true,
      connectionProfileId: entry.connectionProfileId,
      mode: 'create',
      sourceLabel: `History entry from ${formatSourceTimestamp(entry.createdAt)}`,
      allowSaveAsNew: false,
    });
  }

  function openSaveDialogForSavedQuery(savedQuery: SavedQuery) {
    openSaveDialog({
      tabId: null,
      existingId: savedQuery.id,
      title: savedQuery.title,
      sql: savedQuery.sql,
      tagsText: savedQuery.tags.join(', '),
      hasExplicitConnectionProfileId: true,
      connectionProfileId: savedQuery.connectionProfileId,
      mode: 'update',
      sourceLabel: `Saved query: ${savedQuery.title}`,
      allowSaveAsNew: true,
    });
  }

  async function submitSaveDialog(modeOverride?: 'create' | 'update') {
    const draft = saveDialogState;
    if (!draft) {
      return;
    }

    setIsSavePending(true);

    try {
      const tabConnectionId = draft.tabId
        ? queryWorkspace.tabs.find((tab) => tab.id === draft.tabId)?.targetConnectionId ?? null
        : null;
      const savedQuery = await saveSavedQuery({
        id: modeOverride === 'create' ? null : draft.existingId,
        title: draft.title.trim(),
        sql: draft.sql,
        tags: splitTags(draft.tagsText),
        connectionProfileId: draft.hasExplicitConnectionProfileId
          ? draft.connectionProfileId
          : tabConnectionId ??
            connectionWorkspace.activeSession?.connectionId ??
            connectionWorkspace.selectedConnectionId ??
            connectionWorkspace.connections[0]?.id ??
            null,
      });

      rememberSavedQueries([savedQuery]);

      if (draft.tabId) {
        queryWorkspace.updateTabMetadata(draft.tabId, {
          savedQueryId: savedQuery.id,
          targetConnectionId: savedQuery.connectionProfileId,
          title: savedQuery.title,
        });
      }

      for (const tab of queryWorkspace.tabs) {
        if (tab.savedQueryId === savedQuery.id) {
          queryWorkspace.updateTabMetadata(tab.id, {
            savedQueryId: savedQuery.id,
            targetConnectionId: savedQuery.connectionProfileId,
            title: savedQuery.title,
          });
        }
      }

      setIsSaveDialogOpen(false);
      setSaveDialogState(null);
      await refreshSavedQueryViews();
    } catch (caught) {
      onError(logger.asAppError(caught, 'save_saved_query'));
    } finally {
      setIsSavePending(false);
    }
  }

  async function deleteSavedQueryEntry(savedQuery: SavedQuery) {
    setDeletingSavedQueryId(savedQuery.id);

    try {
      await deleteSavedQuery(savedQuery.id);
      startTransition(() => {
        setSavedQueryCache((current) => {
          const next = { ...current };
          delete next[savedQuery.id];
          return next;
        });
      });

      for (const tab of queryWorkspace.tabs) {
        if (tab.savedQueryId === savedQuery.id) {
          queryWorkspace.updateTabMetadata(tab.id, {
            savedQueryId: null,
          });
        }
      }

      if (saveDialogState?.existingId === savedQuery.id) {
        setIsSaveDialogOpen(false);
        setSaveDialogState(null);
      }

      await refreshSavedQueryViews();
    } catch (caught) {
      onError(logger.asAppError(caught, 'delete_saved_query'));
    } finally {
      setDeletingSavedQueryId(null);
    }
  }

  function openHistoryEntry(entry: HistoryEntry) {
    closeTransientOverlays();
    queryWorkspace.openQueryTab({
      sql: entry.sql,
      targetConnectionId: entry.connectionProfileId,
    });
  }

  function openSavedQueryEntry(savedQuery: SavedQuery) {
    closeTransientOverlays();
    queryWorkspace.openQueryTab({
      sql: savedQuery.sql,
      title: savedQuery.title,
      targetConnectionId: savedQuery.connectionProfileId,
      savedQueryId: savedQuery.id,
    });
  }

  async function runQueryInNewTab(entry: {
    connectionId: string | null;
    savedQueryId?: string | null;
    sql: string;
    title?: string | null;
  }) {
    closeTransientOverlays();
    const tabId = queryWorkspace.openQueryTab({
      sql: entry.sql,
      title: entry.title ?? null,
      targetConnectionId: entry.connectionId,
      savedQueryId: entry.savedQueryId ?? null,
    });
    await runQueryForTab(tabId, entry.sql, entry.connectionId);
  }

  async function runQueryForTab(tabId: string, sql: string, connectionId: string | null) {
    try {
      if (connectionId && connectionWorkspace.activeSession?.connectionId !== connectionId) {
        connectionWorkspace.selectConnection(connectionId);
        setPendingRunRequest({
          connectionId,
          sql,
          tabId,
        });
        await connectionWorkspace.activateConnection(connectionId);
        return;
      }

      await queryWorkspace.startTabQuery(tabId, buildExecutionIntent(sql));
    } catch (caught) {
      handleRunQueryFailure(caught);
    }
  }

  const query = commandPaletteSearchQuery.trim().toLowerCase();
  const staticItems = buildStaticPaletteItems({
    activeTab,
    onCancelCurrentQuery: () => {
      if (!activeTab) {
        return;
      }
      void queryWorkspace.cancelTabQuery(activeTab.id);
      setIsCommandPaletteOpen(false);
    },
    onFocus: (zone) => {
      focusTarget(zone);
      setIsCommandPaletteOpen(false);
    },
    onNewTab: () => {
      queryWorkspace.createTab();
      setIsCommandPaletteOpen(false);
    },
    onOpenQueryLibrary: () => {
      openQueryLibrary('saved');
    },
    onRunCurrentQuery: () => {
      if (!activeTab) {
        return;
      }
      void runQueryForTab(activeTab.id, activeTab.sql, activeTab.targetConnectionId);
      setIsCommandPaletteOpen(false);
    },
    onSaveQuery: () => {
      openSaveDialogForActiveTab();
    },
  }).filter((item) => matchesPaletteQuery(item, query));

  const savedQueryItems = paletteSavedQueries.map<CommandPaletteItem>((savedQuery) => ({
    id: `saved-${savedQuery.id}`,
    group: 'Saved Queries',
    title: savedQuery.title,
    subtitle: previewSql(savedQuery.sql),
    detail: connectionNameFor(savedQuery.connectionProfileId, connectionWorkspace.connections),
    onSelect: () => {
      void runQueryInNewTab({
        connectionId: savedQuery.connectionProfileId,
        savedQueryId: savedQuery.id,
        sql: savedQuery.sql,
        title: savedQuery.title,
      });
    },
  }));

  const historyItems = paletteHistoryEntries.map<CommandPaletteItem>((entry) => ({
    id: `history-${entry.id}`,
    group: 'History',
    title: deriveTabTitle(entry.sql),
    subtitle: previewSql(entry.sql),
    detail: `${connectionNameFor(entry.connectionProfileId, connectionWorkspace.connections)} · ${formatSourceTimestamp(entry.createdAt)}`,
    onSelect: () => {
      void runQueryInNewTab({
        connectionId: entry.connectionProfileId,
        sql: entry.sql,
      });
    },
  }));

  const commandPaletteItems = [...staticItems, ...savedQueryItems, ...historyItems];

  return {
    commandPaletteItems,
    commandPaletteSearchQuery,
    closeTopOverlay,
    deleteSavedQueryEntry,
    deletingSavedQueryId,
    historyConnectionId,
    historyEntries,
    historyHasMore,
    historyLoading,
    historySearchQuery,
    isCommandPaletteOpen,
    isPaletteLoading,
    isQueryLibraryOpen,
    isSaveDialogOpen,
    isSavePending,
    openCommandPalette,
    openHistoryEntry,
    openQueryLibrary,
    openSaveDialogForActiveTab,
    openSaveDialogForHistoryEntry,
    openSaveDialogForSavedQuery,
    openSavedQueryEntry,
    queryLibraryTab,
    saveDialogState,
    savedQueries,
    savedQueriesHasMore,
    savedQueriesLoading,
    savedQueriesSearchQuery,
    setCommandPaletteSearchQuery,
    setHistoryConnectionId,
    setHistorySearchQuery,
    setIsCommandPaletteOpen,
    setIsQueryLibraryOpen,
    setIsSaveDialogOpen,
    setQueryLibraryTab,
    setSavedQueriesSearchQuery,
    setSaveDialogState,
    submitSaveDialog,
    runHistoryEntry: async (entry: HistoryEntry) => {
      await runQueryInNewTab({
        connectionId: entry.connectionProfileId,
        sql: entry.sql,
      });
    },
    runSavedQueryEntry: async (savedQuery: SavedQuery) => {
      await runQueryInNewTab({
        connectionId: savedQuery.connectionProfileId,
        savedQueryId: savedQuery.id,
        sql: savedQuery.sql,
        title: savedQuery.title,
      });
    },
  };
}

function buildExecutionIntent(sql: string): QueryExecutionIntent {
  return {
    sql,
    origin: 'current-statement',
    isSelectionMultiStatement: false,
  };
}

function buildStaticPaletteItems({
  activeTab,
  onCancelCurrentQuery,
  onFocus,
  onNewTab,
  onOpenQueryLibrary,
  onRunCurrentQuery,
  onSaveQuery,
}: {
  activeTab: QueryWorkspaceState['activeTab'];
  onCancelCurrentQuery: () => void;
  onFocus: (zone: ShellFocusZone) => void;
  onNewTab: () => void;
  onOpenQueryLibrary: () => void;
  onRunCurrentQuery: () => void;
  onSaveQuery: () => void;
}): CommandPaletteItem[] {
  return [
    {
      id: 'action-new-tab',
      group: 'Actions',
      title: 'New query tab',
      subtitle: 'Open a fresh SQL editor tab without replacing the current one.',
      shortcut: 'Mod+N',
      onSelect: onNewTab,
    },
    {
      id: 'action-save-query',
      group: 'Actions',
      title: 'Save query',
      subtitle: 'Save the active tab as a reusable query definition.',
      shortcut: 'Mod+S',
      onSelect: onSaveQuery,
    },
    {
      id: 'action-query-library',
      group: 'Actions',
      title: 'Open query library',
      subtitle: 'Browse recent SQL and saved query definitions.',
      onSelect: onOpenQueryLibrary,
    },
    {
      id: 'action-focus-connections',
      group: 'Actions',
      title: 'Focus connections',
      subtitle: 'Move keyboard focus to the saved-connections rail.',
      shortcut: 'Mod+1',
      onSelect: () => {
        onFocus('connections');
      },
    },
    {
      id: 'action-focus-schema',
      group: 'Actions',
      title: 'Focus schema',
      subtitle: 'Move keyboard focus to the schema browser.',
      shortcut: 'Mod+2',
      onSelect: () => {
        onFocus('schema');
      },
    },
    {
      id: 'action-focus-editor',
      group: 'Actions',
      title: 'Focus editor',
      subtitle: 'Move keyboard focus to the SQL editor.',
      shortcut: 'Mod+3',
      onSelect: () => {
        onFocus('editor');
      },
    },
    {
      id: 'action-focus-results',
      group: 'Actions',
      title: 'Focus results',
      subtitle: 'Move keyboard focus to the result viewer filter.',
      shortcut: 'Mod+4',
      onSelect: () => {
        onFocus('results');
      },
    },
    {
      id: 'action-run-current-query',
      group: 'Actions',
      title: 'Run current query',
      subtitle: activeTab ? `Run the SQL from ${activeTab.title}.` : 'No active query tab is open.',
      onSelect: onRunCurrentQuery,
    },
    {
      id: 'action-cancel-current-query',
      group: 'Actions',
      title: 'Cancel current query',
      subtitle: activeTab?.execution.jobId
        ? 'Request cancellation for the active query job.'
        : 'No active query is currently running.',
      onSelect: onCancelCurrentQuery,
    },
  ];
}

function connectionNameFor(connectionId: string | null, connections: ConnectionWorkspaceState['connections']) {
  if (!connectionId) {
    return 'No default connection';
  }

  return connections.find((connection) => connection.id === connectionId)?.name ?? 'Missing connection';
}

function formatSourceTimestamp(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function matchesPaletteQuery(item: CommandPaletteItem, query: string) {
  if (query.length === 0) {
    return true;
  }

  const haystack = [item.title, item.subtitle, item.detail ?? '', item.shortcut ?? '']
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function previewSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

function splitTags(value: string) {
  const tags = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(tags));
}
