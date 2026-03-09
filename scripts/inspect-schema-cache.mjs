#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));

if (!args.db || !args.connection) {
  printUsage();
  process.exitCode = 1;
} else {
  inspectSchemaCache(args);
}

function inspectSchemaCache({ connection, db, scope }) {
  const python = `
import json
import sqlite3
import sys

db_path = sys.argv[1]
connection_id = sys.argv[2]
scope_path = sys.argv[3] if len(sys.argv) > 3 else ""

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

scopes = conn.execute(
    """
    select scope_path, scope_kind, refreshed_at, refresh_status
    from schema_cache_scopes
    where connection_profile_id = ?
    order by scope_path
    """,
    (connection_id,),
).fetchall()

nodes = conn.execute(
    """
    select object_kind, object_path, display_name, parent_path, schema_name, relation_name, position, has_children, refreshed_at
    from schema_cache
    where connection_profile_id = ?
      and coalesce(parent_path, '') = ?
    order by position asc, lower(display_name) asc, id asc
    """,
    (connection_id, scope_path),
).fetchall()

print(json.dumps({
    "dbPath": db_path,
    "connectionId": connection_id,
    "scopePath": scope_path or None,
    "scopes": [dict(row) for row in scopes],
    "nodes": [dict(row) for row in nodes],
}, indent=2))
`;

  const result = spawnSync('python3', ['-c', python, db, connection, scope ?? ''], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        'Python 3 is required for scripts/inspect-schema-cache.mjs. Install python3 or inspect the SQLite database with another tool.',
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
    }
  }

  return parsed;
}

function printUsage() {
  process.stderr.write(
    'Usage: node ./scripts/inspect-schema-cache.mjs --db <sqlite-path> --connection <connection-id> [--scope <scope-path>]\\n',
  );
}
