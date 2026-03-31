import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import {
  Bug,
  ChevronDown,
  Command,
  Database,
  LibraryBig,
  Settings2,
  UserRound,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { TooltipProvider } from '../../components/ui/tooltip';
import { ConnectionsRail } from '../connections/ConnectionWorkspace';
import { CommandPalette } from '../productivity/CommandPalette';
import { QueryLibraryDialog } from '../productivity/QueryLibraryDialog';
import { SaveQueryDialog } from '../productivity/SaveQueryDialog';
import type { CommandPaletteItem, QueryLibraryTab, SaveQueryDialogState } from '../productivity/types';
import { useShellFocusRegistry } from '../productivity/useShellFocusRegistry';
import { QueryResultsPanel, QueryTabStrip, QueryWorkspace, type QueryResultsView } from '../query/QueryWorkspace';
import type {
  QueryTabState,
  QueryWorkspaceState,
} from '../query/useQueryWorkspace';
import { SchemaSidebar } from '../schema/SchemaWorkspace';
import { AppShell } from './AppShell';
import type {
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryExecutionResult,
  QueryResultCell,
  QueryResultColumn,
  QueryResultFilter,
  QueryResultSetSummary,
  QueryResultSort,
  QueryResultWindow,
  SchemaNode,
  SavedQuery,
  HistoryEntry,
} from '../../lib/contracts';

const connections: ConnectionSummary[] = [
  {
    id: 'conn-production',
    engine: 'postgresql',
    name: 'Production',
    host: 'prod.internal',
    port: 5432,
    database: 'acme_prod',
    username: 'acme_prod',
    sslMode: 'require',
    hasStoredSecret: true,
    secretProvider: 'os-keychain',
    lastTestedAt: '2026-03-11T10:00:00.000Z',
    lastConnectedAt: '2026-03-11T10:12:00.000Z',
    updatedAt: '2026-03-11T10:12:00.000Z',
  },
  {
    id: 'conn-staging',
    engine: 'postgresql',
    name: 'Staging',
    host: 'c9srcab37moub2.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com',
    port: 5432,
    database: 'd5l1u89pljf0v',
    username: 'ufteshubblio40h',
    sslMode: 'prefer',
    hasStoredSecret: true,
    secretProvider: 'os-keychain',
    lastTestedAt: '2026-03-11T10:00:00.000Z',
    lastConnectedAt: '2026-03-11T10:12:00.000Z',
    updatedAt: '2026-03-11T10:12:00.000Z',
  },
  {
    id: 'conn-analytics',
    engine: 'postgresql',
    name: 'Analytics DW',
    host: 'warehouse.internal',
    port: 5432,
    database: 'analytics',
    username: 'analytics_ro',
    sslMode: 'require',
    hasStoredSecret: true,
    secretProvider: 'os-keychain',
    lastTestedAt: '2026-03-11T10:00:00.000Z',
    lastConnectedAt: null,
    updatedAt: '2026-03-11T10:12:00.000Z',
  },
  {
    id: 'conn-local',
    engine: 'postgresql',
    name: 'Local Dev',
    host: '127.0.0.1',
    port: 5432,
    database: 'sparow_dev',
    username: 'sparow',
    sslMode: 'insecure',
    hasStoredSecret: true,
    secretProvider: 'os-keychain',
    lastTestedAt: '2026-03-11T10:00:00.000Z',
    lastConnectedAt: null,
    updatedAt: '2026-03-11T10:12:00.000Z',
  },
];

const columns: QueryResultColumn[] = [
  { name: 'id', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'name', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'email', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'role', postgresType: 'text', semanticType: 'text', isNullable: false },
  { name: 'order_count', postgresType: 'int4', semanticType: 'number', isNullable: false },
  { name: 'lifetime_value', postgresType: 'numeric', semanticType: 'number', isNullable: false },
  { name: 'last_order_at', postgresType: 'timestamptz', semanticType: 'temporal', isNullable: false },
];

const baseRows: QueryResultCell[][] = Array.from({ length: 140 }, (_, index) => [
  `${(index + 1).toString(16).padStart(8, '0')}`,
  ['Sarah Chen', 'Marcus Webb', 'Priya Nair', 'Tom Russo', 'Aiko Tanaka', 'Lena Bauer', 'Carlos Vega', 'Olivia Kim'][index % 8] ?? 'Analyst',
  `person-${String(index + 1).padStart(3, '0')}@acme.com`,
  index % 5 === 0 ? 'admin' : 'user',
  48 - (index % 17),
  `$${(12_840 - index * 48.25).toFixed(2)}`,
  `2026-03-${String(11 - (index % 7)).padStart(2, '0')} 1${index % 9}:2${index % 6}:0${index % 5}`,
]);

const schemaRows = buildSchemaRows();
const harnessSavedQueries = buildHarnessSavedQueries();
const harnessHistoryEntries = buildHarnessHistoryEntries();

export function ShellHarness() {
  const [selectedConnectionId, setSelectedConnectionId] = useState('conn-staging');
  const [activeSession, setActiveSession] = useState<DatabaseSessionSnapshot | null>(() =>
    toSession('conn-staging'),
  );
  const [activeResultsView, setActiveResultsView] = useState<QueryResultsView>('results');
  const [tabs, setTabs] = useState<QueryTabState[]>(() => createInitialTabs('conn-staging'));
  const [activeTabId, setActiveTabId] = useState<string>('tab-lifetime');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSchemaPath, setSelectedSchemaPath] = useState<string | null>('schema/public');
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => harnessSavedQueries);
  const [historyEntries] = useState<HistoryEntry[]>(() => harnessHistoryEntries);
  const [isQueryLibraryOpen, setIsQueryLibraryOpen] = useState(false);
  const [queryLibraryTab, setQueryLibraryTab] = useState<QueryLibraryTab>('saved');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyConnectionId, setHistoryConnectionId] = useState<string | null>(null);
  const [savedQueriesSearchQuery, setSavedQueriesSearchQuery] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteSearchQuery, setCommandPaletteSearchQuery] = useState('');
  const [saveDialogState, setSaveDialogState] = useState<SaveQueryDialogState | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [deletingSavedQueryId, setDeletingSavedQueryId] = useState<string | null>(null);
  const focusRegistry = useShellFocusRegistry();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const schemaSearchResults = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }

    return schemaRows
      .map((row) => row.node)
      .filter((node) => node.name.toLowerCase().includes(trimmed) || node.path.toLowerCase().includes(trimmed))
      .slice(0, 16);
  }, [searchQuery]);
  const filteredHistoryEntries = useMemo(() => {
    const query = historySearchQuery.trim().toLowerCase();
    return historyEntries.filter((entry) => {
      if (historyConnectionId && entry.connectionProfileId !== historyConnectionId) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      return entry.sql.toLowerCase().includes(query);
    });
  }, [historyConnectionId, historyEntries, historySearchQuery]);
  const filteredSavedQueries = useMemo(() => {
    const query = savedQueriesSearchQuery.trim().toLowerCase();
    return savedQueries.filter((savedQuery) => {
      if (query.length === 0) {
        return true;
      }

      return [savedQuery.title, savedQuery.sql, savedQuery.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [savedQueries, savedQueriesSearchQuery]);

  function closeTransientOverlays() {
    setIsCommandPaletteOpen(false);
    setIsQueryLibraryOpen(false);
  }

  function openSaveDialog(nextState: SaveQueryDialogState) {
    setSaveDialogState(nextState);
    setIsSaveDialogOpen(true);
    setIsCommandPaletteOpen(false);
  }

  function openSaveDialogForActiveTab() {
    if (!activeTab) {
      return;
    }

    const existingSavedQuery = activeTab.savedQueryId
      ? savedQueries.find((entry) => entry.id === activeTab.savedQueryId) ?? null
      : null;
    openSaveDialog({
      tabId: activeTab.id,
      existingId: activeTab.savedQueryId,
      title: existingSavedQuery?.title ?? activeTab.title,
      sql: activeTab.sql,
      tagsText: existingSavedQuery?.tags.join(', ') ?? '',
      connectionProfileId:
        existingSavedQuery?.connectionProfileId ??
        activeTab.targetConnectionId ??
        activeSession?.connectionId ??
        selectedConnectionId ??
        connections[0]?.id ??
        null,
      mode: activeTab.savedQueryId ? 'update' : 'create',
      sourceLabel: activeTab.savedQueryId
        ? `Harness tab linked to ${existingSavedQuery?.title ?? activeTab.title}`
        : `Harness tab: ${activeTab.title}`,
      allowSaveAsNew: Boolean(activeTab.savedQueryId),
    });
  }

  function openHistoryEntry(entry: HistoryEntry) {
    closeTransientOverlays();
    workspace.openQueryTab({
      sql: entry.sql,
      targetConnectionId: entry.connectionProfileId,
    });
  }

  function openSavedQueryEntry(savedQuery: SavedQuery) {
    closeTransientOverlays();
    workspace.openQueryTab({
      sql: savedQuery.sql,
      title: savedQuery.title,
      targetConnectionId: savedQuery.connectionProfileId,
      savedQueryId: savedQuery.id,
    });
  }

  function openSaveDialogForHistoryEntry(entry: HistoryEntry) {
    openSaveDialog({
      tabId: null,
      existingId: null,
      title: deriveHarnessTabTitle(entry.sql),
      sql: entry.sql,
      tagsText: '',
      connectionProfileId: entry.connectionProfileId,
      mode: 'create',
      sourceLabel: `History entry from ${entry.createdAt}`,
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
      connectionProfileId: savedQuery.connectionProfileId,
      mode: 'update',
      sourceLabel: `Saved query: ${savedQuery.title}`,
      allowSaveAsNew: true,
    });
  }

  function submitSaveDialog(modeOverride?: 'create' | 'update') {
    const draft = saveDialogState;
    if (!draft) {
      return;
    }

    const nextId =
      modeOverride === 'create' || !draft.existingId ? `saved-query-${crypto.randomUUID()}` : draft.existingId;
    const resolvedConnectionId =
      draft.connectionProfileId ??
      activeTab?.targetConnectionId ??
      activeSession?.connectionId ??
      selectedConnectionId ??
      connections[0]?.id ??
      null;
    const savedQuery: SavedQuery = {
      id: nextId,
      title: draft.title.trim() || deriveHarnessTabTitle(draft.sql),
      sql: draft.sql,
      tags: draft.tagsText
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      connectionProfileId: resolvedConnectionId,
      createdAt:
        modeOverride === 'create' || !draft.existingId
          ? new Date().toISOString()
          : savedQueries.find((entry) => entry.id === draft.existingId)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setSavedQueries((current) => {
      const remaining = current.filter((entry) => entry.id !== savedQuery.id);
      return [savedQuery, ...remaining];
    });

    if (draft.tabId) {
      workspace.updateTabMetadata(draft.tabId, {
        savedQueryId: savedQuery.id,
        targetConnectionId: savedQuery.connectionProfileId,
        title: savedQuery.title,
      });
    }

    setIsSaveDialogOpen(false);
    setSaveDialogState(null);
  }

  function deleteSavedQueryEntry(savedQuery: SavedQuery) {
    setDeletingSavedQueryId(savedQuery.id);
    setSavedQueries((current) => current.filter((entry) => entry.id !== savedQuery.id));
    setTabs((current) =>
      current.map((tab) =>
        tab.savedQueryId === savedQuery.id ? { ...tab, savedQueryId: null } : tab,
      ),
    );
    setDeletingSavedQueryId(null);
  }

  const query = commandPaletteSearchQuery.trim().toLowerCase();
  const items: CommandPaletteItem[] = [
    {
      id: 'action-new-tab',
      group: 'Actions',
      title: 'New query tab',
      subtitle: 'Open a fresh harness tab.',
      shortcut: 'Mod+N',
      onSelect: () => {
        workspace.createTab();
        setIsCommandPaletteOpen(false);
      },
    },
    {
      id: 'action-save-query',
      group: 'Actions',
      title: 'Save query',
      subtitle: 'Persist the active harness tab as a saved query.',
      shortcut: 'Mod+S',
      onSelect: openSaveDialogForActiveTab,
    },
    {
      id: 'action-query-library',
      group: 'Actions',
      title: 'Open query library',
      subtitle: 'Inspect saved queries and history in the harness.',
      onSelect: () => {
        setQueryLibraryTab('saved');
        setIsQueryLibraryOpen(true);
        setIsCommandPaletteOpen(false);
      },
    },
    {
      id: 'action-focus-results',
      group: 'Actions',
      title: 'Focus results',
      subtitle: 'Move focus to the quick filter.',
      shortcut: 'Mod+4',
      onSelect: () => {
        focusRegistry.focusTarget('results');
        setIsCommandPaletteOpen(false);
      },
    },
  ];

  const dynamicItems = [
    ...savedQueries.map<CommandPaletteItem>((savedQuery) => ({
      id: `saved-${savedQuery.id}`,
      group: 'Saved Queries',
      title: savedQuery.title,
      subtitle: savedQuery.sql.replace(/\s+/g, ' ').trim(),
      detail: savedQuery.connectionProfileId ?? 'No default connection',
      onSelect: () => {
        openSavedQueryEntry(savedQuery);
        setIsCommandPaletteOpen(false);
      },
    })),
    ...historyEntries.map<CommandPaletteItem>((entry) => ({
      id: `history-${entry.id}`,
      group: 'History',
      title: deriveHarnessTabTitle(entry.sql),
      subtitle: entry.sql.replace(/\s+/g, ' ').trim(),
      detail: entry.connectionProfileId ?? 'No default connection',
      onSelect: () => {
        openHistoryEntry(entry);
        setIsCommandPaletteOpen(false);
      },
    })),
  ];

  const commandPaletteItems = [...items, ...dynamicItems].filter((item) =>
    query.length === 0
      ? true
      : [item.title, item.subtitle, item.detail ?? ''].join(' ').toLowerCase().includes(query),
  );

  const handleHarnessShortcuts = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (event.key === 'Escape') {
      if (isSaveDialogOpen) {
        event.preventDefault();
        setIsSaveDialogOpen(false);
        return;
      }

      if (isQueryLibraryOpen) {
        event.preventDefault();
        setIsQueryLibraryOpen(false);
        return;
      }

      if (isCommandPaletteOpen) {
        event.preventDefault();
        setIsCommandPaletteOpen(false);
      }
      return;
    }

    if (!mod) {
      return;
    }

    if (key === 'k') {
      event.preventDefault();
      setIsCommandPaletteOpen(true);
      return;
    }

    switch (key) {
      case 's':
        event.preventDefault();
        openSaveDialogForActiveTab();
        break;
      case '4':
        event.preventDefault();
        focusRegistry.focusTarget('results');
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleHarnessShortcuts(event);
    };

    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, []);

  const workspace: QueryWorkspaceState = {
    activeTab,
    activeTabId,
    runDisabledReason: activeSession ? null : 'Connect the matching saved profile before running a query.',
    tabs,
    createTab: () => {
      const nextTab = buildTab(`tab-${tabs.length + 1}`, 'new_query.sql', activeSession?.connectionId ?? null);
      setTabs((current) => [...current, nextTab]);
      setActiveTabId(nextTab.id);
    },
    createNewTab: () => {},
    openQueryTab: (input) => {
      const nextTab = buildTab(
        `tab-${tabs.length + 1}`,
        input.title?.trim() || input.sql.split('\n')[0]?.trim() || 'query.sql',
        input.targetConnectionId ?? activeSession?.connectionId ?? null,
      );
      setTabs((current) => [
        ...current,
        {
          ...nextTab,
          sql: input.sql,
          title: input.title?.trim() || nextTab.title,
          savedQueryId: input.savedQueryId ?? null,
        },
      ]);
      setActiveTabId(nextTab.id);
      return nextTab.id;
    },
    updateTabMetadata: (tabId, updates) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                title: updates.title?.trim() || tab.title,
                savedQueryId:
                  updates.savedQueryId === undefined ? tab.savedQueryId : updates.savedQueryId,
                targetConnectionId:
                  updates.targetConnectionId === undefined
                    ? tab.targetConnectionId
                    : updates.targetConnectionId,
              }
            : tab,
        ),
      );
    },
    closeTab: (tabId) => {
      setTabs((current) => {
        const nextTabs = current.filter((tab) => tab.id !== tabId);
        const fallback = nextTabs[0] ?? buildTab('tab-fallback', 'scratch.sql', activeSession?.connectionId ?? null);
        if (activeTabId === tabId) {
          setActiveTabId(fallback.id);
        }
        return nextTabs.length > 0 ? nextTabs : [fallback];
      });
    },
    selectTab: setActiveTabId,
    setTabSql: (tabId, sql) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                sql,
                title: sql.split('\n')[0]?.trim() || 'query.sql',
                dirty: true,
              }
            : tab,
        ),
      );
    },
    updateTabSql: () => {},
    setTabTargetConnection: (tabId, connectionId) => {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? refreshTabResult({ ...tab, targetConnectionId: connectionId }) : tab)));
    },
    updateTabTargetConnection: () => {},
    startTabQuery: (tabId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? refreshTabResult({
                ...tab,
                execution: {
                  ...tab.execution,
                  status: 'completed',
                  jobId: null,
                  lastAccepted: {
                    jobId: 'harness-query-job',
                    correlationId: 'harness-query-corr',
                    tabId,
                    connectionId: activeSession?.connectionId ?? '',
                    startedAt: '2026-03-11T10:15:00.000Z',
                  },
                  lastEvent: {
                    jobId: 'harness-query-job',
                    correlationId: 'harness-query-corr',
                    tabId,
                    connectionId: activeSession?.connectionId ?? '',
                    status: 'completed',
                    elapsedMs: 42,
                    message: 'Harness query completed.',
                    startedAt: '2026-03-11T10:15:00.000Z',
                    finishedAt: '2026-03-11T10:15:00.042Z',
                    lastError: null,
                    result: buildResultSummary(tab.id),
                  },
                  lastResult: buildResultSummary(tab.id),
                  lastError: null,
                },
              })
            : tab,
        ),
      );
      return Promise.resolve();
    },
    runActiveTab: async () => {},
    cancelTabQuery: (tabId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                execution: {
                  ...tab.execution,
                  status: 'cancelled',
                  jobId: null,
                },
              }
            : tab,
        ),
      );
      return Promise.resolve();
    },
    cancelActiveTab: async () => {},
    loadTabResultWindow: (tabId, offset, limit) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? refreshTabResult(tab, {
                offset,
                limit,
              })
            : tab,
        ),
      );
      return Promise.resolve();
    },
    setTabQuickFilter: (tabId, value) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? refreshTabResult({
                ...tab,
                result: {
                  ...tab.result,
                  quickFilter: value,
                },
              })
            : tab,
        ),
      );
    },
    setTabColumnFilter: (tabId, columnIndex, value) => {
      setTabs((current) =>
        current.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }

          const nextFilters = tab.result.filters.filter((filter) => filter.columnIndex !== columnIndex);
          if (value.trim()) {
            nextFilters.push({
              columnIndex,
              mode: 'contains',
              value,
            });
          }

          return refreshTabResult({
            ...tab,
            result: {
              ...tab.result,
              filters: nextFilters,
            },
          });
        }),
      );
    },
    toggleTabSort: (tabId, columnIndex) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? refreshTabResult({
                ...tab,
                result: {
                  ...tab.result,
                  sort:
                    tab.result.sort?.columnIndex === columnIndex
                      ? tab.result.sort.direction === 'asc'
                        ? { columnIndex, direction: 'desc' }
                        : null
                      : { columnIndex, direction: 'asc' },
                },
              })
            : tab,
        ),
      );
    },
    setTabExportOutputPath: (tabId, outputPath) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                result: {
                  ...tab.result,
                  exportOutputPath: outputPath,
                },
              }
            : tab,
        ),
      );
    },
    startTabResultExport: (tabId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                result: {
                  ...tab.result,
                  exportJobId: 'export-job-harness',
                  exportStatus: 'running',
                },
              }
            : tab,
        ),
      );
      return Promise.resolve();
    },
    cancelTabResultExport: (tabId) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                result: {
                  ...tab.result,
                  exportJobId: null,
                  exportStatus: 'cancelled',
                },
              }
            : tab,
        ),
      );
      return Promise.resolve();
    },
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="h-dvh overflow-hidden" data-testid="shell-harness">
        <AppShell
        connectionDialog={null}
        diagnosticsDialog={null}
        productivityDialogs={
          <>
            <QueryLibraryDialog
              activeTab={queryLibraryTab}
              connections={connections}
              deletingSavedQueryId={deletingSavedQueryId}
              historyConnectionId={historyConnectionId}
              historyEntries={filteredHistoryEntries}
              historyHasMore={false}
              historyLoading={false}
              historySearchQuery={historySearchQuery}
              onActiveTabChange={setQueryLibraryTab}
              onDeleteSavedQuery={deleteSavedQueryEntry}
              onEditSavedQuery={openSaveDialogForSavedQuery}
              onHistoryConnectionIdChange={setHistoryConnectionId}
              onHistorySearchQueryChange={setHistorySearchQuery}
              onOpenChange={setIsQueryLibraryOpen}
              onOpenHistoryEntry={openHistoryEntry}
              onOpenSavedQuery={openSavedQueryEntry}
              onRunHistoryEntry={openHistoryEntry}
              onRunSavedQuery={openSavedQueryEntry}
              onSaveHistoryEntry={openSaveDialogForHistoryEntry}
              onSavedQueriesSearchQueryChange={setSavedQueriesSearchQuery}
              open={isQueryLibraryOpen}
              savedQueries={filteredSavedQueries}
              savedQueriesHasMore={false}
              savedQueriesLoading={false}
              savedQueriesSearchQuery={savedQueriesSearchQuery}
            />
            <SaveQueryDialog
              connections={connections}
              draft={saveDialogState}
              onConnectionProfileIdChange={(connectionProfileId) => {
                setSaveDialogState((current) =>
                  current ? { ...current, connectionProfileId } : current,
                );
              }}
              onOpenChange={(open) => {
                setIsSaveDialogOpen(open);
                if (!open) {
                  setSaveDialogState(null);
                }
              }}
              onSaveAsNew={
                saveDialogState?.allowSaveAsNew
                  ? () => {
                      submitSaveDialog('create');
                    }
                  : null
              }
              onSubmit={() => {
                submitSaveDialog();
              }}
              onTagsTextChange={(value) => {
                setSaveDialogState((current) => (current ? { ...current, tagsText: value } : current));
              }}
              onTitleChange={(value) => {
                setSaveDialogState((current) => (current ? { ...current, title: value } : current));
              }}
              open={isSaveDialogOpen}
              pending={false}
            />
            <CommandPalette
              items={commandPaletteItems}
              loading={false}
              onOpenChange={setIsCommandPaletteOpen}
              onSearchQueryChange={setCommandPaletteSearchQuery}
              open={isCommandPaletteOpen}
              searchQuery={commandPaletteSearchQuery}
            />
          </>
        }
        editor={
          <QueryWorkspace
            activeSession={activeSession}
            connections={connections}
            onError={() => {}}
            registerEditorFocusTarget={focusRegistry.registerEditorFocusTarget}
            showTabStrip={false}
            workspace={workspace}
          />
        }
        editorTabs={<QueryTabStrip workspace={workspace} />}
        headerBar={
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-muted)] text-[var(--accent-text)]">
                  <Database className="h-4 w-4" />
                </div>
                <p className="text-lg font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Sparow</p>
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <Button
                  data-testid="query-library-launcher"
                  onClick={() => {
                    setQueryLibraryTab('saved');
                    setIsQueryLibraryOpen(true);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <LibraryBig className="h-3.5 w-3.5" />
                  Query Library
                </Button>
                <Button
                  data-testid="command-palette-launcher"
                  onClick={() => {
                    setIsCommandPaletteOpen(true);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Command className="h-3.5 w-3.5" />
                  Command Palette
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge>development</Badge>
              <Badge>darwin-aarch64</Badge>
              <Button className="min-w-[210px] justify-between" size="sm" type="button" variant="secondary">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--success-text)]" />
                  <span className="text-left">
                    <span className="block text-sm font-medium text-[var(--text-primary)]">{activeSession?.name ?? 'No connection'}</span>
                    <span className="block text-[11px] text-[var(--text-muted)]">{activeSession?.database ?? 'Select a target'}</span>
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
              </Button>
              <Button size="sm" type="button" variant="ghost">
                <Bug className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" type="button" variant="ghost">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_oklch,_var(--accent-solid)_52%,_var(--surface-panel)_48%)] text-[var(--accent-foreground)]">
                <UserRound className="h-4 w-4" />
              </div>
            </div>
          </div>
        }
        isLoading={false}
        leftSidebar={
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <ConnectionsRail
              activeSession={activeSession}
              canDisconnect={Boolean(activeSession)}
              connectingConnectionId={null}
              connections={connections}
              onActivateConnection={(connectionId) => {
                setSelectedConnectionId(connectionId);
                setActiveSession(toSession(connectionId));
                setTabs((current) => current.map((tab) => refreshTabResult({ ...tab, targetConnectionId: connectionId })));
                return Promise.resolve();
              }}
              onCreateConnection={() => {}}
              onDisconnectSelected={() => {
                setActiveSession(null);
                return Promise.resolve();
              }}
              onEditSelected={() => {}}
              onSelectConnection={setSelectedConnectionId}
              registerFocusTarget={focusRegistry.registerConnectionsFocusTarget}
              selectedConnectionId={selectedConnectionId}
            />
            <SchemaSidebar
              activeSession={activeSession}
              registerFocusTarget={focusRegistry.registerSchemaFocusTarget}
              schema={{
                activeConnectionId: activeSession?.connectionId ?? null,
                isDisabled: activeSession === null,
                isLoadingRoot: false,
                latestRefreshEvent: null,
                searchQuery,
                searchResults: schemaSearchResults,
                scopes: {},
                selectedNode: schemaRows.find((row) => row.node.path === selectedSchemaPath)?.node ?? null,
                visibleRows: schemaRows,
                setSearchQuery,
                selectNode: (node) => {
                  setSelectedSchemaPath(node.path);
                },
                toggleNode: (node) => {
                  setSelectedSchemaPath(node.path);
                  return Promise.resolve();
                },
                refreshSelectedScope: async () => {},
                handleTreeNavigation: async () => {},
              }}
            />
          </div>
        }
        results={
          <QueryResultsPanel
            activeSession={activeSession}
            activeView={activeResultsView}
            onActiveViewChange={setActiveResultsView}
            registerResultsFocusTarget={focusRegistry.registerResultsFocusTarget}
            workspace={workspace}
          />
        }
        statusBar={
          <div className="flex flex-col gap-2 px-4 py-2 text-sm text-[var(--text-secondary)] md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={activeSession ? 'success' : 'warning'}>{activeSession ? 'Ready' : 'Idle'}</Badge>
              <span>{activeSession ? `${activeSession.name} — ${activeSession.database}` : 'No active session'}</span>
              <span className="hidden lg:inline">{activeSession?.serverVersion ?? 'No server version'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span>{activeTab?.execution.status ?? 'idle'}</span>
              <span>{activeTab?.result.summary?.bufferedRowCount ?? 0} rows</span>
              <span>{activeTab?.execution.lastEvent?.elapsedMs ?? 0} ms</span>
            </div>
          </div>
        }
        />
      </div>
    </TooltipProvider>
  );
}

