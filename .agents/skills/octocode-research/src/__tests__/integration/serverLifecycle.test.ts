/**
 * Integration test: detached daemon lifecycle.
 *
 * Spawns server-init.js on a reserved test port, verifies that:
 * 1. init exits after server is healthy (detached daemon behavior)
 * 2. server survives init exit
 * 3. second init detects running server and exits immediately
 * 4. PID file is created on startup and removed on shutdown
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createServer } from 'net';

const SCRIPTS_DIR = join(import.meta.dirname, '..', '..', '..', 'scripts');
const SERVER_INIT_SCRIPT = join(SCRIPTS_DIR, 'server-init.js');
const OCTOCODE_DIR = process.env.OCTOCODE_HOME || join(homedir(), '.octocode');

let testPort: number | null = null;

function requireTestPort(): number {
  if (testPort === null) {
    throw new Error('Test port has not been reserved.');
  }

  return testPort;
}

function getHealthUrl(port: number): string {
  return `http://localhost:${port}/health`;
}

function getPidFile(port: number): string {
  return join(OCTOCODE_DIR, `research-server-${port}.pid`);
}

async function reserveTestPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to reserve a test port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function pollHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = getHealthUrl(requireTestPort());

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = (await res.json()) as { status: string };
        if (body.status === 'ok') {
          return true;
        }
      }
    } catch {
      // not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function isServerDown(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = getHealthUrl(requireTestPort());

  while (Date.now() < deadline) {
    try {
      await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
    } catch {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

function spawnInitScript(): ChildProcess {
  const port = requireTestPort();

  return spawn('node', [SERVER_INIT_SCRIPT], {
    env: {
      ...process.env,
      OCTOCODE_PORT: String(port),
      OCTOCODE_RESEARCH_PORT: String(port),
    },
    stdio: 'pipe',
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopSpawnedServer(pidFile: string): Promise<void> {
  if (!existsSync(pidFile)) {
    return;
  }

  const pidContent = readFileSync(pidFile, 'utf-8').trim();
  const pid = Number.parseInt(pidContent, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (isProcessRunning(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return;
    }
  }
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
    proc.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

describe('Server Lifecycle (Detached Daemon)', () => {
  let initProc: ChildProcess | null = null;

  beforeEach(async () => {
    testPort = await reserveTestPort();
  });

  afterEach(async () => {
    if (initProc && initProc.exitCode === null && initProc.signalCode === null) {
      initProc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            initProc?.kill('SIGKILL');
          } catch {
            // already dead
          }
          resolve();
        }, 5_000);
        initProc!.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    initProc = null;
    if (testPort !== null) {
      await stopSpawnedServer(getPidFile(testPort));
      testPort = null;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('init exits after server is healthy and server survives', async () => {
    initProc = spawnInitScript();

    let initOutput = '';
    initProc.stdout?.on('data', (chunk: Buffer) => {
      initOutput += chunk.toString();
    });
    initProc.stderr?.on('data', (chunk: Buffer) => {
      initOutput += chunk.toString();
    });

    const exitCode = await waitForExit(initProc, 45_000);
    expect(exitCode, `Init should exit 0. Output:\n${initOutput}`).toBe(0);
    expect(initOutput).toContain('ok');

    const serverAlive = await pollHealth(5_000);
    expect(serverAlive, 'Server should survive init exit (detached daemon)').toBe(true);

    const healthRes = await fetch(getHealthUrl(requireTestPort()), {
      signal: AbortSignal.timeout(3_000),
    });
    const healthBody = (await healthRes.json()) as {
      status: string;
      port: number;
      processManager: string;
      pid: number;
    };
    expect(healthBody.status).toBe('ok');
    expect(healthBody.port).toBe(requireTestPort());
    expect(healthBody.processManager).toContain('detached');
    expect(healthBody.pid).toBeGreaterThan(0);
  }, 60_000);

  it('init exits immediately when server is already running', async () => {
    initProc = spawnInitScript();

    let output1 = '';
    initProc.stdout?.on('data', (chunk: Buffer) => {
      output1 += chunk.toString();
    });

    const exitCode1 = await waitForExit(initProc, 45_000);
    expect(exitCode1, `First init should exit 0. Output:\n${output1}`).toBe(0);

    const ready = await pollHealth(5_000);
    expect(ready, 'Server should be running').toBe(true);

    const secondInit = spawnInitScript();

    let output2 = '';
    secondInit.stdout?.on('data', (chunk: Buffer) => {
      output2 += chunk.toString();
    });

    const exitCode2 = await waitForExit(secondInit, 15_000);
    expect(exitCode2, `Second init should exit 0 (fast path). Output:\n${output2}`).toBe(0);
    expect(output2).toContain('ok');

    const stillAlive = await pollHealth(3_000);
    expect(stillAlive).toBe(true);
  }, 60_000);

  it('PID file is created on startup and cleaned up on shutdown', async () => {
    initProc = spawnInitScript();

    let initOutput = '';
    initProc.stdout?.on('data', (chunk: Buffer) => {
      initOutput += chunk.toString();
    });

    const exitCode = await waitForExit(initProc, 45_000);
    expect(exitCode, `Init should exit 0. Output:\n${initOutput}`).toBe(0);

    const pidFile = getPidFile(requireTestPort());
    expect(existsSync(pidFile), 'PID file should exist after server starts').toBe(true);

    const pidContent = readFileSync(pidFile, 'utf-8').trim();
    const pid = Number.parseInt(pidContent, 10);
    expect(pid).toBeGreaterThan(0);

    const healthRes = await fetch(getHealthUrl(requireTestPort()), {
      signal: AbortSignal.timeout(3_000),
    });
    const healthBody = (await healthRes.json()) as { pid: number };
    expect(pid).toBe(healthBody.pid);

    process.kill(pid, 'SIGTERM');

    const serverDead = await isServerDown(10_000);
    expect(serverDead, 'Server should stop after SIGTERM').toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(existsSync(pidFile), 'PID file should be removed on shutdown').toBe(false);
  }, 60_000);
});
