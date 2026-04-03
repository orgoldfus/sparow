import { useCallback, useRef } from 'react';

export type ShellFocusZone = 'connections' | 'schema' | 'editor' | 'results';
export type RegisterFocusTarget = (focus: (() => void) | null) => void;

export function useShellFocusRegistry() {
  const targetsRef = useRef(new Map<ShellFocusZone, () => void>());

  const focusTarget = useCallback((zone: ShellFocusZone) => {
    targetsRef.current.get(zone)?.();
  }, []);

  const registerFocusTarget = useCallback(
    (zone: ShellFocusZone): RegisterFocusTarget =>
      (focus) => {
        if (focus) {
          targetsRef.current.set(zone, focus);
          return;
        }

        targetsRef.current.delete(zone);
      },
    [],
  );

  return {
    focusTarget,
    registerConnectionsFocusTarget: registerFocusTarget('connections'),
    registerSchemaFocusTarget: registerFocusTarget('schema'),
    registerEditorFocusTarget: registerFocusTarget('editor'),
    registerResultsFocusTarget: registerFocusTarget('results'),
  };
}