function createInitialTabs(connectionId: string): QueryTabState[] {
  return [
    refreshTabResult(buildTab('tab-lifetime', 'user_lifetime.sql', connectionId)),
    refreshTabResult(buildTab('tab-revenue', 'revenue_report.sql', connectionId)),
    refreshTabResult(buildTab('tab-users', 'users.sql', connectionId)),
  ];
}

function buildTab(id: string, title: string, connectionId: string | null): QueryTabState {
  const result = buildResultSummary(id);
  return {
    id,
    title,
    sql: `select current_database(), current_user, now();`,
    targetConnectionId: connectionId,
    savedQueryId: null,
    dirty: false,
    lastExecutionSummary: 'Query completed with rows ready.',
    lastRunSql: 'select current_database(), current_user, now();',
    execution: {
      status: 'completed',
      jobId: null,
      lastAccepted: {
        jobId: 'harness-job',
        correlationId: 'harness-corr',
        tabId: id,
        connectionId: connectionId ?? '',
        startedAt: '2026-03-11T10:15:00.000Z',
      },
      lastEvent: {
        jobId: 'harness-job',
        correlationId: 'harness-corr',
        tabId: id,
        connectionId: connectionId ?? '',
        status: 'completed',
        elapsedMs: 42,
        message: 'Harness query completed.',
        startedAt: '2026-03-11T10:15:00.000Z',
        finishedAt: '2026-03-11T10:15:00.042Z',
        lastError: null,
        result,
      },
      lastResult: result,
      lastError: null,
    },
    result: {
      summary: buildSummary(id, baseRows.length),
      window: null,
      windowStatus: 'idle',
      windowError: null,
      requestedWindowSignature: null,
      countStatus: 'idle',
      countError: null,
      requestedCountSignature: null,
      quickFilter: '',
      filters: [],
      sort: null,
      exportOutputPath: './sparow-result.csv',
      exportJobId: null,
      exportStatus: 'idle',
      exportLastEvent: null,
      exportLastError: null,
    },
  };
}

