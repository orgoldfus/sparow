import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const port = 4175;
const url = `http://127.0.0.1:${port}/?harness=shell`;
const screenshotPath = resolve(process.cwd(), 'artifacts', 'shell-harness-smoke.png');
const viteExecutable =
  process.platform === 'win32'
    ? resolve(process.cwd(), 'node_modules', '.bin', 'vite.cmd')
    : resolve(process.cwd(), 'node_modules', '.bin', 'vite');

const devServer = spawn(viteExecutable, ['--host', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
  detached: true,
});

let serverOutput = '';
let devServerError = null;
devServer.once('error', (error) => {
  devServerError = error;
  serverOutput += `\n${error.stack ?? String(error)}`;
});
devServer.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
devServer.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer(url, 20_000);
  await mkdir(resolve(process.cwd(), 'artifacts'), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1020 },
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('shell-harness').waitFor();
    await page.getByTestId('connection-row-conn-local').click();
    await page.getByTestId('query-result-grid-scroll').evaluate((element) => {
      element.scrollTop = 1400;
      element.dispatchEvent(new Event('scroll'));
    });
    await page.getByTestId('result-quick-filter').fill('sarah');
    await page.getByTestId('connection-row-conn-staging').click({ button: 'right' });
    await page.getByTestId('connection-context-menu').waitFor({ state: 'visible' });
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
  } finally {
    await browser.close();
  }

  console.log(`Shell harness smoke screenshot written to ${screenshotPath}`);
} catch (error) {
  if (String(error).toLowerCase().includes('executable')) {
    throw new Error(
      `Playwright Chromium is unavailable. Install it with "npx playwright install chromium".\n\n${String(error)}`,
    );
  }

  throw error;
} finally {
  await stopProcess(devServer);
}

async function waitForServer(targetUrl, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (devServerError !== null) {
      throw new Error(`Failed to start ui:harness.\n\n${serverOutput}`);
    }
    if (devServer.exitCode !== null) {
      throw new Error(`ui:harness exited early.\n\n${serverOutput}`);
    }

    try {
      const response = await fetch(targetUrl, { redirect: 'manual' });
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 250);
    });
  }

  throw new Error(`Timed out waiting for ${targetUrl}.\n\n${serverOutput}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise((resolvePromise) => {
    let timeout;
    const resolveIfStopped = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolvePromise(undefined);
    };

    child.once('exit', resolveIfStopped);
    if (child.exitCode !== null) {
      child.off('exit', resolveIfStopped);
      resolvePromise(undefined);
      return;
    }

    if (typeof child.pid === 'number') {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    } else {
      child.kill('SIGTERM');
    }

    timeout = setTimeout(() => {
      if (child.exitCode === null) {
        if (typeof child.pid === 'number') {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
      }
    }, 2_000);
  });
}
