import { Selection, editor } from 'monaco-editor';
import { resolveExecutionSlice } from '../features/query/executionSlice';

describe('resolveExecutionSlice', () => {
  it('prefers a non-empty selection', () => {
    const model = editor.createModel('select 1;\nselect 2;', 'sql');
    const slice = resolveExecutionSlice(model, new Selection(2, 1, 2, 9));

    expect(slice.origin).toBe('selection');
    expect(slice.sql).toBe('select 2');

    model.dispose();
  });

  it('extracts the current statement around the cursor', () => {
    const model = editor.createModel('select 1;\nselect 2;', 'sql');
    const slice = resolveExecutionSlice(model, new Selection(2, 5, 2, 5));

    expect(slice.origin).toBe('current-statement');
    expect(slice.sql).toBe('select 2');

    model.dispose();
  });

  it('ignores semicolons inside strings and comments', () => {
    const model = editor.createModel("select ';' as literal; -- comment ;\nselect 2;", 'sql');
    const slice = resolveExecutionSlice(model, new Selection(1, 10, 1, 10));

    expect(slice.sql).toBe("select ';' as literal");

    model.dispose();
  });

  it('throws when the cursor is not inside a statement', () => {
    const model = editor.createModel('select 1;   \n  select 2;', 'sql');

    expect(() => resolveExecutionSlice(model, new Selection(1, 12, 1, 12))).toThrow(
      /place the cursor inside/i,
    );

    model.dispose();
  });
});
