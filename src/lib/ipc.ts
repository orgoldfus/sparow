import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  type AppBootstrap,
  type BackgroundJobAccepted,
  type BackgroundJobProgressEvent,
  type BackgroundJobRequest,
  isAppBootstrap,
  isBackgroundJobAccepted,
  isBackgroundJobProgressEvent,
} from './contracts';

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

export async function bootstrapApp(): Promise<AppBootstrap> {
  const payload = await invoke<unknown>('bootstrap_app');
  return assertContract(isAppBootstrap, payload, 'bootstrap_app');
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
