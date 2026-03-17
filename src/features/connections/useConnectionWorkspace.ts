import { startTransition, useEffect, useRef, useState } from 'react';
import type {
  AppBootstrap,
  AppError,
  ConnectionDetails,
  ConnectionDraft,
  ConnectionSummary,
  ConnectionTestResult,
  DatabaseSessionSnapshot,
} from '../../lib/contracts';
import {
  connectSavedConnection,
  deleteSavedConnection,
  disconnectActiveConnection,
  getSavedConnection,
  listSavedConnections,
  saveConnection,
  testConnection,
} from '../../lib/ipc';
import { logger } from '../../lib/logger';

const EMPTY_DRAFT: ConnectionDraft = {
  name: '',
  host: '',
  port: 5432,
  database: '',
  username: '',
  sslMode: 'prefer',
  password: null,
};

type DraftErrors = Partial<Record<keyof ConnectionDraft, string>>;

type PendingState = {
  loadingDetails: boolean;
  saving: boolean;
  testing: boolean;
  connecting: boolean;
  disconnecting: boolean;
  deleting: boolean;
};

type UseConnectionWorkspaceArgs = {
  bootstrap: AppBootstrap | null;
  onError: (error: AppError) => void;
};

export type ConnectionWorkspaceState = {
  connections: ConnectionSummary[];
  selectedConnectionId: string | null;
  connectingConnectionId: string | null;
  loadedDetails: ConnectionDetails | null;
  draft: ConnectionDraft;
  draftErrors: DraftErrors;
  latestTestResult: ConnectionTestResult | null;
  activeSession: DatabaseSessionSnapshot | null;
  replacePassword: boolean;
  isDirty: boolean;
  pending: PendingState;
  hasStoredSecret: boolean;
  canSave: boolean;
  canTest: boolean;
  canConnect: boolean;
  canDisconnect: boolean;
  canDelete: boolean;
  selectConnection: (connectionId: string | null) => void;
  activateConnection: (connectionId: string) => Promise<void>;
  createConnection: () => void;
  updateDraft: <Key extends keyof ConnectionDraft>(key: Key, value: ConnectionDraft[Key]) => void;
  setReplacePassword: (enabled: boolean) => void;
  saveSelectedConnection: () => Promise<void>;
  testSelectedConnection: () => Promise<void>;
  connectSelectedConnection: () => Promise<void>;
  disconnectSelectedConnection: () => Promise<void>;
  deleteSelectedConnection: () => Promise<void>;
};

