import type * as Monaco from 'monaco-editor';
import {
  deriveStatementExecutionInput,
  type StatementExecutionInput,
} from './sqlStatement';

export type ExecutionSlice = StatementExecutionInput;

export function resolveExecutionSlice(
  model: Monaco.editor.ITextModel,
  selection: Monaco.Selection | null,
): ExecutionSlice {
  const cursorPosition = selection
    ? { lineNumber: selection.endLineNumber, column: selection.endColumn }
    : { lineNumber: 1, column: 1 };
  const selectionStartPosition = selection
    ? { lineNumber: selection.startLineNumber, column: selection.startColumn }
    : cursorPosition;
  const selectionEndPosition = cursorPosition;

  return deriveStatementExecutionInput(model.getValue(), {
    cursorOffset: model.getOffsetAt(cursorPosition),
    selectionStartOffset: model.getOffsetAt(selectionStartPosition),
    selectionEndOffset: model.getOffsetAt(selectionEndPosition),
  });
}