function buildSummary(id: string, rowCount: number): QueryResultSetSummary {
  return {
    resultSetId: `result-${id}`,
    columns,
    bufferedRowCount: rowCount,
    totalRowCount: rowCount,
    hasMoreRows: false,
    status: 'completed',
  };
}

function buildResultSummary(id: string): QueryExecutionResult {
  return {
    kind: 'rows',
    ...buildSummary(id, baseRows.length),
  };
}

function refreshTabResult(tab: QueryTabState, windowRequest?: { offset: number; limit: number }): QueryTabState {
  const visibleRows = applyRows(baseRows, tab.result.sort, tab.result.filters, tab.result.quickFilter);
  const offset = windowRequest?.offset ?? tab.result.window?.offset ?? 0;
  const limit = windowRequest?.limit ?? tab.result.window?.limit ?? 28;
  const nextWindow = buildWindow(tab.result.summary?.resultSetId ?? `result-${tab.id}`, visibleRows, offset, limit, tab.result.sort, tab.result.filters, tab.result.quickFilter);

  return {
    ...tab,
    result: {
      ...tab.result,
      summary: buildSummary(tab.id, visibleRows.length),
      window: nextWindow,
      windowStatus: 'ready',
      requestedWindowSignature: `${offset}:${limit}:${tab.result.quickFilter}:${JSON.stringify(tab.result.filters)}:${JSON.stringify(tab.result.sort)}`,
    },
  };
}

