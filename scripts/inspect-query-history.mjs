#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));

if (!args.db) {
  printUsage();
  process.exitCode = 1;
} else {
  inspectQueryHistory(args);
}

function inspectQueryHistory({ db, connection, limit }) {
  const python = `
import json
import sqlite3
import sys

db_path = sys.argv[1]
connection_id = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "__ALL__" else None
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 20

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

sql = """
select id, sql, connection_profile_id, created_at
from query_history
"""
params = []

if connection_id is not None:
    sql += " where connection_profile_id = ?"
    params.append(connection_id)

sql += " order by created_at desc, id desc limit ?"
params.append(limit)

rows = conn.execute(sql, params).fetchall()

print(json.dumps({
    "dbPath": db_path,
    "connectionId": connection_id,
    "limit": limit,
    "rows": [dict(row) for row in rows],
}, indent=2))
`;

  const result = spawnSync('python3', ['-c', python, db, connection ?? '__ALL__', String(limit)], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        'Python 3 is required for scripts/inspect-query-history.mjs. Install python3 or inspect the SQLite database with another tool.',
      );
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `python3 exited with code ${result.status ?? 'unknown'}.`);
  }

  process.stdout.write(result.stdout);
}

function parseArgs(argv) {
  const parsed = {
    db: null,
    connection: null,
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
      case '--limit':
        parsed.limit = Number(argv[index + 1] ?? '20') || 20;
        index += 1;
        break;
    }
  }

  return parsed;
}

function printUsage() {
  process.stderr.write(
    'Usage: node ./scripts/inspect-query-history.mjs --db <sqlite-path> [--connection <connection-id>] [--limit <n>]\n',
  );
}
