import { startTransition, useCallback, useEffect, useState } from 'react';
import type {
  AppError,
  ListSchemaChildrenResult,
  SchemaCacheStatus,
  SchemaNode,
  SchemaRefreshProgressEvent,
  SchemaScopeKind,
} from '../../lib/contracts';
import { listSchemaChildren, refreshSchemaScope, searchSchemaCache } from '../../lib/ipc';
import { logger } from '../../lib/logger';

type UseSchemaBrowserArgs = {
  activeConnectionId: string | null;
  schemaEvents: SchemaRefreshProgressEvent[];
  onError: (error: AppError) => void;
};

type ScopeMap = Record<string, ListSchemaChildrenResult>;

export type VisibleSchemaRow = {
  node: SchemaNode;
  depth: number;
  childScopeStatus: SchemaCacheStatus | null;
  isExpanded: boolean;
  isRefreshing: boolean;
};

export type SchemaBrowserState = {
  activeConnectionId: string | null;
  isDisabled: boolean;
  isLoadingRoot: boolean;
  latestRefreshEvent: SchemaRefreshProgressEvent | null;
  searchQuery: string;
  searchResults: SchemaNode[];
  scopes: ScopeMap;
  selectedNode: SchemaNode | null;
  visibleRows: VisibleSchemaRow[];
  setSearchQuery: (value: string) => void;
  selectNode: (node: SchemaNode) => void;
  toggleNode: (node: SchemaNode) => Promise<void>;
  refreshSelectedScope: () => Promise<void>;
  handleTreeNavigation: (direction: 'up' | 'down' | 'left' | 'right') => Promise<void>;
};

export function useSchemaBrowser({
  activeConnectionId,
  schemaEvents,
  onError,
}: UseSchemaBrowserArgs): SchemaBrowserState {
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [isLoadingRoot, setIsLoadingRoot] = useState(false);
  const [scopes, setScopes] = useState<ScopeMap>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SchemaNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const latestRefreshEvent = schemaEvents[0] ?? null;
  const isDisabled = activeConnectionId === null;

  const loadScope = useCallback(async (
    connectionId: string,
    scopeKind: SchemaScopeKind,
    scopePath: string | null,
    options?: { root?: boolean; selectFirst?: boolean },
  ) => {
    if (options?.root) {
      setIsLoadingRoot(true);
    }

    try {
      const result = await listSchemaChildren({
        connectionId,
        parentKind: scopeKind,
        parentPath: scopePath,
      });

      startTransition(() => {
        setScopes((current) => ({
          ...current,
          [scopeKey(scopeKind, scopePath)]: result,
        }));

        if (options?.selectFirst && result.nodes.length > 0) {
          setSelectedPath((current) => current ?? result.nodes[0]?.path ?? null);
        }
      });
    } catch (caught) {
      onError(logger.asAppError(caught, 'list_schema_children'));
    } finally {
      if (options?.root) {
        setIsLoadingRoot(false);
      }
    }
  }, [onError]);

  useEffect(() => {
    if (!activeConnectionId) {
      startTransition(() => {
        setExpandedPaths([]);
        setScopes({});
        setSearchQuery('');
        setSearchResults([]);
        setSelectedPath(null);
        setIsLoadingRoot(false);
      });
      return;
    }

    void loadScope(activeConnectionId, 'root', null, { root: true, selectFirst: true });
  }, [activeConnectionId, loadScope]);

  useEffect(() => {
    if (!activeConnectionId || !latestRefreshEvent) {
      return;
    }

    if (latestRefreshEvent.connectionId !== activeConnectionId) {
      return;
    }

    if (latestRefreshEvent.status === 'completed' || latestRefreshEvent.status === 'failed') {
      void loadScope(activeConnectionId, latestRefreshEvent.scopeKind, latestRefreshEvent.scopePath, {
        root: latestRefreshEvent.scopeKind === 'root',
      });
    }
  }, [activeConnectionId, latestRefreshEvent, loadScope]);

  useEffect(() => {
    if (!activeConnectionId) {
      return;
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      setSearchResults([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      searchSchemaCache({
        connectionId: activeConnectionId,
        query: trimmed,
        limit: 16,
      })
        .then((result) => {
          setSearchResults(result.nodes);
        })
        .catch((caught) => {
          onError(logger.asAppError(caught, 'search_schema_cache'));
        });
    }, 150);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeConnectionId, onError, searchQuery]);

  const visibleRows = flattenVisibleRows(scopes, expandedPaths, activeConnectionId);
  const selectedNode =
    visibleRows.find((row) => row.node.path === selectedPath)?.node ??
    searchResults.find((node) => node.path === selectedPath) ??
    null;

  async function toggleNode(node: SchemaNode) {
    const childScope = childScopeForNode(node);
    if (!childScope || !activeConnectionId) {
      setSelectedPath(node.path);
      return;
    }

    const alreadyExpanded = expandedPaths.includes(node.path);
    setSelectedPath(node.path);

    if (alreadyExpanded) {
      setExpandedPaths((current) => current.filter((entry) => entry !== node.path));
      return;
    }

    setExpandedPaths((current) => [...current, node.path]);
    if (!scopes[scopeKey(childScope.kind, childScope.path)]) {
      await loadScope(activeConnectionId, childScope.kind, childScope.path);
    }
  }

  function selectNode(node: SchemaNode) {
    setSelectedPath(node.path);
    const ancestors = ancestorPathsForNode(node);
    if (ancestors.length > 0) {
      setExpandedPaths((current) => [...new Set([...current, ...ancestors])]);
    }
  }

  async function refreshSelectedScope() {
    if (!activeConnectionId) {
      return;
    }

    const scope = selectedNode ? childScopeForNode(selectedNode) : { kind: 'root' as const, path: null };
    if (!scope) {
      return;
    }

    try {
      await refreshSchemaScope({
        connectionId: activeConnectionId,
        scopeKind: scope.kind,
        scopePath: scope.path,
      });
      setScopes((current) => {
        const existing = current[scopeKey(scope.kind, scope.path)];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [scopeKey(scope.kind, scope.path)]: {
            ...existing,
            refreshInFlight: true,
          },
        };
      });
    } catch (caught) {
      onError(logger.asAppError(caught, 'refresh_schema_scope'));
    }
  }

  async function handleTreeNavigation(direction: 'up' | 'down' | 'left' | 'right') {
    if (visibleRows.length === 0) {
      return;
    }

    const currentIndex = visibleRows.findIndex((row) => row.node.path === selectedPath);
    const fallbackIndex = currentIndex === -1 ? 0 : currentIndex;
    const currentRow = visibleRows[fallbackIndex];

    switch (direction) {
      case 'up':
        setSelectedPath(visibleRows[Math.max(0, fallbackIndex - 1)]?.node.path ?? selectedPath);
        break;
      case 'down':
        setSelectedPath(
          visibleRows[Math.min(visibleRows.length - 1, fallbackIndex + 1)]?.node.path ?? selectedPath,
        );
        break;
      case 'left':
        if (expandedPaths.includes(currentRow.node.path)) {
          setExpandedPaths((current) => current.filter((entry) => entry !== currentRow.node.path));
        } else if (currentRow.node.parentPath) {
          setSelectedPath(currentRow.node.parentPath);
        }
        break;
      case 'right':
        await toggleNode(currentRow.node);
        break;
    }
  }

  return {
    activeConnectionId,
    isDisabled,
    isLoadingRoot,
    latestRefreshEvent,
    searchQuery,
    searchResults,
    scopes,
    selectedNode,
    visibleRows,
    setSearchQuery,
    selectNode,
    toggleNode,
    refreshSelectedScope,
    handleTreeNavigation,
  };
}

