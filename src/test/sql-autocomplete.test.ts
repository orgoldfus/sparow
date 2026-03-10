import type { SchemaNode } from '../lib/contracts';
import {
  createSqlAutocompleteSource,
  mergeSqlAutocompleteSuggestions,
} from '../features/query/sqlAutocomplete';

const schemaNodes: SchemaNode[] = [
  {
    kind: 'table',
    id: 'table-public-users',
    connectionId: 'conn-local-postgres',
    name: 'users',
    path: 'table/public/users',
    parentPath: 'schema/public',
    schemaName: 'public',
    relationName: 'users',
    hasChildren: true,
    refreshedAt: '2026-03-10T16:45:00.000Z',
  },
  {
    kind: 'view',
    id: 'view-public-active_users',
    connectionId: 'conn-local-postgres',
    name: 'active_users',
    path: 'view/public/active_users',
    parentPath: 'schema/public',
    schemaName: 'public',
    relationName: 'active_users',
    hasChildren: true,
    refreshedAt: '2026-03-10T16:45:00.000Z',
  },
];

describe('sql autocomplete helpers', () => {
  it('merges SQL keywords and schema nodes without duplicates', () => {
    const suggestions = mergeSqlAutocompleteSuggestions('se', schemaNodes);
    expect(suggestions.find((entry) => entry.label === 'SELECT')).toBeDefined();

    const schemaSuggestions = mergeSqlAutocompleteSuggestions('us', schemaNodes);
    expect(schemaSuggestions.find((entry) => entry.label === 'users')).toBeDefined();
    expect(schemaSuggestions.find((entry) => entry.label === 'SELECT')).toBeUndefined();
  });

  it('falls back to local keywords when schema search is unavailable', async () => {
    const source = createSqlAutocompleteSource({
      debounceMs: 0,
      searchSchema: vi.fn(() => Promise.reject(new Error('offline'))),
    });

    const suggestions = await source.resolve({
      activeConnectionId: 'conn-local-postgres',
      connectionId: 'conn-local-postgres',
      query: 'sel',
    });

    expect(suggestions.find((entry) => entry.label === 'SELECT')).toBeDefined();
    source.dispose();
  });

  it('suppresses stale schema responses and keeps the latest request authoritative', async () => {
    vi.useFakeTimers();
    const searchSchema = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  connectionId: 'conn-local-postgres',
                  query: 'us',
                  nodes: schemaNodes,
                }),
              20,
            );
          }),
      )
      .mockResolvedValueOnce({
        connectionId: 'conn-local-postgres',
        query: 'use',
        nodes: [schemaNodes[0]],
      });

    const source = createSqlAutocompleteSource({
      debounceMs: 10,
      searchSchema,
    });

    const firstRequest = source.resolve({
      activeConnectionId: 'conn-local-postgres',
      connectionId: 'conn-local-postgres',
      query: 'us',
    });
    const secondRequest = source.resolve({
      activeConnectionId: 'conn-local-postgres',
      connectionId: 'conn-local-postgres',
      query: 'use',
    });

    await vi.advanceTimersByTimeAsync(40);

    const [firstSuggestions, secondSuggestions] = await Promise.all([firstRequest, secondRequest]);

    expect(secondSuggestions.find((entry) => entry.label === 'users')).toBeDefined();
    expect(firstSuggestions.find((entry) => entry.label === 'users')).toBeUndefined();
    source.dispose();
    vi.useRealTimers();
  });
});
