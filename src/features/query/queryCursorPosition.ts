import { useSyncExternalStore } from 'react';
import type * as Monaco from 'monaco-editor';

type CursorPosition = {
  line: number;
  column: number;
};

const DEFAULT_CURSOR_POSITION: CursorPosition = { line: 1, column: 1 };
const queryCursorPositionStore = createCursorPositionStore();

function createCursorPositionStore() {
  let current = DEFAULT_CURSOR_POSITION;
  const listeners = new Set<() => void>();

  function set(next: CursorPosition) {
    if (current.line === next.line && current.column === next.column) {
      return;
    }

    current = next;
    listeners.forEach((listener) => {
      listener();
    });
  }

  return {
    getSnapshot: () => current,
    reset: () => {
      set(DEFAULT_CURSOR_POSITION);
    },
    set,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function resetQueryCursorPosition() {
  queryCursorPositionStore.reset();
}

export function setQueryCursorPosition(position: CursorPosition) {
  queryCursorPositionStore.set(position);
}

export function syncQueryCursorPosition(editor: Monaco.editor.IStandaloneCodeEditor) {
  const getPosition =
    'getPosition' in editor && typeof editor.getPosition === 'function'
      ? editor.getPosition.bind(editor)
      : null;

  const position = getPosition?.() ?? null;
  if (!position) {
    queryCursorPositionStore.reset();
    return;
  }

  queryCursorPositionStore.set({
    column: position.column,
    line: position.lineNumber,
  });
}

export function useQueryCursorPosition(): CursorPosition {
  return useSyncExternalStore(
    queryCursorPositionStore.subscribe,
    queryCursorPositionStore.getSnapshot,
    queryCursorPositionStore.getSnapshot,
  );
}
