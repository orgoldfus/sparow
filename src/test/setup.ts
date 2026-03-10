import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { vi } from 'vitest';

vi.mock('@monaco-editor/react', () => ({
  Editor: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (value: string) => void;
  }) =>
    createElement('textarea', {
      'data-testid': 'monaco-editor',
      onChange: (event: Event) => {
        const target = event.currentTarget as HTMLTextAreaElement | null;
        onChange?.(target?.value ?? '');
      },
      value: value ?? '',
    }),
}));
