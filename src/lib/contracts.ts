export const BACKGROUND_JOB_EVENT = 'foundation://job-progress';
export const SCHEMA_REFRESH_EVENT = 'schema://refresh-progress';

export type AppEnvironment = 'development' | 'production' | 'test';
export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
export type DatabaseEngine = 'postgresql';
export type SecretProvider = 'os-keychain' | 'memory';
export type SslMode = 'disable' | 'prefer' | 'require';
export type SchemaNodeKind = 'schema' | 'table' | 'view' | 'column' | 'index';
export type SchemaScopeKind = 'root' | 'schema' | 'table' | 'view';
export type SchemaCacheStatus = 'empty' | 'fresh' | 'stale';
export type SchemaRefreshStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ConnectionSummary = {
  id: string;
  engine: DatabaseEngine;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  hasStoredSecret: boolean;
  secretProvider: SecretProvider | null;
  lastTestedAt: string | null;
  lastConnectedAt: string | null;
  updatedAt: string;
};

export type ConnectionDetails = ConnectionSummary & {
  createdAt: string;
};

export type ConnectionDraft = {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  password: string | null;
};

export type SaveConnectionRequest = {
  id: string | null;
  draft: ConnectionDraft;
};

export type TestConnectionRequest = {
  connectionId: string | null;
  draft: ConnectionDraft;
};

export type ConnectionTestResult = {
  testedAt: string;
  status: 'success' | 'failure';
  summaryMessage: string;
  serverVersion: string | null;
  currentDatabase: string | null;
  currentUser: string | null;
  sslInUse: boolean | null;
  roundTripMs: number | null;
  error: AppError | null;
};

export type DatabaseSessionSnapshot = {
  connectionId: string;
  name: string;
  engine: DatabaseEngine;
  database: string;
  username: string;
  host: string;
  port: number;
  connectedAt: string;
  serverVersion: string | null;
  sslInUse: boolean | null;
  status: 'connected';
};

export type DeleteConnectionResult = {
  id: string;
  disconnected: boolean;
};

export type DisconnectSessionResult = {
  connectionId: string | null;
};

export type HistoryEntry = {
  id: string;
  sql: string;
  connectionProfileId: string | null;
  createdAt: string;
};

export type SavedQuery = {
  id: string;
  title: string;
  sql: string;
  tags: string[];
  updatedAt: string;
};

export type SchemaCacheEntry = {
  id: string;
  connectionProfileId: string;
  objectKind: 'schema' | 'table' | 'view' | 'column' | 'index';
  objectPath: string;
  payloadJson: string;
  refreshedAt: string;
};

type SchemaNodeBase = {
  id: string;
  connectionId: string;
  kind: SchemaNodeKind;
  name: string;
  path: string;
  parentPath: string | null;
  schemaName: string;
  relationName: string | null;
  hasChildren: boolean;
  refreshedAt: string;
};

export type SchemaSchemaNode = SchemaNodeBase & {
  kind: 'schema';
  relationName: null;
  hasChildren: true;
};

export type SchemaRelationNode = SchemaNodeBase & {
  kind: 'table' | 'view';
  relationName: string;
};

export type SchemaColumnNode = SchemaNodeBase & {
  kind: 'column';
  relationName: string;
  hasChildren: false;
  dataType: string;
  isNullable: boolean;
  ordinalPosition: number;
};

export type SchemaIndexNode = SchemaNodeBase & {
  kind: 'index';
  relationName: string;
  hasChildren: false;
  columnNames: string[];
  isUnique: boolean;
};

export type SchemaNode = SchemaSchemaNode | SchemaRelationNode | SchemaColumnNode | SchemaIndexNode;

export type ListSchemaChildrenRequest = {
  connectionId: string;
  parentKind: SchemaScopeKind;
  parentPath: string | null;
};

export type ListSchemaChildrenResult = {
  connectionId: string;
  parentKind: SchemaScopeKind;
  parentPath: string | null;
  cacheStatus: SchemaCacheStatus;
  refreshInFlight: boolean;
  refreshedAt: string | null;
  nodes: SchemaNode[];
};

