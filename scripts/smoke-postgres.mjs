import { spawn } from 'node:child_process';

const requiredEnv = [
  'SPAROW_PG_HOST',
  'SPAROW_PG_DATABASE',
  'SPAROW_PG_USERNAME',
  'SPAROW_PG_PASSWORD',
];

const missing = requiredEnv.filter((name) => !process.env[name]);

if (missing.length > 0) {
  throw new Error(
    `Missing PostgreSQL smoke environment variables: ${missing.join(', ')}.`,
  );
}

await run('cargo', [
  'test',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  'postgres_connection_smoke',
  '--',
  '--ignored',
  '--nocapture',
]);

await run('cargo', [
  'test',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  'postgres_schema_smoke',
  '--',
  '--ignored',
  '--nocapture',
]);

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
      env: process.env,
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
