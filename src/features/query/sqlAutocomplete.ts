import type * as Monaco from 'monaco-editor';
import { searchSchemaCache } from '../../lib/ipc';
import type {
  AppError,
  QueryResultColumn,
  SchemaNode,
  SchemaSearchRequest,
  SchemaSearchResult,
} from '../../lib/contracts';
import { logger } from '../../lib/logger';

type KeywordDefinition = {
  label: string;
  insertText: string;
  kind: 'keyword' | 'snippet';
};

export type SqlAutocompleteSuggestion = {
  label: string;
  insertText: string;
  detail: string | null;
  kind: 'keyword' | 'snippet' | SchemaNode['kind'];
};

type SqlAutocompleteContext = {
  activeConnectionId: string | null;
  connectionId: string | null;
  query: string;
};

type SqlAutocompleteSourceArgs = {
  debounceMs?: number;
  onError?: (error: AppError) => void;
  searchSchema?: (request: SchemaSearchRequest) => Promise<SchemaSearchResult>;
};

const SQL_KEYWORDS: KeywordDefinition[] = [
  { label: 'SELECT', insertText: 'SELECT ', kind: 'keyword' },
  { label: 'FROM', insertText: 'FROM ', kind: 'keyword' },
  { label: 'WHERE', insertText: 'WHERE ', kind: 'keyword' },
  { label: 'JOIN', insertText: 'JOIN ', kind: 'keyword' },
  { label: 'LEFT JOIN', insertText: 'LEFT JOIN ', kind: 'keyword' },
  { label: 'INSERT INTO', insertText: 'INSERT INTO ', kind: 'keyword' },
  { label: 'UPDATE', insertText: 'UPDATE ', kind: 'keyword' },
  { label: 'DELETE FROM', insertText: 'DELETE FROM ', kind: 'keyword' },
  { label: 'GROUP BY', insertText: 'GROUP BY ', kind: 'keyword' },
  { label: 'ORDER BY', insertText: 'ORDER BY ', kind: 'keyword' },
  { label: 'LIMIT', insertText: 'LIMIT ', kind: 'keyword' },
  { label: 'WITH', insertText: 'WITH ', kind: 'keyword' },
  { label: 'RETURNING', insertText: 'RETURNING ', kind: 'keyword' },
  {
    label: 'SELECT template',
    insertText: 'SELECT *\nFROM ${1:table_name}\nWHERE ${2:condition}',
    kind: 'snippet',
  },
];

export function mergeSqlAutocompleteSuggestions(
  query: string,
  nodes: SchemaNode[],
): SqlAutocompleteSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = new Map<string, SqlAutocompleteSuggestion>();

  if (normalizedQuery.length === 0) {
    for (const keyword of SQL_KEYWORDS) {
      suggestions.set(keyword.label.toLowerCase(), {
        label: keyword.label,
        insertText: keyword.insertText,
        detail: null,
        kind: keyword.kind,
      });
    }
    return [...suggestions.values()];
  }

  for (const keyword of SQL_KEYWORDS) {
    if (keyword.label.toLowerCase().includes(normalizedQuery)) {
      suggestions.set(keyword.label.toLowerCase(), {
        label: keyword.label,
        insertText: keyword.insertText,
        detail: null,
        kind: keyword.kind,
      });
    }
  }

  for (const node of nodes) {
    if (!matchesQuery(node, normalizedQuery)) {
      continue;
    }

    const dedupeKey = `${node.kind}:${node.path}`.toLowerCase();
    suggestions.set(dedupeKey, {
      label: node.name,
      insertText: node.name,
      detail: node.path,
      kind: node.kind,
    });
  }

  return [...suggestions.values()];
}

export function createSqlAutocompleteSource({
  debounceMs = 120,
  onError,
  searchSchema = searchSchemaCache,
}: SqlAutocompleteSourceArgs = {}) {
  let latestRequestId = 0;
  let disposed = false;

  return {
    async resolve(context: SqlAutocompleteContext): Promise<SqlAutocompleteSuggestion[]> {
      if (disposed) {
        return [];
      }

      const requestId = latestRequestId + 1;
      latestRequestId = requestId;

      const localSuggestions = mergeSqlAutocompleteSuggestions(context.query, []);
      const trimmedQuery = context.query.trim();
      if (
        !context.connectionId ||
        !context.activeConnectionId ||
        context.connectionId !== context.activeConnectionId ||
        trimmedQuery.length === 0
      ) {
        return localSuggestions;
      }

      await waitForDebounce(debounceMs);
      if (disposed) {
        return localSuggestions;
      }

      try {
        const result = await searchSchema({
          connectionId: context.connectionId,
          query: trimmedQuery,
          limit: 12,
        });

        if (requestId !== latestRequestId) {
          return localSuggestions;
        }

        return mergeSqlAutocompleteSuggestions(trimmedQuery, result.nodes);
      } catch (caught) {
        onError?.(logger.asAppError(caught, 'search_schema_cache'));
        return localSuggestions;
      }
    },
    dispose() {
      disposed = true;
    },
  };
}

export function registerSqlCompletionProvider(args: {
  monaco: typeof Monaco;
  getConnectionId: () => string | null;
  getActiveConnectionId: () => string | null;
  onError: (error: AppError) => void;
}) {
  const { monaco, getConnectionId, getActiveConnectionId, onError } = args;
  const source = createSqlAutocompleteSource({
    onError,
  });

  const provider = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', '_'],
    provideCompletionItems: async (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions = await source.resolve({
        activeConnectionId: getActiveConnectionId(),
        connectionId: getConnectionId(),
        query: word.word,
      });

      return {
        suggestions: suggestions.map((suggestion, index) => ({
          label: suggestion.label,
          insertText: suggestion.insertText,
          detail: suggestion.detail ?? undefined,
          kind: toMonacoKind(monaco, suggestion.kind),
          range,
          sortText: `${suggestion.kind === 'keyword' || suggestion.kind === 'snippet' ? 'a' : 'b'}-${index
            .toString()
            .padStart(3, '0')}`,
          insertTextRules:
            suggestion.kind === 'snippet'
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
        })),
      };
    },
  });

  return {
    dispose() {
      source.dispose();
      provider.dispose();
    },
  };
}

export function formatResultColumns(columns: QueryResultColumn[]): string {
  return columns.map((column) => `${column.name} (${column.postgresType})`).join(', ');
}

function matchesQuery(node: SchemaNode, normalizedQuery: string): boolean {
  return (
    node.name.toLowerCase().includes(normalizedQuery) ||
    node.path.toLowerCase().includes(normalizedQuery) ||
    node.schemaName.toLowerCase().includes(normalizedQuery) ||
    (node.relationName?.toLowerCase().includes(normalizedQuery) ?? false)
  );
}

function toMonacoKind(
  monaco: typeof Monaco,
  kind: SqlAutocompleteSuggestion['kind'],
): Monaco.languages.CompletionItemKind {
  if (kind === 'keyword') {
    return monaco.languages.CompletionItemKind.Keyword;
  }

  if (kind === 'snippet') {
    return monaco.languages.CompletionItemKind.Snippet;
  }

  if (kind === 'column') {
    return monaco.languages.CompletionItemKind.Field;
  }

  if (kind === 'schema') {
    return monaco.languages.CompletionItemKind.Module;
  }

  if (kind === 'index') {
    return monaco.languages.CompletionItemKind.Reference;
  }

  return monaco.languages.CompletionItemKind.Class;
}

async function waitForDebounce(debounceMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, debounceMs);
  });
}