function applyRows(
  rows: QueryResultCell[][],
  sort: QueryResultSort | null,
  filters: QueryResultFilter[],
  quickFilter: string,
) {
  const filteredRows = rows.filter((row) => {
    const quick = quickFilter.trim().toLowerCase();
    if (quick && !row.some((cell) => String(cell ?? '').toLowerCase().includes(quick))) {
      return false;
    }

    return filters.every((filter) => String(row[filter.columnIndex] ?? '').toLowerCase().includes(filter.value.toLowerCase()));
  });

  if (!sort) {
    return filteredRows;
  }

  return filteredRows.toSorted((left, right) => {
    const leftValue = String(left[sort.columnIndex] ?? '');
    const rightValue = String(right[sort.columnIndex] ?? '');
    return sort.direction === 'asc' ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
  });
}

function buildWindow(
  resultSetId: string,
  rows: QueryResultCell[][],
  offset: number,
  limit: number,
  sort: QueryResultSort | null,
  filters: QueryResultFilter[],
  quickFilter: string,
): QueryResultWindow {
  return {
    resultSetId,
    offset,
    limit,
    rows: rows.slice(offset, offset + limit),
    visibleRowCount: rows.length,
    bufferedRowCount: rows.length,
    totalRowCount: rows.length,
    hasMoreRows: false,
    status: 'completed',
    sort,
    filters,
    quickFilter,
  };
}