export type RefreshSchemaScopeRequest = {
  connectionId: string;
  scopeKind: SchemaScopeKind;
  scopePath: string | null;
};

export type SchemaRefreshAccepted = {
  jobId: string;
  correlationId: string;
  connectionId: string;
  scopeKind: SchemaScopeKind;
  scopePath: string | null;
  startedAt: string;
};

export type SchemaRefreshProgressEvent = {
  jobId: string;
  correlationId: string;
  connectionId: string;
  scopeKind: SchemaScopeKind;
  scopePath: string | null;
  status: SchemaRefreshStatus;
  nodesWritten: number;
  message: string;
  timestamp: string;
  lastError: AppError | null;
};

export type SchemaSearchRequest = {
  connectionId: string;
  query: string;
  limit: number;
};

export type SchemaSearchResult = {
  connectionId: string;
  query: string;
  nodes: SchemaNode[];
};

export type AppError = {
  code: string;
  message: string;
  detail: string | null;
  retryable: boolean;
  correlationId: string;
};

export type BackgroundJobRequest = {
  label: string;
  steps: number;
  delayMs: number;
};

export type BackgroundJobAccepted = {
  jobId: string;
  correlationId: string;
  startedAt: string;
};

export type BackgroundJobProgressEvent = {
  jobId: string;
  correlationId: string;
  status: BackgroundJobStatus;
  step: number;
  totalSteps: number;
  message: string;
  timestamp: string;
  lastError: AppError | null;
};

export type AppBootstrap = {
  appName: string;
  version: string;
  environment: AppEnvironment;
  platform: string;
  featureFlags: string[];
  storage: {
    databasePath: string;
    logFilePath: string;
  };
  diagnostics: {
    lastError: AppError | null;
    recentEvents: BackgroundJobProgressEvent[];
  };
  sampleData: {
    historyEntries: number;
    savedQueries: number;
    schemaCacheEntries: number;
  };
  savedConnections: ConnectionSummary[];
  selectedConnectionId: string | null;
  activeSession: DatabaseSessionSnapshot | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isDatabaseEngine(value: unknown): value is DatabaseEngine {
  return value === 'postgresql';
}

function isSchemaNodeKind(value: unknown): value is SchemaNodeKind {
  return value === 'schema' || value === 'table' || value === 'view' || value === 'column' || value === 'index';
}

function isSchemaScopeKind(value: unknown): value is SchemaScopeKind {
  return value === 'root' || value === 'schema' || value === 'table' || value === 'view';
}

function isSchemaCacheStatus(value: unknown): value is SchemaCacheStatus {
  return value === 'empty' || value === 'fresh' || value === 'stale';
}

function isSchemaRefreshStatus(value: unknown): value is SchemaRefreshStatus {
  return value === 'queued' || value === 'running' || value === 'completed' || value === 'failed';
}

function isSecretProvider(value: unknown): value is SecretProvider {
  return value === 'os-keychain' || value === 'memory';
}

function isSslMode(value: unknown): value is SslMode {
  return value === 'disable' || value === 'prefer' || value === 'require';
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return typeof value === 'boolean' || value === null;
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === 'number' || value === null;
}

function isScopePathForKind(kind: SchemaScopeKind, path: unknown): path is string | null {
  return kind === 'root' ? path === null : typeof path === 'string';
}

function isConnectionShape(value: unknown): value is Omit<ConnectionSummary, 'updatedAt'> & { updatedAt?: string } {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isDatabaseEngine(value.engine) &&
    typeof value.name === 'string' &&
    typeof value.host === 'string' &&
    typeof value.port === 'number' &&
    typeof value.database === 'string' &&
    typeof value.username === 'string' &&
    isSslMode(value.sslMode) &&
    typeof value.hasStoredSecret === 'boolean' &&
    (value.secretProvider === null || isSecretProvider(value.secretProvider)) &&
    isNullableString(value.lastTestedAt) &&
    isNullableString(value.lastConnectedAt)
  );
}

export function isAppError(value: unknown): value is AppError {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    isNullableString(value.detail) &&
    typeof value.retryable === 'boolean' &&
    typeof value.correlationId === 'string'
  );
}

