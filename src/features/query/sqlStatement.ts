import type { QueryExecutionOrigin } from '../../lib/contracts';

export type StatementExecutionInput = {
  sql: string;
  origin: QueryExecutionOrigin;
  isSelectionMultiStatement: boolean;
};

export type StatementLocation = {
  cursorOffset: number;
  selectionStartOffset: number;
  selectionEndOffset: number;
};

type StatementSegment = {
  rawStart: number;
  rawEnd: number;
  trimmedStart: number;
  trimmedEnd: number;
  text: string;
};

export function deriveTabTitle(sql: string): string {
  const firstMeaningfulLine = sql
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstMeaningfulLine) {
    return 'New Query';
  }

  return firstMeaningfulLine.length > 42
    ? `${firstMeaningfulLine.slice(0, 39)}...`
    : firstMeaningfulLine;
}

export function deriveStatementExecutionInput(
  sql: string,
  location: StatementLocation,
): StatementExecutionInput {
  const normalizedSelectionStart = Math.max(
    0,
    Math.min(location.selectionStartOffset, location.selectionEndOffset),
  );
  const normalizedSelectionEnd = Math.min(
    sql.length,
    Math.max(location.selectionStartOffset, location.selectionEndOffset),
  );

  if (normalizedSelectionStart !== normalizedSelectionEnd) {
    const selectedSql = sql.slice(normalizedSelectionStart, normalizedSelectionEnd).trim();
    if (selectedSql.length === 0) {
      throw new Error('Select a non-empty SQL statement before running.');
    }

    return {
      sql: selectedSql,
      origin: 'selection',
      isSelectionMultiStatement: countExecutableStatements(selectedSql) > 1,
    };
  }

  const segments = extractStatementSegments(sql);
  if (segments.length === 0) {
    throw new Error('Run requires a non-empty SQL statement.');
  }

  const cursorOffset = Math.max(0, Math.min(location.cursorOffset, sql.length));
  const containingSegment = segments.find(
    (segment) => cursorOffset >= segment.rawStart && cursorOffset <= segment.rawEnd,
  );

  if (!containingSegment) {
    if (segments.length === 1) {
      return {
        sql: segments[0]?.text ?? '',
        origin: 'current-statement',
        isSelectionMultiStatement: false,
      };
    }

    throw new Error('Place the cursor inside one SQL statement before running.');
  }

  if (cursorOffset < containingSegment.trimmedStart || cursorOffset > containingSegment.trimmedEnd) {
    throw new Error('Place the cursor inside one SQL statement before running.');
  }

  return {
    sql: containingSegment.text,
    origin: 'current-statement',
    isSelectionMultiStatement: false,
  };
}

export function countExecutableStatements(sql: string): number {
  return extractStatementSegments(sql).length;
}

function extractStatementSegments(sql: string): StatementSegment[] {
  const delimiters = findTopLevelSemicolons(sql);
  const segments: StatementSegment[] = [];
  let segmentStart = 0;

  for (const delimiterOffset of [...delimiters, sql.length]) {
    const rawStart = segmentStart;
    const rawEnd = delimiterOffset;
    const executableBounds = findExecutableBounds(sql.slice(rawStart, rawEnd));
    if (executableBounds) {
      segments.push({
        rawStart,
        rawEnd,
        trimmedStart: rawStart + executableBounds.start,
        trimmedEnd: rawStart + executableBounds.end,
        text: executableBounds.text,
      });
    }

    segmentStart = delimiterOffset + 1;
  }

  return segments;
}

function findTopLevelSemicolons(sql: string): number[] {
  const semicolons: number[] = [];
  let index = 0;
  let mode:
    | 'code'
    | 'single-quote'
    | 'double-quote'
    | 'line-comment'
    | 'block-comment'
    | 'dollar-quote' = 'code';
  let dollarQuoteDelimiter = '';

  while (index < sql.length) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (mode === 'line-comment') {
      if (character === '\n') {
        mode = 'code';
      }
      index += 1;
      continue;
    }

    if (mode === 'block-comment') {
      if (character === '*' && nextCharacter === '/') {
        mode = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (mode === 'single-quote') {
      if (character === "'" && nextCharacter === "'") {
        index += 2;
        continue;
      }
      if (character === "'") {
        mode = 'code';
      }
      index += 1;
      continue;
    }

    if (mode === 'double-quote') {
      if (character === '"' && nextCharacter === '"') {
        index += 2;
        continue;
      }
      if (character === '"') {
        mode = 'code';
      }
      index += 1;
      continue;
    }

    if (mode === 'dollar-quote') {
      if (dollarQuoteDelimiter.length > 0 && sql.startsWith(dollarQuoteDelimiter, index)) {
        mode = 'code';
        index += dollarQuoteDelimiter.length;
        dollarQuoteDelimiter = '';
        continue;
      }
      index += 1;
      continue;
    }

    if (character === '-' && nextCharacter === '-') {
      mode = 'line-comment';
      index += 2;
      continue;
    }

    if (character === '/' && nextCharacter === '*') {
      mode = 'block-comment';
      index += 2;
      continue;
    }

    if (character === "'") {
      mode = 'single-quote';
      index += 1;
      continue;
    }

    if (character === '"') {
      mode = 'double-quote';
      index += 1;
      continue;
    }

    if (character === '$') {
      const delimiter = readDollarQuoteDelimiter(sql, index);
      if (delimiter) {
        mode = 'dollar-quote';
        dollarQuoteDelimiter = delimiter;
        index += delimiter.length;
        continue;
      }
    }

    if (character === ';') {
      semicolons.push(index);
    }

    index += 1;
  }

  return semicolons;
}

function readDollarQuoteDelimiter(sql: string, offset: number): string | null {
  let end = offset + 1;

  while (end < sql.length) {
    const character = sql[end] ?? '';
    if (character === '$') {
      return sql.slice(offset, end + 1);
    }

    if (!/[A-Za-z0-9_]/.test(character)) {
      return null;
    }

    end += 1;
  }

  return null;
}

function findExecutableBounds(value: string): { start: number; end: number; text: string } | null {
  let start = 0;

  while (start < value.length) {
    const remaining = value.slice(start);
    const leadingWhitespace = remaining.length - remaining.trimStart().length;
    start += leadingWhitespace;

    if (value.startsWith('--', start)) {
      const newlineOffset = value.indexOf('\n', start);
      start = newlineOffset === -1 ? value.length : newlineOffset + 1;
      continue;
    }

    if (value.startsWith('/*', start)) {
      const blockEndOffset = value.indexOf('*/', start + 2);
      start = blockEndOffset === -1 ? value.length : blockEndOffset + 2;
      continue;
    }

    break;
  }

  const end = value.length - (value.length - value.trimEnd().length);
  if (start >= end) {
    return null;
  }

  return {
    start,
    end,
    text: value.slice(start, end),
  };
}
