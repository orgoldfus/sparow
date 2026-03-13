#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));

if (!args.db) {
  printUsage();
  process.exitCode = 1;
} else {
  inspectResultCache(args);
}

function inspectResultCache({ db, resultSet, offset, limit }) {
  const python = `
import json
import sqlite3
import sys

db_path = sys.argv[1]
result_set_id = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "__ALL__" else None
offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 50

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

metadata_sql = """
select
  result_set_id,
  job_id,
  tab_id,
  connection_profile_id,
  sql,
  columns_json,
  buffered_row_count,
  total_row_count,
  status,
  created_at,
  completed_at,
  last_error_json
from query_result_sets
"""
metadata_params = []

if result_set_id is not None:
  metadata_sql += " where result_set_id = ?"
  metadata_params.append(result_set_id)

metadata_sql += " order by created_at desc, result_set_id desc"
metadata_rows = conn.execute(metadata_sql, metadata_params).fetchall()

selected_result_set = result_set_id
if selected_result_set is None and metadata_rows:
  selected_result_set = metadata_rows[0]["result_set_id"]

window_rows = []
if selected_result_set is not None:
  window_rows = conn.execute(
      """
      select row_index, row_json
      from query_result_rows
      where result_set_id = ?
      order by row_index asc
      limit ? offset ?
      """,
      (selected_result_set, limit, offset),
  ).fetchall()

print(json.dumps({
    "dbPath": db_path,
    "resultSetId": selected_result_set,
    "offset": offset,
    "limit": limit,
    "resultSets": [dict(row) for row in metadata_rows],
    "windowRows": [dict(row) for row in window_rows],
}, indent=2))
`;

  const result = spawnSync(
    'python3',
    ['-c', python, db, resultSet ?? '__ALL__', String(offset), String(limit)],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        'Python 3 is required for scripts/inspect-result-cache.mjs. Install python3 or inspect the SQLite database with another tool.',
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
    resultSet: null,
    offset: 0,
    limit: 50,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--db':
        parsed.db = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--result-set':
        parsed.resultSet = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--offset':
        parsed.offset = parseNonNegativeInteger(argv[index + 1], 0);
        index += 1;
        break;
      case '--limit':
        parsed.limit = parseNonNegativeInteger(argv[index + 1], 50);
        index += 1;
        break;
    }
  }

  return parsed;
}

function parseNonNegativeInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : fallback;
}

function printUsage() {
  process.stderr.write(
    'Usage: node ./scripts/inspect-result-cache.mjs --db <sqlite-path> [--result-set <id>] [--offset <n>] [--limit <n>]\n',
  );
}
