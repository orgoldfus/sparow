import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..');
const versionFilePath = resolve(repoRoot, '.node-version');
const [command, ...args] = process.argv.slice(2);

if (!command) {
  throw new Error('A command is required.');
}

const targetVersion = readFileSync(versionFilePath, 'utf8').trim();
const currentMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
const targetMajor = Number.parseInt(targetVersion.split('.')[0] ?? '', 10);

if (Number.isNaN(targetMajor)) {
  throw new Error(`Invalid .node-version value: ${targetVersion}`);
}

if (currentMajor === targetMajor) {
  await run(command, args);
} else {
  const fnmPath = findOnPath('fnm');

  if (!fnmPath) {
    throw new Error(
      `Node ${targetVersion} is required, but the current runtime is ${process.versions.node} and fnm is unavailable.`,
    );
  }

  await run(fnmPath, ['exec', '--using', targetVersion, '--', command, ...args], {
    FORCE_COLOR: process.env.NO_COLOR ? undefined : process.env.FORCE_COLOR,
  });
}

async function run(executable, executableArgs, envOverrides = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, executableArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        ...envOverrides,
      },
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }

      rejectPromise(new Error(`${executable} ${executableArgs.join(' ')} failed with exit code ${code ?? 'unknown'}.`));
    });

    child.on('error', rejectPromise);
  });
}

function findOnPath(binaryName) {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  for (const entry of pathValue.split(':')) {
    const candidate = resolve(entry, binaryName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
