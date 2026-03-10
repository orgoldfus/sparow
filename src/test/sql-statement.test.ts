import {
  countExecutableStatements,
  deriveStatementExecutionInput,
  deriveTabTitle,
} from '../features/query/sqlStatement';

describe('sqlStatement helpers', () => {
  it('derives a friendly tab title from the first meaningful line', () => {
    expect(deriveTabTitle('\n\nselect * from users\nwhere id = 1')).toBe('select * from users');
    expect(deriveTabTitle('')).toBe('New Query');
  });

  it('prefers the current non-empty selection', () => {
    const sql = 'select 1;\nselect 2;';
    expect(
      deriveStatementExecutionInput(sql, {
        cursorOffset: 0,
        selectionStartOffset: 0,
        selectionEndOffset: 8,
      }),
    ).toEqual({
      sql: 'select 1',
      origin: 'selection',
      isSelectionMultiStatement: false,
    });
  });

  it('marks multi-statement selections without guessing', () => {
    const sql = 'select 1; select 2;';
    expect(
      deriveStatementExecutionInput(sql, {
        cursorOffset: 0,
        selectionStartOffset: 0,
        selectionEndOffset: sql.length,
      }),
    ).toEqual({
      sql: 'select 1; select 2;',
      origin: 'selection',
      isSelectionMultiStatement: true,
    });
  });

  it('finds the current statement while ignoring semicolons in strings and comments', () => {
    const sql = [
      "select ';not a delimiter' as value;",
      '-- ; comment delimiter',
      'select 2;',
      '/* ; block comment */',
      "select $$still;inside$$ as payload;",
    ].join('\n');

    expect(
      deriveStatementExecutionInput(sql, {
        cursorOffset: sql.indexOf('select 2'),
        selectionStartOffset: sql.indexOf('select 2'),
        selectionEndOffset: sql.indexOf('select 2'),
      }),
    ).toEqual({
      sql: 'select 2',
      origin: 'current-statement',
      isSelectionMultiStatement: false,
    });

    expect(countExecutableStatements(sql)).toBe(3);
  });

  it('rejects ambiguous whitespace between statements', () => {
    const sql = 'select 1;   \n  select 2;';

    expect(() =>
      deriveStatementExecutionInput(sql, {
        cursorOffset: sql.indexOf('\n'),
        selectionStartOffset: sql.indexOf('\n'),
        selectionEndOffset: sql.indexOf('\n'),
      }),
    ).toThrow('Place the cursor inside one SQL statement before running.');
  });
});
