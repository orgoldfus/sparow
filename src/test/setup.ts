import '@testing-library/jest-dom/vitest';
import { createElement, useEffect, useRef } from 'react';
import { vi } from 'vitest';

vi.mock('@monaco-editor/react', () => ({
  Editor: ({
    onMount,
    value,
    onChange,
  }: {
    onMount?: (editor: unknown, monaco: unknown) => void;
    value?: string;
    onChange?: (value: string) => void;
  }) => {
    const commandRef = useRef<(() => void) | null>(null);
    const valueRef = useRef(value ?? '');

    valueRef.current = value ?? '';

    useEffect(() => {
      const editor = {
        addCommand: (_binding: number, command: () => void) => {
          commandRef.current = command;
          return 1;
        },
        getModel: () => ({ getValue: () => valueRef.current }),
        getSelection: () => null,
      };
      const monaco = {
        KeyCode: { Enter: 3 },
        KeyMod: { CtrlCmd: 2048 },
        languages: {
          registerCompletionItemProvider: () => ({
            dispose() {},
          }),
        },
      };

      onMount?.(editor, monaco);
    }, [onMount]);

    return createElement('textarea', {
      'data-testid': 'monaco-editor',
      onChange: (event: Event) => {
        const target = event.currentTarget as HTMLTextAreaElement | null;
        onChange?.(target?.value ?? '');
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          commandRef.current?.();
        }
      },
      value: value ?? '',
    });
  },
}));