function deriveHarnessTabTitle(sql: string) {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 48) || 'query.sql';
}

function toSession(connectionId: string): DatabaseSessionSnapshot | null {
  const connection = connections.find((entry) => entry.id === connectionId);
  if (!connection) {
    return null;
  }

  return {
    connectionId: connection.id,
    name: connection.name,
    engine: connection.engine,
    database: connection.database,
    username: connection.username,
    host: connection.host,
    port: connection.port,
    connectedAt: '2026-03-11T10:12:00.000Z',
    serverVersion: 'PostgreSQL 16.2',
    sslInUse: true,
    status: 'connected',
  };
}

function buildSchemaRows() {
  const publicNode: SchemaNode = {
    kind: 'schema',
    id: 'schema/public',
    connectionId: 'conn-staging',
    name: 'public',
    path: 'schema/public',
    parentPath: null,
    schemaName: 'public',
    relationName: null,
    hasChildren: true,
    refreshedAt: '2026-03-11T10:00:00.000Z',
  };

  const tables = [
    'account',
    'account_member',
    'api_key',
    'asset',
    'banner',
    'blackout_time_slot',
    'refund_credit_transaction',
    'schedule',
    'service_subscription',
    'shipment_tracker',
    'shipping_destination',
    'slug',
    'submission_extension',
    'team_allocation',
    'time_slot_adjustment',
    'typeorm_metadata',
    'user',
    'vendor',
    'vendor_assignment_offer',
    'vendor_attendance_confirmation',
    'vendor_availability',
    'vendor_event_confirmation',
    'vendor_no_show_report',
    'vendor_poc',
    'virtual_meeting',
    'pg_stat_statements',
    'pg_stat_statements_info',
  ];

  return [
    {
      node: publicNode,
      depth: 0,
      childScopeStatus: 'fresh' as const,
      isExpanded: true,
      isRefreshing: false,
    },
    ...tables.map((tableName) => ({
      node: {
        kind: 'table' as const,
        id: `table/${tableName}`,
        connectionId: 'conn-staging',
        name: tableName,
        path: `table/public/${tableName}`,
        parentPath: 'schema/public',
        schemaName: 'public',
        relationName: tableName,
        hasChildren: false,
        refreshedAt: '2026-03-11T10:00:00.000Z',
      },
      depth: 1,
      childScopeStatus: null,
      isExpanded: false,
      isRefreshing: false,
    })),
  ];
}

