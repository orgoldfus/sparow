import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryExecutionAccepted,
  QueryExecutionProgressEvent,
  QueryExecutionResult,
  QueryExecutionStatus,
  QueryResultExportProgressEvent,
  QueryResultExportStatus,
  QueryResultFilter,
  QueryResultSetSummary,
  QueryResultSort,
  QueryResultStreamEvent,
  QueryResultWindow,
} from '../../lib/contracts';
import {
  cancelQueryExecution,
  cancelQueryResultExport,
  getQueryResultWindow,
  startQueryExecution,
  startQueryResultExport,
} from '../../lib/ipc';
import { logger } from '../../lib/logger';
import { deriveTabTitle } from './sqlStatement';

const INITIAL_SQL = 'select current_database(), current_user, now();';
export type QueryExecutionIntent = {
  sql: string;
  origin: 'selection' | 'current-statement';
  isSelectionMultiStatement: boolean;
};

export type QueryResultWindowStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type QueryTabExecutionState = {
  status: QueryExecutionStatus | 'idle';
  jobId: string | null;
  lastAccepted: QueryExecutionAccepted | null;
  lastEvent: QueryExecutionProgressEvent | null;
  lastResult: QueryExecutionResult | null;
  lastError: AppError | null;
};

export type QueryTabResultState = {
  summary: QueryResultSetSummary | null;
  latestStreamEvent: QueryResultStreamEvent | null;
  window: QueryResultWindow | null;
  windowStatus: QueryResultWindowStatus;
  windowError: AppError | null;
  requestedWindowSignature: string | null;
  quickFilter: string;
  filters: QueryResultFilter[];
  sort: QueryResultSort | null;
  exportOutputPath: string;
  exportJobId: string | null;
  exportStatus: QueryResultExportStatus | 'idle';
  exportLastEvent: QueryResultExportProgressEvent | null;
  exportLastError: AppError | null;
};

export type QueryTabState = {
  id: string;
  title: string;
  sql: string;
  targetConnectionId: string | null;
  dirty: boolean;
  lastExecutionSummary: string | null;
  lastRunSql: string | null;
  execution: QueryTabExecutionState;
  result: QueryTabResultState;
};

type UseQueryWorkspaceArgs = {
  activeSession: DatabaseSessionSnapshot | null;
  connections: ConnectionSummary[];
  queryEvents: QueryExecutionProgressEvent[];
  resultStreamEvents: QueryResultStreamEvent[];
  resultExportEvents: QueryResultExportProgressEvent[];
  selectedConnectionId: string | null;
  onError: (error: AppError) => void;
};

export type QueryWorkspaceState = {
  activeTab: QueryTabState | null;
  activeTabId: string | null;
  runDisabledReason: string | null;
  tabs: QueryTabState[];
  createTab: () => void;
  createNewTab: () => void;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  setTabSql: (tabId: string, sql: string) => void;
  updateTabSql: (tabId: string, sql: string) => void;
  setTabTargetConnection: (tabId: string, connectionId: string | null) => void;
  updateTabTargetConnection: (tabId: string, connectionId: string | null) => void;
  startTabQuery: (tabId: string, intent: QueryExecutionIntent) => Promise<void>;
  runActiveTab: (intent: QueryExecutionIntent) => Promise<void>;
  cancelTabQuery: (tabId: string) => Promise<void>;
  cancelActiveTab: () => Promise<void>;
  loadTabResultWindow: (tabId: string, offset: number, limit: number) => Promise<void>;
  setTabQuickFilter: (tabId: string, value: string) => void;
  setTabColumnFilter: (tabId: string, columnIndex: number, value: string) => void;
  toggleTabSort: (tabId: string, columnIndex: number) => void;
  setTabExportOutputPath: (tabId: string, outputPath: string) => void;
  startTabResultExport: (tabId: string) => Promise<void>;
  cancelTabResultExport: (tabId: string) => Promise<void>;
};