export function isBackgroundJobAccepted(value: unknown): value is BackgroundJobAccepted {
  return (
    isRecord(value) &&
    typeof value.jobId === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.startedAt === 'string'
  );
}

export function isBackgroundJobProgressEvent(value: unknown): value is BackgroundJobProgressEvent {
  return (
    isRecord(value) &&
    typeof value.jobId === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.step === 'number' &&
    typeof value.totalSteps === 'number' &&
    typeof value.message === 'string' &&
    typeof value.timestamp === 'string' &&
    (value.lastError === null || isAppError(value.lastError))
  );
}

export function isConnectionSummary(value: unknown): value is ConnectionSummary {
  return isConnectionShape(value) && typeof value.updatedAt === 'string';
}

export function isConnectionDetails(value: unknown): value is ConnectionDetails {
  return isConnectionSummary(value) && typeof value.createdAt === 'string';
}

export function isConnectionDraft(value: unknown): value is ConnectionDraft {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.host === 'string' &&
    typeof value.port === 'number' &&
    typeof value.database === 'string' &&
    typeof value.username === 'string' &&
    isSslMode(value.sslMode) &&
    isNullableString(value.password)
  );
}

export function isSaveConnectionRequest(value: unknown): value is SaveConnectionRequest {
  return (
    isRecord(value) &&
    (typeof value.id === 'string' || value.id === null) &&
    isConnectionDraft(value.draft)
  );
}

export function isTestConnectionRequest(value: unknown): value is TestConnectionRequest {
  return (
    isRecord(value) &&
    (typeof value.connectionId === 'string' || value.connectionId === null) &&
    isConnectionDraft(value.draft)
  );
}

export function isConnectionTestResult(value: unknown): value is ConnectionTestResult {
  return (
    isRecord(value) &&
    typeof value.testedAt === 'string' &&
    (value.status === 'success' || value.status === 'failure') &&
    typeof value.summaryMessage === 'string' &&
    isNullableString(value.serverVersion) &&
    isNullableString(value.currentDatabase) &&
    isNullableString(value.currentUser) &&
    isNullableBoolean(value.sslInUse) &&
    isNullableNumber(value.roundTripMs) &&
    (value.error === null || isAppError(value.error))
  );
}

export function isDatabaseSessionSnapshot(value: unknown): value is DatabaseSessionSnapshot {
  return (
    isRecord(value) &&
    typeof value.connectionId === 'string' &&
    typeof value.name === 'string' &&
    isDatabaseEngine(value.engine) &&
    typeof value.database === 'string' &&
    typeof value.username === 'string' &&
    typeof value.host === 'string' &&
    typeof value.port === 'number' &&
    typeof value.connectedAt === 'string' &&
    isNullableString(value.serverVersion) &&
    isNullableBoolean(value.sslInUse) &&
    value.status === 'connected'
  );
}

export function isDeleteConnectionResult(value: unknown): value is DeleteConnectionResult {
  return isRecord(value) && typeof value.id === 'string' && typeof value.disconnected === 'boolean';
}

export function isDisconnectSessionResult(value: unknown): value is DisconnectSessionResult {
  return isRecord(value) && (typeof value.connectionId === 'string' || value.connectionId === null);
}

function isSchemaNodeBase(value: unknown): value is SchemaNodeBase {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.connectionId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    isSchemaNodeKind(value.kind) &&
    (typeof value.parentPath === 'string' || value.parentPath === null) &&
    typeof value.schemaName === 'string' &&
    (typeof value.relationName === 'string' || value.relationName === null) &&
    typeof value.hasChildren === 'boolean' &&
    typeof value.refreshedAt === 'string'
  );
}

export function isSchemaNode(value: unknown): value is SchemaNode {
  if (!isSchemaNodeBase(value)) {
    return false;
  }

  switch (value.kind) {
    case 'schema':
      return value.relationName === null && value.hasChildren === true;
    case 'table':
    case 'view':
      return typeof value.relationName === 'string';
    case 'column':
      return (
        typeof value.relationName === 'string' &&
        value.hasChildren === false &&
        typeof value.dataType === 'string' &&
        typeof value.isNullable === 'boolean' &&
        typeof value.ordinalPosition === 'number'
      );
    case 'index':
      return (
        typeof value.relationName === 'string' &&
        value.hasChildren === false &&
        isStringArray(value.columnNames) &&
        typeof value.isUnique === 'boolean'
      );
    default:
      return false;
  }
}