export function useConnectionWorkspace({ bootstrap, onError }: UseConnectionWorkspaceArgs): ConnectionWorkspaceState {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [loadedDetails, setLoadedDetails] = useState<ConnectionDetails | null>(null);
  const [draft, setDraft] = useState<ConnectionDraft>(EMPTY_DRAFT);
  const [replacePassword, setReplacePassword] = useState(false);
  const [latestTestResult, setLatestTestResult] = useState<ConnectionTestResult | null>(null);
  const [activeSession, setActiveSession] = useState<DatabaseSessionSnapshot | null>(null);
  const [connectingConnectionId, setConnectingConnectionId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingState>({
    loadingDetails: false,
    saving: false,
    testing: false,
    connecting: false,
    disconnecting: false,
    deleting: false,
  });
  const latestActivationIdRef = useRef(0);

  const loadedDraft = loadedDetails ? detailsToDraft(loadedDetails) : EMPTY_DRAFT;
  const draftErrors = validateDraft(draft);
  const hasDraftErrors = Object.keys(draftErrors).length > 0;
  const hasStoredSecret = loadedDetails?.hasStoredSecret ?? false;
  const passwordValue = draft.password?.trim() ?? '';
  const hasUnsavedReplacementPassword = replacePassword && passwordValue.length > 0;
  const isDirty =
    selectedConnectionId === null
      ? hasAnyDraftValue(draft)
      : !areConnectionDraftsEqual(draft, loadedDraft) || hasUnsavedReplacementPassword;
  const hasCredentialsForTest =
    passwordValue.length > 0 || (selectedConnectionId !== null && hasStoredSecret && !replacePassword);
  const isBusy = Object.values(pending).some(Boolean);

  function selectConnection(connectionId: string | null) {
    setSelectedConnectionId(connectionId);
    setLatestTestResult(null);
  }

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    setConnections(bootstrap.savedConnections);
    setActiveSession(bootstrap.activeSession);

    const nextSelection = bootstrap.selectedConnectionId ?? bootstrap.savedConnections[0]?.id ?? null;
    setSelectedConnectionId(nextSelection);
  }, [bootstrap]);

  useEffect(() => {
    if (!selectedConnectionId) {
      setLoadedDetails(null);
      setDraft(EMPTY_DRAFT);
      setReplacePassword(false);
      return;
    }

    let cancelled = false;
    setPending((current) => ({ ...current, loadingDetails: true }));

    getSavedConnection(selectedConnectionId)
      .then((details) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setLoadedDetails(details);
          setDraft(detailsToDraft(details));
          setReplacePassword(false);
        });
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }

        onError(logger.asAppError(caught, 'get_saved_connection'));
      })
      .finally(() => {
        if (!cancelled) {
          setPending((current) => ({ ...current, loadingDetails: false }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onError, selectedConnectionId]);

  async function refreshConnections(preferredSelection: string | null) {
    const nextConnections = await listSavedConnections();
    const nextSelection =
      preferredSelection && nextConnections.some((entry) => entry.id === preferredSelection)
        ? preferredSelection
        : nextConnections[0]?.id ?? null;

    startTransition(() => {
      setConnections(nextConnections);
      setSelectedConnectionId(nextSelection);
    });
  }

  function createConnection() {
    startTransition(() => {
      setSelectedConnectionId(null);
      setLoadedDetails(null);
      setDraft(EMPTY_DRAFT);
      setReplacePassword(false);
      setLatestTestResult(null);
    });
  }

  function updateDraft<Key extends keyof ConnectionDraft>(key: Key, value: ConnectionDraft[Key]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveSelectedConnection() {
    setPending((current) => ({ ...current, saving: true }));

    try {
      const saved = await saveConnection({
        id: selectedConnectionId,
        draft: {
          ...draft,
          password: passwordForSave({
            password: draft.password,
            hasStoredSecret,
            replacePassword,
            selectedConnectionId,
          }),
        },
      });

      await refreshConnections(saved.id);
      setLoadedDetails(saved);
      setDraft(detailsToDraft(saved));
      setReplacePassword(false);
    } catch (caught) {
      onError(logger.asAppError(caught, 'save_connection'));
    } finally {
      setPending((current) => ({ ...current, saving: false }));
    }
  }

  async function testSelectedConnection() {
    setPending((current) => ({ ...current, testing: true }));

    try {
      const request = {
        connectionId: selectedConnectionId,
        draft: {
          ...draft,
          password: passwordValue.length > 0 ? passwordValue : null,
        },
      } as Parameters<typeof testConnection>[0];
      const result = await testConnection(request);

      setLatestTestResult(result);

      if (selectedConnectionId) {
        await refreshConnections(selectedConnectionId);
      }
    } catch (caught) {
      onError(logger.asAppError(caught, 'test_connection'));
    } finally {
      setPending((current) => ({ ...current, testing: false }));
    }
  }

  async function connectSelectedConnection() {
    if (!selectedConnectionId) {
      return;
    }

    await connectConnection(selectedConnectionId);
  }

  async function connectConnection(connectionId: string) {
    const activationId = latestActivationIdRef.current + 1;
    latestActivationIdRef.current = activationId;
    setPending((current) => ({ ...current, connecting: true }));
    setSelectedConnectionId(connectionId);
    setConnectingConnectionId(connectionId);

    try {
      const session =
        activeSession?.connectionId === connectionId ? activeSession : await connectSavedConnection(connectionId);
      if (latestActivationIdRef.current !== activationId) {
        return;
      }

      setActiveSession(session);
      await refreshConnections(connectionId);
    } catch (caught) {
      if (latestActivationIdRef.current !== activationId) {
        return;
      }

      onError(logger.asAppError(caught, 'connect_saved_connection'));
    } finally {
      if (latestActivationIdRef.current === activationId) {
        setPending((current) => ({ ...current, connecting: false }));
        setConnectingConnectionId(null);
      }
    }
  }

  async function disconnectSelectedConnection() {
    setPending((current) => ({ ...current, disconnecting: true }));

    try {
      const result = await disconnectActiveConnection();
      setActiveSession((current) => (current?.connectionId === result.connectionId ? null : current));
    } catch (caught) {
      onError(logger.asAppError(caught, 'disconnect_active_connection'));
    } finally {
      setPending((current) => ({ ...current, disconnecting: false }));
    }
  }

  async function deleteSelectedConnection() {
    if (!selectedConnectionId) {
      return;
    }

    setPending((current) => ({ ...current, deleting: true }));

    try {
      const result = await deleteSavedConnection(selectedConnectionId);
      if (result.disconnected) {
        setActiveSession(null);
      }

      setLatestTestResult(null);
      await refreshConnections(null);
      createConnection();
    } catch (caught) {
      onError(logger.asAppError(caught, 'delete_saved_connection'));
    } finally {
      setPending((current) => ({ ...current, deleting: false }));
    }
  }

  return {
    connections,
    selectedConnectionId,
    connectingConnectionId,
    loadedDetails,
    draft,
    draftErrors,
    latestTestResult,
    activeSession,
    replacePassword,
    isDirty,
    pending,
    hasStoredSecret,
    canSave: !hasDraftErrors && !isBusy,
    canTest: !hasDraftErrors && !isBusy && hasCredentialsForTest,
    canConnect: Boolean(selectedConnectionId) && !isBusy && !isDirty,
    canDisconnect: Boolean(activeSession) && !isBusy,
    canDelete: Boolean(selectedConnectionId) && !isBusy,
    selectConnection,
    activateConnection: connectConnection,
    createConnection,
    updateDraft,
    setReplacePassword,
    saveSelectedConnection,
    testSelectedConnection,
    connectSelectedConnection,
    disconnectSelectedConnection,
    deleteSelectedConnection,
  };
}

function detailsToDraft(details: ConnectionDetails): ConnectionDraft {
  return {
    name: details.name,
    host: details.host,
    port: details.port,
    database: details.database,
    username: details.username,
    sslMode: details.sslMode,
    password: null,
  };
}

function validateDraft(draft: ConnectionDraft): DraftErrors {
  const errors: DraftErrors = {};

  if (draft.name.trim().length === 0) {
    errors.name = 'Connection name is required.';
  }

  if (draft.host.trim().length === 0) {
    errors.host = 'Host is required.';
  }

  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) {
    errors.port = 'Port must be between 1 and 65535.';
  }

  if (draft.database.trim().length === 0) {
    errors.database = 'Database name is required.';
  }

  if (draft.username.trim().length === 0) {
    errors.username = 'Username is required.';
  }

  return errors;
}

function normalizePassword(password: string | null): string | null {
  const nextPassword = password?.trim() ?? '';
  return nextPassword.length > 0 ? nextPassword : null;
}

function passwordForSave({
  password,
  hasStoredSecret,
  replacePassword,
  selectedConnectionId,
}: {
  password: string | null;
  hasStoredSecret: boolean;
  replacePassword: boolean;
  selectedConnectionId: string | null;
}): string | null {
  const normalizedPassword = normalizePassword(password);
  if (normalizedPassword === null) {
    return null;
  }

  if (selectedConnectionId === null) {
    return normalizedPassword;
  }

  if (!hasStoredSecret || replacePassword) {
    return normalizedPassword;
  }

  return null;
}

function areConnectionDraftsEqual(left: ConnectionDraft, right: ConnectionDraft): boolean {
  return (
    left.name === right.name &&
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database &&
    left.username === right.username &&
    left.sslMode === right.sslMode
  );
}

function hasAnyDraftValue(draft: ConnectionDraft): boolean {
  return (
    draft.name.trim().length > 0 ||
    draft.host.trim().length > 0 ||
    draft.database.trim().length > 0 ||
    draft.username.trim().length > 0 ||
    normalizePassword(draft.password) !== null ||
    draft.port !== EMPTY_DRAFT.port ||
    draft.sslMode !== EMPTY_DRAFT.sslMode
  );
}