function buildHarnessSavedQueries(): SavedQuery[] {
  return [
    {
      id: 'saved-query-ops-users',
      title: 'Active users',
      sql: 'select id, name, email from "user" where active = true order by updated_at desc;',
      tags: ['ops', 'users'],
      connectionProfileId: 'conn-staging',
      createdAt: '2026-03-12T09:00:00.000Z',
      updatedAt: '2026-03-12T09:00:00.000Z',
    },
    {
      id: 'saved-query-revenue',
      title: 'Revenue by week',
      sql: 'select week_start, total_revenue from revenue_snapshot order by week_start desc;',
      tags: ['finance', 'weekly'],
      connectionProfileId: 'conn-analytics',
      createdAt: '2026-03-11T08:00:00.000Z',
      updatedAt: '2026-03-11T08:00:00.000Z',
    },
  ];
}

function buildHarnessHistoryEntries(): HistoryEntry[] {
  return [
    {
      id: 'history-users',
      sql: 'select id, name, email from "user" where active = true order by updated_at desc;',
      connectionProfileId: 'conn-staging',
      createdAt: '2026-03-12T08:55:00.000Z',
    },
    {
      id: 'history-orders',
      sql: 'select id, state, total_cents from "order" where state = \'open\' order by inserted_at desc;',
      connectionProfileId: 'conn-production',
      createdAt: '2026-03-12T08:40:00.000Z',
    },
  ];
}
