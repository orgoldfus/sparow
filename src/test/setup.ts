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
    const onMountRef = useRef(onMount);
    const editorRef = useRef<{
      addCommand: (_binding: number, command: () => void) => number;
      getModel: () => { getValue: () => string };
      getSelection: () => null;
      updateOptions: (_options: unknown) => void;
    } | null>(null);
    const monacoRef = useRef<{
      KeyCode: { Enter: number };
      KeyMod: { CtrlCmd: number };
      editor: {
        defineTheme: (_name: string, _theme: unknown) => void;
        setTheme: (_name: string) => void;
      };
      languages: {
        registerCompletionItemProvider: () => { dispose: () => void };
      };
    } | null>(null);

    valueRef.current = value ?? '';

    if (!editorRef.current) {
      editorRef.current = {
        addCommand: (_binding: number, command: () => void) => {
          commandRef.current = command;
          return 1;
        },
        getModel: () => ({ getValue: () => valueRef.current }),
        getSelection: () => null,
        updateOptions: () => {},
      };
    }

    if (!monacoRef.current) {
      monacoRef.current = {
        KeyCode: { Enter: 3 },
        KeyMod: { CtrlCmd: 2048 },
        editor: {
          defineTheme: () => {},
          setTheme: () => {},
        },
        languages: {
          registerCompletionItemProvider: () => ({
            dispose() {},
          }),
        },
      };
    }

    useEffect(() => {
      onMountRef.current?.(editorRef.current, monacoRef.current);
    }, []);

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
