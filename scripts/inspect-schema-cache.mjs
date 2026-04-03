#!/usr/bin/env node

import { runSqliteInspector } from './run-sqlite-inspector.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.db || !args.connection) {
  printUsage();
  process.exitCode = 1;
} else {
  runSqliteInspector('schema-cache', [
    '--db',
    args.db,
    '--connection',
    args.connection,
    ...(args.scope ? ['--scope', args.scope] : []),
  ]);
}

function parseArgs(argv) {
  const parsed = {
    db: null,
    connection: null,
    scope: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--db':
        parsed.db = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--connection':
        parsed.connection = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--scope':
        parsed.scope = argv[index + 1] ?? null;
        index += 1;
        break;
      default:
        break;
    }
  }

  return parsed;
}

function printUsage() {
  process.stderr.write(
    'Usage: node ./scripts/inspect-schema-cache.mjs --db <sqlite-path> --connection <connection-id> [--scope <scope-path>]\n',
  );
}
