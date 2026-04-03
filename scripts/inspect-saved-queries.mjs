#!/usr/bin/env node

import { runSqliteInspector } from './run-sqlite-inspector.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.db) {
  printUsage();
  process.exitCode = 1;
} else {
  runSqliteInspector('saved-queries', [
    '--db',
    args.db,
    ...(args.connection ? ['--connection', args.connection] : []),
    ...(args.search ? ['--search', args.search] : []),
    '--limit',
    String(args.limit),
  ]);
}

function parseArgs(argv) {
  const parsed = {
    db: null,
    connection: null,
    search: null,
    limit: 20,
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
      case '--search':
        parsed.search = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--limit':
        parsed.limit = Number(argv[index + 1] ?? '20') || 20;
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
    'Usage: node ./scripts/inspect-saved-queries.mjs --db <sqlite-path> [--connection <connection-id>] [--search <query>] [--limit <n>]\n',
  );
}
