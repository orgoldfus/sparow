import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  AppBootstrap,
  BackgroundJobAccepted,
  BackgroundJobProgressEvent,
  BackgroundJobRequest,
  ConnectionDetails,
  ConnectionSummary,
  ConnectionTestResult,
  DatabaseSessionSnapshot,
  DeleteConnectionResult,
  DisconnectSessionResult,
  ListSchemaChildrenRequest,
  ListSchemaChildrenResult,
  CancelQueryExecutionResult,
  QueryExecutionAccepted,
  QueryExecutionProgressEvent,
  QueryExecutionRequest,
  RefreshSchemaScopeRequest,
  SaveConnectionRequest,
  SchemaRefreshAccepted,
  SchemaRefreshProgressEvent,
  SchemaSearchRequest,
  SchemaSearchResult,
  TestConnectionRequest,
} from './contracts';
import {
  isAppBootstrap,
  isBackgroundJobAccepted,
  isBackgroundJobProgressEvent,
  isConnectionDetails,
  isConnectionSummary,
  isConnectionTestResult,
  isDatabaseSessionSnapshot,
  isDeleteConnectionResult,
  isDisconnectSessionResult,
  isListSchemaChildrenResult,
  isQueryExecutionAccepted,
  isQueryExecutionProgressEvent,
  isSchemaRefreshAccepted,
  isSchemaRefreshProgressEvent,
  isSchemaSearchResult,
} from './guards';

type CancelJobResult = {
  jobId: string;
};

function assertContract<T>(
  guard: (value: unknown) => value is T,
  value: unknown,
  commandName: string,
): T {
  if (!guard(value)) {
    throw new Error(`Contract validation failed for ${commandName}.`);
  }

  return value;
}

function assertArrayContract<T>(
  guard: (value: unknown) => value is T,
  value: unknown,
  commandName: string,
): T[] {
  if (!Array.isArray(value) || !value.every(guard)) {
    throw new Error(`Contract validation failed for ${commandName}.`);
  }

  return value;
}

export async function bootstrapApp(): Promise<AppBootstrap> {
  const payload = await invoke<unknown>('bootstrap_app');
  return assertContract(isAppBootstrap, payload, 'bootstrap_app');
}

export async function listSavedConnections(): Promise<ConnectionSummary[]> {
  const payload = await invoke<unknown>('list_saved_connections');
  return assertArrayContract(isConnectionSummary, payload, 'list_saved_connections');
}

export async function getSavedConnection(id: string): Promise<ConnectionDetails> {
  const payload = await invoke<unknown>('get_saved_connection', { id });
  return assertContract(isConnectionDetails, payload, 'get_saved_connection');
}

export async function saveConnection(request: SaveConnectionRequest): Promise<ConnectionDetails> {
  const payload = await invoke<unknown>('save_connection', { request });
  return assertContract(isConnectionDetails, payload, 'save_connection');
}

export async function testConnection(request: TestConnectionRequest): Promise<ConnectionTestResult> {
  const payload = await invoke<unknown>('test_connection', { request });
  return assertContract(isConnectionTestResult, payload, 'test_connection');
}

export async function connectSavedConnection(id: string): Promise<DatabaseSessionSnapshot> {
  const payload = await invoke<unknown>('connect_saved_connection', { id });
  return assertContract(isDatabaseSessionSnapshot, payload, 'connect_saved_connection');
}

export async function disconnectActiveConnection(): Promise<DisconnectSessionResult> {
  const payload = await invoke<unknown>('disconnect_active_connection');
  return assertContract(isDisconnectSessionResult, payload, 'disconnect_active_connection');
}

export async function deleteSavedConnection(id: string): Promise<DeleteConnectionResult> {
  const payload = await invoke<unknown>('delete_saved_connection', { id });
  return assertContract(isDeleteConnectionResult, payload, 'delete_saved_connection');
}

export async function listSchemaChildren(
  request: ListSchemaChildrenRequest,
): Promise<ListSchemaChildrenResult> {
  const payload = await invoke<unknown>('list_schema_children', { request });
  return assertContract(isListSchemaChildrenResult, payload, 'list_schema_children');
}

export async function refreshSchemaScope(
  request: RefreshSchemaScopeRequest,
): Promise<SchemaRefreshAccepted> {
  const payload = await invoke<unknown>('refresh_schema_scope', { request });
  return assertContract(isSchemaRefreshAccepted, payload, 'refresh_schema_scope');
}

export async function searchSchemaCache(request: SchemaSearchRequest): Promise<SchemaSearchResult> {
  const payload = await invoke<unknown>('search_schema_cache', { request });
  return assertContract(isSchemaSearchResult, payload, 'search_schema_cache');
}

export async function startQueryExecution(
  request: QueryExecutionRequest,
): Promise<QueryExecutionAccepted> {
  const payload = await invoke<unknown>('start_query_execution', { request });
  return assertContract(isQueryExecutionAccepted, payload, 'start_query_execution');
}

export async function cancelQueryExecution(jobId: string): Promise<CancelQueryExecutionResult> {
  const payload = await invoke<unknown>('cancel_query_execution', { jobId });
  return assertContract(
    (value): value is CancelQueryExecutionResult =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { jobId?: unknown }).jobId === 'string',
    payload,
    'cancel_query_execution',
  );
}

export async function startMockJob(request: BackgroundJobRequest): Promise<BackgroundJobAccepted> {
  const payload = await invoke<unknown>('start_mock_job', { request });
  return assertContract(isBackgroundJobAccepted, payload, 'start_mock_job');
}

export async function cancelMockJob(jobId: string): Promise<CancelJobResult> {
  return invoke<CancelJobResult>('cancel_mock_job', { jobId });
}

export async function subscribeToEvent(
  eventName: string,
  handler: (payload: BackgroundJobProgressEvent) => void,
): Promise<() => void> {
  return listen<unknown>(eventName, (event) => {
    if (!isBackgroundJobProgressEvent(event.payload)) {
      throw new Error(`Invalid event payload for ${eventName}.`);
    }

    handler(event.payload);
  });
}

export async function subscribeToSchemaRefreshEvent(
  eventName: string,
  handler: (payload: SchemaRefreshProgressEvent) => void,
): Promise<() => void> {
  return listen<unknown>(eventName, (event) => {
    if (!isSchemaRefreshProgressEvent(event.payload)) {
      throw new Error(`Invalid event payload for ${eventName}.`);
    }

    handler(event.payload);
  });
}

export async function subscribeToQueryExecutionEvent(
  eventName: string,
  handler: (payload: QueryExecutionProgressEvent) => void,
): Promise<() => void> {
  return listen<unknown>(eventName, (event) => {
    if (!isQueryExecutionProgressEvent(event.payload)) {
      throw new Error(`Invalid event payload for ${eventName}.`);
    }

    handler(event.payload);
  });
}
