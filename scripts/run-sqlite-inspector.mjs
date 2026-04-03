import { spawnSync } from 'node:child_process';

export function runSqliteInspector(command, args) {
  const commandArgs = [
    'run',
    '--quiet',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--bin',
    'sqlite_inspector',
    '--',
    command,
    ...args,
  ];

  const result = spawnSync('cargo', commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        'Cargo is required for the SQLite inspector. Install Rust and Cargo or inspect the SQLite database with another tool.',
      );
    }

    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `cargo ${commandArgs.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }

  process.stdout.write(result.stdout);
}
