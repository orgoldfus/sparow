import { spawn } from 'node:child_process';

await new Promise((resolve, reject) => {
  const child = spawn('npm', ['run', 'test', '--', 'src/test/foundation-smoke.test.tsx'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      resolve(undefined);
      return;
    }

    reject(new Error(`Foundation smoke test failed with exit code ${code ?? 'unknown'}.`));
  });

  child.on('error', reject);
});
