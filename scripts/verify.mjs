import { spawn } from 'node:child_process';

const commands = [
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'test']],
  ['npm', ['run', 'smoke:foundation']],
  ['npm', ['run', 'smoke:results-browser']],
  ['npm', ['run', 'smoke:shell-browser']],
  ['cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml']],
];

for (const [command, args] of commands) {
  await run(command, args);
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}.`));
    });

    child.on('error', reject);
  });
}
