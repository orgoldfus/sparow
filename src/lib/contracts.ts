export const BACKGROUND_JOB_EVENT = 'foundation://job-progress';
export const SCHEMA_REFRESH_EVENT = 'schema://refresh-progress';
export const QUERY_EXECUTION_EVENT = 'query://execution-progress';

export type AppEnvironment = 'development' | 'production' | 'test';
export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
export type DatabaseEngine = 'postgresql';
export type SecretProvider = 'os-keychain' | 'memory';
export type SslMode = 'disable' | 'prefer' | 'require' | 'insecure';
export type SchemaNodeKind = 'schema' | 'table' | 'view' | 'column' | 'index';
export type SchemaScopeKind = 'root' | 'schema' | 'table' | 'view';
export type SchemaCacheStatus = 'empty' | 'fresh' | 'stale';
export type SchemaRefreshStatus = 'queued' | 'running' | 'completed' | 'failed';
export type QueryExecutionOrigin = 'selection' | 'current-statement';
export type QueryExecutionStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

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

export type SchemaNodeBase = {
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

export type QueryResultColumn = {
  name: string;
  postgresType: string;
};

export type QueryRowsResult = {
  kind: 'rows';
  columns: QueryResultColumn[];
  previewRows: (string | null)[][];
  previewRowCount: number;
  truncated: boolean;
};

export type QueryCommandResult = {
  kind: 'command';
  commandTag: string;
  rowsAffected: number | null;
};

export type QueryExecutionResult = QueryRowsResult | QueryCommandResult;

export type QueryExecutionRequest = {
  tabId: string;
  connectionId: string;
  sql: string;
  origin: QueryExecutionOrigin;
  isSelectionMultiStatement: boolean;
};

export type QueryExecutionAccepted = {
  jobId: string;
  correlationId: string;
  tabId: string;
  connectionId: string;
  startedAt: string;
};

export type QueryExecutionProgressEvent = {
  jobId: string;
  correlationId: string;
  tabId: string;
  connectionId: string;
  status: QueryExecutionStatus;
  elapsedMs: number;
  message: string;
  startedAt: string;
  finishedAt: string | null;
  lastError: AppError | null;
  result: QueryExecutionResult | null;
};

export type CancelQueryExecutionResult = {
  jobId: string;
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
