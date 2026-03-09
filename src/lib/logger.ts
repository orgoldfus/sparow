import type { AppError } from './contracts';

function createCorrelationId(): string {
  if ('randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `web-${Date.now()}`;
}

function toErrorDetail(value: unknown): string | null {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return 'Unable to serialize error detail.';
    }
  }

  return null;
}

export const logger = {
  info(scope: string, message: string, detail?: unknown) {
    console.info(`[${scope}] ${message}`, detail);
  },

  error(scope: string, message: string, detail?: unknown) {
    console.error(`[${scope}] ${message}`, detail);
  },

  asAppError(value: unknown, code: string): AppError {
    if (value && typeof value === 'object' && 'code' in value && 'message' in value) {
      const maybeError = value as Partial<AppError>;

      if (typeof maybeError.code === 'string' && typeof maybeError.message === 'string') {
        return {
          code: maybeError.code,
          message: maybeError.message,
          detail: typeof maybeError.detail === 'string' ? maybeError.detail : null,
          retryable: typeof maybeError.retryable === 'boolean' ? maybeError.retryable : false,
          correlationId:
            typeof maybeError.correlationId === 'string' ? maybeError.correlationId : createCorrelationId(),
        };
      }
    }

    return {
      code,
      message: value instanceof Error ? value.message : 'Unknown application error.',
      detail: toErrorDetail(value),
      retryable: false,
      correlationId: createCorrelationId(),
    };
  },
};
