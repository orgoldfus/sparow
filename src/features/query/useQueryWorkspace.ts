import { startTransition, useEffect, useMemo, useState } from 'react';
import type {
  AppError,
  ConnectionSummary,
  DatabaseSessionSnapshot,
  QueryExecutionAccepted,
  QueryExecutionProgressEvent,
  QueryExecutionResult,
  QueryExecutionStatus,
} from '../../lib/contracts';
import { cancelQueryExecution, startQueryExecution } from '../../lib/ipc';
import { logger } from '../../lib/logger';
import { deriveTabTitle } from './sqlStatement';

const INITIAL_SQL = 'select current_database(), current_user, now();';

export type QueryExecutionIntent = {
  sql: string;
  origin: 'selection' | 'current-statement';
  isSelectionMultiStatement: boolean;
};

export type QueryTabExecutionState = {
  status: QueryExecutionStatus | 'idle';
  jobId: string | null;
  lastAccepted: QueryExecutionAccepted | null;
  lastEvent: QueryExecutionProgressEvent | null;
  lastResult: QueryExecutionResult | null;
  lastError: AppError | null;
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
};

type UseQueryWorkspaceArgs = {
  activeSession: DatabaseSessionSnapshot | null;
  connections: ConnectionSummary[];
  queryEvents: QueryExecutionProgressEvent[];
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
};

export function useQueryWorkspace({
  activeSession,
  connections,
  queryEvents,
  selectedConnectionId,
  onError,
}: UseQueryWorkspaceArgs): QueryWorkspaceState {
  const [tabs, setTabs] = useState<QueryTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  useEffect(() => {
    if (tabs.length > 0) {
      return;
    }

    const initialTargetConnectionId =
      activeSession?.connectionId ?? selectedConnectionId ?? connections[0]?.id ?? null;
    const initialTab = createTabState(initialTargetConnectionId);
    startTransition(() => {
      setTabs([initialTab]);
      setActiveTabId(initialTab.id);
    });
  }, [activeSession?.connectionId, connections, selectedConnectionId, tabs.length]);

  useEffect(() => {
    const latestEvent = queryEvents[0];
    if (!latestEvent) {
      return;
    }

    startTransition(() => {
      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === latestEvent.tabId ? applyQueryEvent(tab, latestEvent) : tab,
        ),
      );
    });
  }, [queryEvents]);

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
      setTabs((currentTabs) => [...currentTabs, nextTab]);
      setActiveTabId(nextTab.id);
    });
  }

  function closeTab(tabId: string) {
    setTabs((currentTabs) => {
      const tab = currentTabs.find((entry) => entry.id === tabId);
      if (tab?.execution.jobId) {
        onError(
          logger.asAppError(
            new Error('Cancel the running query before closing this tab.'),
            'close_query_tab',
          ),
        );
        return currentTabs;
      }

      const nextTabs = currentTabs.filter((entry) => entry.id !== tabId);
      if (nextTabs.length === 0) {
        const fallbackTab = createTabState(
          activeSession?.connectionId ?? selectedConnectionId ?? connections[0]?.id ?? null,
        );
        setActiveTabId(fallbackTab.id);
        return [fallbackTab];
      }

      if (activeTabId === tabId) {
        setActiveTabId(nextTabs[nextTabs.length - 1]?.id ?? null);
      }

      return nextTabs;
    });
  }

  function selectTab(tabId: string) {
    setActiveTabId(tabId);
  }

  function setTabSql(tabId: string, sql: string) {
    setTabs((currentTabs) =>
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
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              targetConnectionId: connectionId,
            }
          : tab,
      ),
    );
  }

  async function startTabQuery(tabId: string, intent: QueryExecutionIntent) {
    const tab = tabs.find((entry) => entry.id === tabId);
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

      setTabs((currentTabs) =>
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
                },
              }
            : entry,
        ),
      );
    } catch (caught) {
      const error = logger.asAppError(caught, 'start_query_execution');
      onError(error);
      setTabs((currentTabs) =>
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
    const tab = tabs.find((entry) => entry.id === tabId);
    const jobId = tab?.execution.jobId;
    if (!jobId) {
      return;
    }

    try {
      await cancelQueryExecution(jobId);
      setTabs((currentTabs) =>
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
    return `${event.result.previewRowCount} preview row${
      event.result.previewRowCount === 1 ? '' : 's'
    } ready${event.result.truncated ? ' (truncated).' : '.'}`;
  }

  return event.message;
}

function isTerminalStatus(status: QueryExecutionStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}
