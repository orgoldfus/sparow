import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const port = 4174;
const url = `http://127.0.0.1:${port}/?harness=results`;
const screenshotPath = resolve(process.cwd(), 'artifacts', 'result-viewer-smoke.png');
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
      viewport: { width: 1440, height: 1024 },
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('result-viewer-harness').waitFor();
    await page.getByTestId('harness-scenario-select').selectOption('large-complete');
    await page.getByTestId('query-result-grid-scroll').evaluate((element) => {
      element.scrollTop = 2_400;
      element.dispatchEvent(new Event('scroll'));
    });
    await page.getByTestId('result-quick-filter').fill('customer-011');
    await page.getByTestId('result-column-0').click();
    await page.getByTestId('result-export-path').fill('./smoke-results.csv');
    await page.getByTestId('result-export-button').click();
    await page.getByTestId('cancel-result-export-button').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
  } finally {
    await browser.close();
  }

  console.log(`Results browser smoke screenshot written to ${screenshotPath}`);
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

  if (typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // The process group may already be gone.
    }
  } else {
    child.kill('SIGTERM');
  }
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
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

    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise(undefined);
    });
  });
}