export function isListSchemaChildrenRequest(value: unknown): value is ListSchemaChildrenRequest {
  return (
    isRecord(value) &&
    typeof value.connectionId === 'string' &&
    isSchemaScopeKind(value.parentKind) &&
    isScopePathForKind(value.parentKind, value.parentPath)
  );
}

export function isListSchemaChildrenResult(value: unknown): value is ListSchemaChildrenResult {
  return (
    isRecord(value) &&
    typeof value.connectionId === 'string' &&
    isSchemaScopeKind(value.parentKind) &&
    isScopePathForKind(value.parentKind, value.parentPath) &&
    isSchemaCacheStatus(value.cacheStatus) &&
    typeof value.refreshInFlight === 'boolean' &&
    isNullableString(value.refreshedAt) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSchemaNode)
  );
}

export function isRefreshSchemaScopeRequest(value: unknown): value is RefreshSchemaScopeRequest {
  return (
    isRecord(value) &&
    typeof value.connectionId === 'string' &&
    isSchemaScopeKind(value.scopeKind) &&
    isScopePathForKind(value.scopeKind, value.scopePath)
  );
}

export function isSchemaRefreshAccepted(value: unknown): value is SchemaRefreshAccepted {
  return (
    isRecord(value) &&
    typeof value.jobId === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.connectionId === 'string' &&
    isSchemaScopeKind(value.scopeKind) &&
    isScopePathForKind(value.scopeKind, value.scopePath) &&
    typeof value.startedAt === 'string'
  );
}

export function isSchemaRefreshProgressEvent(value: unknown): value is SchemaRefreshProgressEvent {
  return (
    isRecord(value) &&
    typeof value.jobId === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.connectionId === 'string' &&
    isSchemaScopeKind(value.scopeKind) &&
    isScopePathForKind(value.scopeKind, value.scopePath) &&
    isSchemaRefreshStatus(value.status) &&
    typeof value.nodesWritten === 'number' &&
    typeof value.message === 'string' &&
    typeof value.timestamp === 'string' &&
    (value.lastError === null || isAppError(value.lastError))
  );
}

export function isSchemaSearchRequest(value: unknown): value is SchemaSearchRequest {
  return (
    isRecord(value) &&
    typeof value.connectionId === 'string' &&
    typeof value.query === 'string' &&
    typeof value.limit === 'number'
  );
}

export function isSchemaSearchResult(value: unknown): value is SchemaSearchResult {
  return (
    isRecord(value) &&
    typeof value.connectionId === 'string' &&
    typeof value.query === 'string' &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSchemaNode)
  );
}

export function isAppBootstrap(value: unknown): value is AppBootstrap {
  return (
    isRecord(value) &&
    typeof value.appName === 'string' &&
    typeof value.version === 'string' &&
    typeof value.environment === 'string' &&
    typeof value.platform === 'string' &&
    isStringArray(value.featureFlags) &&
    isRecord(value.storage) &&
    typeof value.storage.databasePath === 'string' &&
    typeof value.storage.logFilePath === 'string' &&
    isRecord(value.diagnostics) &&
    (value.diagnostics.lastError === null || isAppError(value.diagnostics.lastError)) &&
    Array.isArray(value.diagnostics.recentEvents) &&
    value.diagnostics.recentEvents.every(isBackgroundJobProgressEvent) &&
    isRecord(value.sampleData) &&
    typeof value.sampleData.historyEntries === 'number' &&
    typeof value.sampleData.savedQueries === 'number' &&
    typeof value.sampleData.schemaCacheEntries === 'number' &&
    Array.isArray(value.savedConnections) &&
    value.savedConnections.every(isConnectionSummary) &&
    (typeof value.selectedConnectionId === 'string' || value.selectedConnectionId === null) &&
    (value.activeSession === null || isDatabaseSessionSnapshot(value.activeSession))
  );
}
