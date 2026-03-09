export const BACKGROUND_JOB_EVENT = 'foundation://job-progress';

export type AppEnvironment = 'development' | 'production' | 'test';

export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export type SecretRef = {
  provider: 'os-keychain';
  service: string;
  account: string;
};

export type ConnectionProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: 'disable' | 'prefer' | 'require';
  secretRef: SecretRef | null;
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function isAppError(value: unknown): value is AppError {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    (typeof value.detail === 'string' || value.detail === null) &&
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
    typeof value.sampleData.schemaCacheEntries === 'number'
  );
}
