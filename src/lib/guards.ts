import type {
  AppBootstrap,
  AppError,
  BackgroundJobAccepted,
  BackgroundJobProgressEvent,
  ConnectionDetails,
  ConnectionDraft,
  ConnectionSummary,
  ConnectionTestResult,
  DatabaseEngine,
  DatabaseSessionSnapshot,
  DeleteConnectionResult,
  DisconnectSessionResult,
  ListSchemaChildrenRequest,
  ListSchemaChildrenResult,
  QueryExecutionAccepted,
  QueryExecutionOrigin,
  QueryExecutionProgressEvent,
  QueryExecutionRequest,
  QueryExecutionResult,
  QueryExecutionStatus,
  QueryResultColumn,
  RefreshSchemaScopeRequest,
  SaveConnectionRequest,
  SchemaCacheStatus,
  SchemaNode,
  SchemaNodeBase,
  SchemaNodeKind,
  SchemaRefreshAccepted,
  SchemaRefreshProgressEvent,
  SchemaRefreshStatus,
  SchemaScopeKind,
  SchemaSearchRequest,
  SchemaSearchResult,
  SecretProvider,
  SslMode,
  TestConnectionRequest,
} from './contracts';

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

function isQueryExecutionOrigin(value: unknown): value is QueryExecutionOrigin {
  return value === 'selection' || value === 'current-statement';
}

function isQueryExecutionStatus(value: unknown): value is QueryExecutionStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'cancelled' ||
    value === 'failed'
  );
}

function isBackgroundJobStatus(value: unknown): value is BackgroundJobProgressEvent['status'] {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'cancelled' ||
    value === 'failed'
  );
}

function isAppEnvironment(value: unknown): value is AppBootstrap['environment'] {
  return value === 'development' || value === 'production' || value === 'test';
}

function isSecretProvider(value: unknown): value is SecretProvider {
  return value === 'os-keychain' || value === 'memory';
}