function flattenVisibleRows(scopes: ScopeMap, expandedPaths: string[], activeConnectionId: string | null): VisibleSchemaRow[] {
  if (!activeConnectionId) {
    return [];
  }

  const rows: VisibleSchemaRow[] = [];
  const root = scopes[scopeKey('root', null)]?.nodes ?? [];
  appendRows(rows, root, 0, scopes, expandedPaths);
  return rows;
}

function appendRows(
  rows: VisibleSchemaRow[],
  nodes: SchemaNode[],
  depth: number,
  scopes: ScopeMap,
  expandedPaths: string[],
) {
  for (const node of nodes) {
    const childScope = childScopeForNode(node);
    const childState = childScope ? scopes[scopeKey(childScope.kind, childScope.path)] ?? null : null;
    const isExpanded = expandedPaths.includes(node.path);
    rows.push({
      node,
      depth,
      childScopeStatus: childState?.cacheStatus ?? null,
      isExpanded,
      isRefreshing: childState?.refreshInFlight ?? false,
    });

    if (isExpanded && childState) {
      appendRows(rows, childState.nodes, depth + 1, scopes, expandedPaths);
    }
  }
}

function scopeKey(kind: SchemaScopeKind, path: string | null) {
  return `${kind}::${path ?? ''}`;
}

function childScopeForNode(node: SchemaNode): { kind: SchemaScopeKind; path: string } | null {
  switch (node.kind) {
    case 'schema':
      return { kind: 'schema', path: node.path };
    case 'table':
      return { kind: 'table', path: node.path };
    case 'view':
      return { kind: 'view', path: node.path };
    default:
      return null;
  }
}

function ancestorPathsForNode(node: SchemaNode): string[] {
  switch (node.kind) {
    case 'schema':
      return [];
    case 'table':
    case 'view':
      return [`schema/${node.schemaName}`];
    case 'column':
    case 'index':
      return [`schema/${node.schemaName}`, node.parentPath ?? ''].filter(Boolean);
  }
}