export function useQueryWorkspace({
  activeSession,
  connections,
  queryEvents,
  resultStreamEvents,
  resultExportEvents,
  selectedConnectionId,
  onError,
}: UseQueryWorkspaceArgs): QueryWorkspaceState {
  const [tabs, setTabs] = useState<QueryTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const seenQueryEventsRef = useRef<Set<string>>(new Set());
  const seenResultStreamEventsRef = useRef<Set<string>>(new Set());
  const seenResultExportEventsRef = useRef<Set<string>>(new Set());
  const tabsRef = useRef<QueryTabState[]>(tabs);

  function commitTabs(
    updater: QueryTabState[] | ((currentTabs: QueryTabState[]) => QueryTabState[]),
  ) {
    setTabs((currentTabs) => {
      const nextTabs = typeof updater === 'function' ? updater(currentTabs) : updater;
      tabsRef.current = nextTabs;
      return nextTabs;
    });
  }

  useEffect(() => {
    if (tabs.length > 0) {
      return;
    }

    const initialTargetConnectionId =
      activeSession?.connectionId ?? selectedConnectionId ?? connections[0]?.id ?? null;
    const initialTab = createTabState(initialTargetConnectionId);
    startTransition(() => {
      commitTabs([initialTab]);
      setActiveTabId(initialTab.id);
    });
  }, [activeSession?.connectionId, connections, selectedConnectionId, tabs.length]);

  useEffect(() => {
    const unseenEvents = queryEvents
      .toReversed()
      .filter((event) => markEventIfUnseen(seenQueryEventsRef.current, eventSignatureForQueryEvent(event)));

    if (unseenEvents.length === 0) {
      return;
    }

    startTransition(() => {
      commitTabs((currentTabs) => {
        let nextTabs = currentTabs;
        for (const event of unseenEvents) {
          nextTabs = nextTabs.map((tab) => (tab.id === event.tabId ? applyQueryEvent(tab, event) : tab));
        }
        return nextTabs;
      });
    });
  }, [queryEvents]);

  useEffect(() => {
    const unseenEvents = resultStreamEvents
      .toReversed()
      .filter((event) =>
        markEventIfUnseen(seenResultStreamEventsRef.current, eventSignatureForResultStreamEvent(event)),
      );

    if (unseenEvents.length === 0) {
      return;
    }

    startTransition(() => {
      commitTabs((currentTabs) => {
        let nextTabs = currentTabs;
        for (const event of unseenEvents) {
          nextTabs = nextTabs.map((tab) => (tab.id === event.tabId ? applyResultStreamEvent(tab, event) : tab));
        }
        return nextTabs;
      });
    });
  }, [resultStreamEvents]);

  useEffect(() => {
    const unseenEvents = resultExportEvents
      .toReversed()
      .filter((event) =>
        markEventIfUnseen(seenResultExportEventsRef.current, eventSignatureForResultExportEvent(event)),
      );

    if (unseenEvents.length === 0) {
      return;
    }

    startTransition(() => {
      commitTabs((currentTabs) => {
        let nextTabs = currentTabs;
        for (const event of unseenEvents) {
          nextTabs = nextTabs.map((tab) => applyResultExportEvent(tab, event));
        }
        return nextTabs;
      });
    });
  }, [resultExportEvents]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const runDisabledReason = useMemo(
    () => getRunDisabledReason(activeTab, activeSession),
    [activeSession, activeTab],
  );

  function createTab() {
    const nextTargetConnectionId =
      activeSession?.connectionId ?? selectedConnectionId ?? connections[0]?.id ?? null;
    const nextTab = createTabState(nextTargetConnectionId);
    startTransition(() => {
      commitTabs((currentTabs) => [...currentTabs, nextTab]);
      setActiveTabId(nextTab.id);
    });
  }

  function closeTab(tabId: string) {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }

    if (tab.execution.jobId || tab.result.exportJobId) {
      onError(
        logger.asAppError(
          new Error('Cancel the active query or export before closing this tab.'),
          'close_query_tab',
        ),
      );
      return;
    }

    const remainingTabs = tabsRef.current.filter((entry) => entry.id !== tabId);
    const isClosingActiveTab = activeTabId === tabId;
    const fallbackTargetConnectionId =
      activeSession?.connectionId ?? selectedConnectionId ?? connections[0]?.id ?? null;

    let nextTabs = remainingTabs;
    let nextActiveTabId = activeTabId;

    if (remainingTabs.length === 0) {
      const fallbackTab = createTabState(fallbackTargetConnectionId);
      nextTabs = [fallbackTab];
      nextActiveTabId = fallbackTab.id;
    } else if (isClosingActiveTab) {
      nextActiveTabId = remainingTabs[remainingTabs.length - 1]?.id ?? null;
    }

    startTransition(() => {
      commitTabs(nextTabs);
      if (nextActiveTabId !== activeTabId) {
        setActiveTabId(nextActiveTabId);
      }
    });
  }

  function selectTab(tabId: string) {
    setActiveTabId(tabId);
  }

  function setTabSql(tabId: string, sql: string) {
    commitTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              sql,
              title: deriveTabTitle(sql),
              dirty: tab.lastRunSql !== null ? sql !== tab.lastRunSql : sql !== INITIAL_SQL,
            }
          : tab,
      ),
    );
  }

  function setTabTargetConnection(tabId: string, connectionId: string | null) {
    commitTabs((currentTabs) =>
      currentTabs.map((tab) => (tab.id === tabId ? { ...tab, targetConnectionId: connectionId } : tab)),
    );
  }

  async function startTabQuery(tabId: string, intent: QueryExecutionIntent) {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    const disabledReason = getRunDisabledReason(tab ?? null, activeSession);
    if (!tab || disabledReason) {
      onError(
        logger.asAppError(
          new Error(disabledReason ?? 'Select an active query tab before running SQL.'),
          'start_query_execution',
        ),
      );
      return;
    }

    try {
      const accepted = await startQueryExecution({
        tabId,
        connectionId: tab.targetConnectionId ?? '',
        sql: intent.sql,
        origin: intent.origin,
        isSelectionMultiStatement: intent.isSelectionMultiStatement,
      });

      commitTabs((currentTabs) =>
        currentTabs.map((entry) =>
          entry.id === tabId
            ? {
                ...entry,
                dirty: entry.sql !== intent.sql,
                lastRunSql: intent.sql,
                lastExecutionSummary: 'Query queued for execution.',
                execution: {
                  ...entry.execution,
                  status: 'queued',
                  jobId: accepted.jobId,
                  lastAccepted: accepted,
                  lastError: null,
                  lastResult: null,
                },
                result: resetResultState(),
              }
            : entry,
        ),
      );
    } catch (caught) {
      const error = logger.asAppError(caught, 'start_query_execution');
      onError(error);
      commitTabs((currentTabs) =>
        currentTabs.map((entry) =>
          entry.id === tabId
            ? {
                ...entry,
                lastExecutionSummary: error.message,
                execution: {
                  ...entry.execution,
                  lastError: error,
                  status: 'failed',
                },
              }
            : entry,
        ),
      );
    }
  }

  async function cancelTabQuery(tabId: string) {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    const jobId = tab?.execution.jobId;
    if (!jobId) {
      return;
    }

    try {
      await cancelQueryExecution(jobId);
      commitTabs((currentTabs) =>
        currentTabs.map((entry) =>
          entry.id === tabId
            ? {
                ...entry,
                lastExecutionSummary: 'Cancellation requested.',
              }
            : entry,
        ),
      );
    } catch (caught) {
      onError(logger.asAppError(caught, 'cancel_query_execution'));
    }
  }

  async function loadTabResultWindow(tabId: string, offset: number, limit: number) {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    const summary = tab?.result.summary;
    if (!tab || !summary) {
      return;
    }

    const signature = windowRequestSignature({
      resultSetId: summary.resultSetId,
      offset,
      limit,
      sort: tab.result.sort,
      filters: tab.result.filters,
      quickFilter: tab.result.quickFilter,
    });

    if (tab.result.requestedWindowSignature === signature && tab.result.windowStatus !== 'failed') {
      return;
    }

    commitTabs((currentTabs) =>
      currentTabs.map((entry) =>
        entry.id === tabId
          ? {
              ...entry,
              result: {
                ...entry.result,
                requestedWindowSignature: signature,
                windowStatus: 'loading',
                windowError: null,
              },
            }
          : entry,
      ),
    );

    try {
      const window = await getQueryResultWindow({
        resultSetId: summary.resultSetId,
        offset,
        limit,
        sort: tab.result.sort,
        filters: tab.result.filters,
        quickFilter: tab.result.quickFilter,
      });

      commitTabs((currentTabs) =>
        currentTabs.map((entry) =>
          entry.id === tabId && entry.result.requestedWindowSignature === signature
            ? {
                ...entry,
                result: {
                  ...entry.result,
                  summary: mergeSummaryFromWindow(entry.result.summary, window),
                  window,
                  windowStatus: 'ready',
                  windowError: null,
                },
              }
            : entry,
        ),
      );
    } catch (caught) {
      const error = logger.asAppError(caught, 'get_query_result_window');
      onError(error);
      commitTabs((currentTabs) =>
        currentTabs.map((entry) =>
          entry.id === tabId && entry.result.requestedWindowSignature === signature
            ? {
                ...entry,
                result: {
                  ...entry.result,
                  windowStatus: 'failed',
                  windowError: error,
                },
              }
            : entry,
        ),
      );
    }
  }

  function setTabQuickFilter(tabId: string, value: string) {
    commitTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              result: invalidateWindow({
                ...tab.result,
                quickFilter: value,
              }),
            }
          : tab,
      ),
    );
  }

  function setTabColumnFilter(tabId: string, columnIndex: number, value: string) {
    commitTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }

        const nextFilters = tab.result.filters.filter((filter) => filter.columnIndex !== columnIndex);
        if (value.trim().length > 0) {
          nextFilters.push({
            columnIndex,
            mode: 'contains',
            value,
          });
        }

        return {
          ...tab,
          result: invalidateWindow({
            ...tab.result,
            filters: nextFilters.sort((left, right) => left.columnIndex - right.columnIndex),
          }),
        };
      }),
    );
  }

  function toggleTabSort(tabId: string, columnIndex: number) {
    commitTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }

        const nextSort =
          tab.result.sort?.columnIndex === columnIndex
            ? tab.result.sort.direction === 'asc'
              ? {
                  columnIndex,
                  direction: 'desc' as const,
                }
              : null
            : {
                columnIndex,
                direction: 'asc' as const,
              };

        return {
          ...tab,
          result: invalidateWindow({
            ...tab.result,
            sort: nextSort,
          }),
        };
      }),
    );
  }

  function setTabExportOutputPath(tabId: string, outputPath: string) {
    commitTabs((currentTabs) =>
      currentTabs.map((tab) =>
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
  }

  async function startTabResultExport(tabId: string) {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    const summary = tab?.result.summary;
    if (!tab || !summary) {
      return;
    }

    try {
      const accepted = await startQueryResultExport({
        resultSetId: summary.resultSetId,
        outputPath: tab.result.exportOutputPath || defaultExportPath(summary.resultSetId),
        sort: tab.result.sort,
        filters: tab.result.filters,
        quickFilter: tab.result.quickFilter,
      });

      commitTabs((currentTabs) =>
        currentTabs.map((entry) =>
          entry.id === tabId
            ? {
                ...entry,
                result: {
                  ...entry.result,
                  exportJobId: accepted.jobId,
                  exportStatus: 'queued',
                  exportLastError: null,
                  exportOutputPath: accepted.outputPath,
                },
              }
            : entry,
        ),
      );
    } catch (caught) {
      const error = logger.asAppError(caught, 'start_query_result_export');
      onError(error);
      commitTabs((currentTabs) =>
        currentTabs.map((entry) =>
          entry.id === tabId
            ? {
                ...entry,
                result: {
                  ...entry.result,
                  exportLastError: error,
                  exportStatus: 'failed',
                },
              }
            : entry,
        ),
      );
    }
  }

  async function cancelTabResultExport(tabId: string) {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    const exportJobId = tab?.result.exportJobId;
    if (!exportJobId) {
      return;
    }

    try {
      await cancelQueryResultExport(exportJobId);
    } catch (caught) {
      onError(logger.asAppError(caught, 'cancel_query_result_export'));
    }
  }

  return {
    activeTab,
    activeTabId: activeTab?.id ?? null,
    runDisabledReason,
    tabs,
    createTab,
    createNewTab: createTab,
    closeTab,
    selectTab,
    setTabSql,
    updateTabSql: setTabSql,
    setTabTargetConnection,
    updateTabTargetConnection: setTabTargetConnection,
    startTabQuery,
    runActiveTab: async (intent) => {
      if (!activeTab) {
        return;
      }
      await startTabQuery(activeTab.id, intent);
    },
    cancelTabQuery,
    cancelActiveTab: async () => {
      if (!activeTab) {
        return;
      }
      await cancelTabQuery(activeTab.id);
    },
    loadTabResultWindow,
    setTabQuickFilter,
    setTabColumnFilter,
    toggleTabSort,
    setTabExportOutputPath,
    startTabResultExport,
    cancelTabResultExport,
  };
}

function createTabState(targetConnectionId: string | null): QueryTabState {
  return {
    id: `tab-${crypto.randomUUID()}`,
    title: deriveTabTitle(INITIAL_SQL),
    sql: INITIAL_SQL,
    targetConnectionId,
    dirty: false,
    lastExecutionSummary: null,
    lastRunSql: null,
    execution: {
      status: 'idle',
      jobId: null,
      lastAccepted: null,
      lastEvent: null,
      lastResult: null,
      lastError: null,
    },
    result: resetResultState(),
  };
}

function resetResultState(): QueryTabResultState {
  return {
    summary: null,
    latestStreamEvent: null,
    window: null,
    windowStatus: 'idle',
    windowError: null,
    requestedWindowSignature: null,
    quickFilter: '',
    filters: [],
    sort: null,
    exportOutputPath: '',
    exportJobId: null,
    exportStatus: 'idle',
    exportLastEvent: null,
    exportLastError: null,
  };
}

function getRunDisabledReason(
  tab: QueryTabState | null,
  activeSession: DatabaseSessionSnapshot | null,
): string | null {
  if (!tab) {
    return 'Open a tab before running a query.';
  }

  if (tab.execution.jobId) {
    return 'Cancel the active query before starting another one in this tab.';
  }

  if (!tab.targetConnectionId) {
    return 'Pick a saved connection for this tab first.';
  }

  if (!activeSession) {
    return 'Connect the matching saved profile before running a query.';
  }

  if (activeSession.connectionId !== tab.targetConnectionId) {
    return 'This tab targets a different saved profile than the active connection.';
  }

  return null;
}

function applyQueryEvent(tab: QueryTabState, event: QueryExecutionProgressEvent): QueryTabState {
  const nextSummary = event.result?.kind === 'rows' ? event.result : tab.result.summary;
  const nextExportPath =
    nextSummary && tab.result.exportOutputPath.length === 0
      ? defaultExportPath(nextSummary.resultSetId)
      : tab.result.exportOutputPath;

  return {
    ...tab,
    lastExecutionSummary: summarizeExecutionEvent(event),
    execution: {
      ...tab.execution,
      status: event.status,
      jobId: isTerminalStatus(event.status) ? null : event.jobId,
      lastEvent: event,
      lastResult: event.result ?? tab.execution.lastResult,
      lastError: event.lastError,
    },
    result: {
      ...tab.result,
      summary: nextSummary,
      exportOutputPath: nextExportPath,
      exportLastError: event.lastError ?? tab.result.exportLastError,
    },
  };
}

function applyResultStreamEvent(tab: QueryTabState, event: QueryResultStreamEvent): QueryTabState {
  const previousSummary = tab.result.summary;
  const columns = event.columns ?? previousSummary?.columns ?? [];
  const nextSummary =
    columns.length > 0 || previousSummary?.resultSetId === event.resultSetId
      ? {
          resultSetId: event.resultSetId,
          columns,
          bufferedRowCount: event.bufferedRowCount,
          totalRowCount: event.totalRowCount ?? previousSummary?.totalRowCount ?? null,
          isComplete: event.status === 'completed' ? true : previousSummary?.isComplete ?? false,
        }
      : previousSummary;

  return {
    ...tab,
    lastExecutionSummary: event.message,
    result: {
      ...tab.result,
      summary: nextSummary,
      latestStreamEvent: event,
      exportOutputPath:
        nextSummary && tab.result.exportOutputPath.length === 0
          ? defaultExportPath(nextSummary.resultSetId)
          : tab.result.exportOutputPath,
      window: shouldKeepWindow(tab.result.window, event.resultSetId) ? tab.result.window : null,
    },
  };
}

function applyResultExportEvent(
  tab: QueryTabState,
  event: QueryResultExportProgressEvent,
): QueryTabState {
  if (tab.result.summary?.resultSetId !== event.resultSetId && tab.result.exportJobId !== event.jobId) {
    return tab;
  }

  return {
    ...tab,
    result: {
      ...tab.result,
      exportJobId: isTerminalExportStatus(event.status) ? null : event.jobId,
      exportStatus: event.status,
      exportLastEvent: event,
      exportLastError: event.lastError,
      exportOutputPath: event.outputPath,
    },
  };
}

function summarizeExecutionEvent(event: QueryExecutionProgressEvent): string {
  if (event.lastError) {
    return event.lastError.message;
  }

  if (event.result?.kind === 'command') {
    const rowCount = event.result.rowsAffected ?? 0;
    return `${event.result.commandTag} completed (${rowCount} row${rowCount === 1 ? '' : 's'} affected).`;
  }

  if (event.result?.kind === 'rows') {
    const total = event.result.totalRowCount ?? event.result.bufferedRowCount;
    return `${total} cached row${total === 1 ? '' : 's'} ready${event.result.isComplete ? '.' : ' so far.'}`;
  }

  return event.message;
}

function isTerminalStatus(status: QueryExecutionStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

function isTerminalExportStatus(status: QueryResultExportStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

function shouldKeepWindow(window: QueryResultWindow | null, resultSetId: string): boolean {
  return window?.resultSetId === resultSetId;
}

function invalidateWindow(result: QueryTabResultState): QueryTabResultState {
  return {
    ...result,
    window: null,
    windowStatus: 'idle',
    windowError: null,
    requestedWindowSignature: null,
  };
}

function mergeSummaryFromWindow(
  summary: QueryResultSetSummary | null,
  window: QueryResultWindow,
): QueryResultSetSummary | null {
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    bufferedRowCount: window.bufferedRowCount,
    totalRowCount: window.totalRowCount,
    isComplete: window.isComplete,
  };
}

function defaultExportPath(resultSetId: string): string {
  return `./sparow-result-${resultSetId.slice(0, 8)}.csv`;
}

function markEventIfUnseen(registry: Set<string>, signature: string): boolean {
  if (registry.has(signature)) {
    return false;
  }
  registry.add(signature);
  return true;
}

function eventSignatureForQueryEvent(event: QueryExecutionProgressEvent): string {
  return [
    event.jobId,
    event.status,
    event.startedAt,
    event.finishedAt ?? '',
    event.elapsedMs,
    event.message,
  ].join(':');
}

function eventSignatureForResultStreamEvent(event: QueryResultStreamEvent): string {
  return [event.jobId, event.status, event.timestamp, event.bufferedRowCount, event.chunkRowCount].join(':');
}

function eventSignatureForResultExportEvent(event: QueryResultExportProgressEvent): string {
  return [event.jobId, event.status, event.outputPath, event.rowsWritten, event.finishedAt ?? ''].join(':');
}

function windowRequestSignature(input: {
  resultSetId: string;
  offset: number;
  limit: number;
  sort: QueryResultSort | null;
  filters: QueryResultFilter[];
  quickFilter: string;
}): string {
  return JSON.stringify(input);
}