function isSslMode(value: unknown): value is SslMode {
  return value === 'disable' || value === 'prefer' || value === 'require' || value === 'insecure';
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

function isPreviewCell(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isQueryPreviewRow(value: unknown): value is (string | null)[] {
  return Array.isArray(value) && value.every(isPreviewCell);
}

function isEncodedPathSegment(segment: string): boolean {
  if (segment.length === 0) {
    return false;
  }

  try {
    return decodeURIComponent(segment).length > 0;
  } catch {
    return false;
  }
}

function isScopePathForKind(kind: SchemaScopeKind, path: unknown): path is string | null {
  if (kind === 'root') {
    return path === null;
  }
  if (typeof path !== 'string') {
    return false;
  }

  const parts = path.split('/');
  switch (kind) {
    case 'schema': {
      const [, schemaName] = parts;
      return parts.length === 2 && parts[0] === 'schema' && schemaName !== undefined && isEncodedPathSegment(schemaName);
    }
    case 'table': {
      const [, schemaName, relationName] = parts;
      return (
        parts.length === 3 &&
        parts[0] === 'table' &&
        schemaName !== undefined &&
        relationName !== undefined &&
        isEncodedPathSegment(schemaName) &&
        isEncodedPathSegment(relationName)
      );
    }
    case 'view': {
      const [, schemaName, relationName] = parts;
      return (
        parts.length === 3 &&
        parts[0] === 'view' &&
        schemaName !== undefined &&
        relationName !== undefined &&
        isEncodedPathSegment(schemaName) &&
        isEncodedPathSegment(relationName)
      );
    }
  }
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function isConnectionShape(value: unknown): value is Omit<ConnectionDetails, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
} {
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
    isBackgroundJobStatus(value.status) &&
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
  return isConnectionShape(value) && typeof value.updatedAt === 'string' && typeof value.createdAt === 'string';
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

function isSchemaPath(schemaName: string, path: string): boolean {
  return path === `schema/${encodePathSegment(schemaName)}`;
}

function isRelationPath(
  kind: 'table' | 'view',
  schemaName: string,
  relationName: string,
  path: string,
  parentPath: string | null,
): boolean {
  return (
    path === `${kind}/${encodePathSegment(schemaName)}/${encodePathSegment(relationName)}` &&
    parentPath === `schema/${encodePathSegment(schemaName)}`
  );
}

function isRelationChildPath(
  kind: 'column' | 'index',
  schemaName: string,
  relationName: string,
  name: string,
  path: string,
  parentPath: string | null,
): boolean {
  const encodedSchemaName = encodePathSegment(schemaName);
  const encodedRelationName = encodePathSegment(relationName);
  const encodedName = encodePathSegment(name);

  if (path !== `${kind}/${encodedSchemaName}/${encodedRelationName}/${encodedName}`) {
    return false;
  }

  return (
    parentPath === `table/${encodedSchemaName}/${encodedRelationName}` ||
    parentPath === `view/${encodedSchemaName}/${encodedRelationName}`
  );
}

function isSchemaNodeChildOfScope(
  node: SchemaNode,
  parentKind: SchemaScopeKind,
  parentPath: string | null,
): boolean {
  switch (parentKind) {
    case 'root':
      return node.kind === 'schema' && node.parentPath === null && parentPath === null;
    case 'schema':
      return (node.kind === 'table' || node.kind === 'view') && node.parentPath === parentPath;
    case 'table':
    case 'view':
      return (node.kind === 'column' || node.kind === 'index') && node.parentPath === parentPath;
  }
}

export function isSchemaNode(value: unknown): value is SchemaNode {
  if (!isSchemaNodeBase(value)) {
    return false;
  }

  const node = value as SchemaNodeBase & Record<string, unknown>;

  switch (value.kind) {
    case 'schema':
      return (
        value.relationName === null &&
        value.hasChildren === true &&
        value.parentPath === null &&
        isSchemaPath(value.schemaName, value.path)
      );
    case 'table':
      return (
        typeof value.relationName === 'string' &&
        isRelationPath('table', value.schemaName, value.relationName, value.path, value.parentPath)
      );
    case 'view':
      return (
        typeof value.relationName === 'string' &&
        isRelationPath('view', value.schemaName, value.relationName, value.path, value.parentPath)
      );
    case 'column':
      return (
        typeof value.relationName === 'string' &&
        value.hasChildren === false &&
        isRelationChildPath(
          'column',
          value.schemaName,
          value.relationName,
          value.name,
          value.path,
          value.parentPath,
        ) &&
        typeof node.dataType === 'string' &&
        typeof node.isNullable === 'boolean' &&
        typeof node.ordinalPosition === 'number'
      );
    case 'index':
      return (
        typeof value.relationName === 'string' &&
        value.hasChildren === false &&
        isRelationChildPath(
          'index',
          value.schemaName,
          value.relationName,
          value.name,
          value.path,
          value.parentPath,
        ) &&
        isStringArray(node.columnNames) &&
        typeof node.isUnique === 'boolean'
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
  if (
    !isRecord(value) ||
    typeof value.connectionId !== 'string' ||
    !isSchemaScopeKind(value.parentKind) ||
    !isScopePathForKind(value.parentKind, value.parentPath) ||
    !isSchemaCacheStatus(value.cacheStatus) ||
    typeof value.refreshInFlight !== 'boolean' ||
    !isNullableString(value.refreshedAt) ||
    !Array.isArray(value.nodes)
  ) {
    return false;
  }

  const { connectionId, parentKind, parentPath, nodes } = value;
  return nodes.every(
    (node) => isSchemaNode(node) && node.connectionId === connectionId && isSchemaNodeChildOfScope(node, parentKind, parentPath),
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
    value.nodes.every((node) => isSchemaNode(node) && node.connectionId === value.connectionId)
  );
}

export function isQueryResultColumn(value: unknown): value is QueryResultColumn {
  return isRecord(value) && typeof value.name === 'string' && typeof value.postgresType === 'string';
}

export function isQueryExecutionResult(value: unknown): value is QueryExecutionResult {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.kind) {
    case 'rows':
      return (
        Array.isArray(value.columns) &&
        value.columns.every(isQueryResultColumn) &&
        Array.isArray(value.previewRows) &&
        value.previewRows.every(isQueryPreviewRow) &&
        typeof value.previewRowCount === 'number' &&
        typeof value.truncated === 'boolean'
      );
    case 'command':
      return typeof value.commandTag === 'string' && isNullableNumber(value.rowsAffected);
    default:
      return false;
  }
}

export function isQueryExecutionRequest(value: unknown): value is QueryExecutionRequest {
  return (
    isRecord(value) &&
    typeof value.tabId === 'string' &&
    typeof value.connectionId === 'string' &&
    typeof value.sql === 'string' &&
    isQueryExecutionOrigin(value.origin) &&
    typeof value.isSelectionMultiStatement === 'boolean'
  );
}

export function isQueryExecutionAccepted(value: unknown): value is QueryExecutionAccepted {
  return (
    isRecord(value) &&
    typeof value.jobId === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.tabId === 'string' &&
    typeof value.connectionId === 'string' &&
    typeof value.startedAt === 'string'
  );
}

export function isQueryExecutionProgressEvent(value: unknown): value is QueryExecutionProgressEvent {
  return (
    isRecord(value) &&
    typeof value.jobId === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.tabId === 'string' &&
    typeof value.connectionId === 'string' &&
    isQueryExecutionStatus(value.status) &&
    typeof value.elapsedMs === 'number' &&
    typeof value.message === 'string' &&
    typeof value.startedAt === 'string' &&
    isNullableString(value.finishedAt) &&
    (value.lastError === null || isAppError(value.lastError)) &&
    (value.result === null || isQueryExecutionResult(value.result))
  );
}

export function isAppBootstrap(value: unknown): value is AppBootstrap {
  return (
    isRecord(value) &&
    typeof value.appName === 'string' &&
    typeof value.version === 'string' &&
    isAppEnvironment(value.environment) &&
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
