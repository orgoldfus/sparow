import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const port = 4176;
const url = `http://127.0.0.1:${port}/?harness=shell`;
const screenshotPath = resolve(process.cwd(), 'artifacts', 'productivity-harness-smoke.png');
const failureScreenshotPath = resolve(process.cwd(), 'artifacts', 'productivity-harness-smoke.failure.png');
const failureHtmlPath = resolve(process.cwd(), 'artifacts', 'productivity-harness-smoke.failure.html');
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
  const diagnostics = {
    consoleMessages: [],
    pageErrors: [],
  };
  let page = null;

  try {
    page = await browser.newPage({
      viewport: { width: 1600, height: 1020 },
    });
    page.on('console', (message) => {
      diagnostics.consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      diagnostics.pageErrors.push(error.stack ?? error.message);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('shell-harness').waitFor();

    await page.getByTestId('command-palette-launcher').click();
    await page.getByTestId('command-palette-dialog').waitFor();
    await page.getByTestId('command-palette-input').waitFor();
    await page.getByTestId('command-palette-item-saved-saved-query-ops-users').click();
    await waitForQueryTabCount(page, 'Active users', 1);

    await page.getByTestId('new-query-tab-button').click();
    await page.keyboard.press('Control+s');
    await page.getByTestId('save-query-dialog').waitFor();
    await page.getByTestId('save-query-title-input').fill('Harness scratch');
    await page.getByRole('button', { name: /^Save query$/i }).click();

    await page.getByTestId('query-library-launcher').click();
    await page.getByTestId('query-library-dialog').waitFor();
    await page.getByTestId('query-library-saved-entry-saved-query-ops-users').getByRole('button', {
      name: /^Run$/i,
    }).click();
    await waitForQueryTabCount(page, 'Active users', 2);

    await page.getByTestId('query-library-launcher').click();
    await page.getByTestId('query-library-dialog').waitFor();
    await page.getByTestId('query-library-saved-entry-saved-query-ops-users').getByRole('button', {
      name: /Edit metadata/i,
    }).click();
    await page.getByTestId('save-query-dialog').waitFor();
    await page.getByTestId('save-query-title-input').fill('Active users nightly');
    await page.getByRole('button', { name: /Update saved query/i }).click();
    await waitForQueryTabCount(page, 'Active users nightly', 2);

    await page.getByTestId('query-library-saved-entry-saved-query-revenue').waitFor();
    await page.getByTestId('query-library-saved-entry-saved-query-revenue').getByRole('button', {
      name: /^Delete$/i,
    }).click();
    await page.getByTestId('query-library-saved-entry-saved-query-revenue').waitFor({ state: 'detached' });
    await page
      .locator('[data-testid^="query-library-saved-entry-"]')
      .filter({ hasText: 'Harness scratch' })
      .first()
      .waitFor();

    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+4');
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-testid') === 'result-quick-filter',
    );

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
  } catch (error) {
    if (page) {
      const [pageHtml, commandPaletteItems, launcherSnapshot] = await Promise.all([
        page.locator('body').innerHTML().catch(() => ''),
        page
          .locator('[data-testid^="command-palette-item-"]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))
          .catch(() => []),
        page
          .locator('[data-testid$="launcher"]')
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              testId: node.getAttribute('data-testid'),
              text: node.textContent?.trim() ?? '',
            })),
          )
          .catch(() => []),
      ]);

      await Promise.all([
        page.screenshot({
          path: failureScreenshotPath,
          fullPage: true,
        }).catch(() => {}),
        writeFile(failureHtmlPath, pageHtml, 'utf8').catch(() => {}),
      ]);

      const errorMessage = [
        error instanceof Error ? error.message : String(error),
        `Failure screenshot: ${failureScreenshotPath}`,
        `Failure html: ${failureHtmlPath}`,
        `Palette items: ${JSON.stringify(commandPaletteItems)}`,
        `Launchers: ${JSON.stringify(launcherSnapshot)}`,
        `Page errors: ${JSON.stringify(diagnostics.pageErrors)}`,
        `Console: ${JSON.stringify(diagnostics.consoleMessages)}`,
      ].join('\n\n');

      throw new Error(errorMessage);
    }

    throw error;
  } finally {
    await browser.close();
  }

  console.log(`Productivity harness smoke screenshot written to ${screenshotPath}`);
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
      child.off('exit', resolveIfStopped);
      child.off('close', resolveIfStopped);
      child.off('error', resolveIfStopped);
      resolvePromise(undefined);
    };

    child.once('exit', resolveIfStopped);
    child.once('close', resolveIfStopped);
    child.once('error', resolveIfStopped);
    if (child.exitCode !== null) {
      resolveIfStopped();
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

async function waitForQueryTabCount(page, title, expectedCount) {
  await page.waitForFunction(
    ([nextTitle, nextExpectedCount]) =>
      Array.from(document.querySelectorAll('[data-testid^="query-tab-"]')).filter((node) =>
        node.textContent?.includes(nextTitle),
      ).length === nextExpectedCount,
    [title, expectedCount],
  );
}
