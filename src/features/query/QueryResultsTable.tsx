import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type CellContext,
  type Column,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QueryResultCell, QueryResultSetSummary } from '../../lib/contracts';
import type { QueryTabState, QueryWorkspaceState } from './useQueryWorkspace';

const GRID_ROW_HEIGHT = 34;
const GRID_OVERSCAN = 12;
const GRID_MIN_FETCH = 120;
const ROW_NUMBER_COLUMN_ID = '__row_number__';

type QueryResultsTableProps = {
  active: boolean;
  summary: QueryResultSetSummary;
  tab: QueryTabState;
  totalRows: number;
  workspace: QueryWorkspaceState;
};

type ResultGridRow = {
  absoluteIndex: number;
  cells: QueryResultCell[];
};

type ResultColumnMeta =
  | {
      kind: 'row-number';
    }
  | {
      kind: 'result';
      columnIndex: number;
      name: string;
    };

export function QueryResultsTable({
  active,
  summary,
  tab,
  totalRows,
  workspace,
}: QueryResultsTableProps) {
  const { loadTabResultWindow, setTabColumnFilter, toggleTabSort } = workspace;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(480);
  const [scrollTop, setScrollTop] = useState(0);
  const activeWindow =
    tab.result.window?.resultSetId === summary.resultSetId ? tab.result.window : null;
  const loadedRows = useMemo<ResultGridRow[]>(
    () =>
      activeWindow?.rows.map((cells, rowIndex) => ({
        absoluteIndex: activeWindow.offset + rowIndex,
        cells,
      })) ?? [],
    [activeWindow],
  );
  const columns = useMemo<ColumnDef<ResultGridRow, unknown>[]>(
    () => [
      createRowNumberColumn(),
      ...summary.columns.map((column, columnIndex) => createResultColumn(column.name, columnIndex)),
    ],
    [summary.columns],
  );
  const table = useReactTable({
    columns,
    data: loadedRows,
    defaultColumn: {
      size: 180,
      minSize: 180,
      maxSize: 480,
    },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.absoluteIndex),
  });
  const leafColumns = table.getVisibleLeafColumns();
  const tableRows = table.getRowModel().rows;
  const gridTemplateColumns = leafColumns.map((column) => `${column.getSize()}px`).join(' ');
  const rowMap = useMemo(
    () => new Map(tableRows.map((row) => [row.original.absoluteIndex, row])),
    [tableRows],
  );
  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    estimateSize: () => GRID_ROW_HEIGHT,
    getScrollElement: () => scrollContainerRef.current,
    overscan: GRID_OVERSCAN,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const renderedRows =
    virtualRows.length > 0
      ? virtualRows
      : loadedRows.map((row) => ({
          index: row.absoluteIndex,
          key: row.absoluteIndex,
          start: row.absoluteIndex * GRID_ROW_HEIGHT,
        }));
  const requestedWindow = useMemo(() => {
    return {
      limit: Math.max(
        GRID_MIN_FETCH,
        Math.ceil(viewportHeight / GRID_ROW_HEIGHT) + GRID_OVERSCAN * 2,
      ),
      offset: Math.max(0, Math.floor(scrollTop / GRID_ROW_HEIGHT) - GRID_OVERSCAN),
    };
  }, [scrollTop, viewportHeight]);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(element);
    setViewportHeight(element.clientHeight);

    return () => {
      observer.disconnect();
    };
  }, [tab.id]);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      return;
    }

    element.scrollTop = 0;
    setScrollTop(0);
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, [
    summary.resultSetId,
    tab.id,
    tab.result.filters,
    tab.result.quickFilter,
    tab.result.sort,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }

    void loadTabResultWindow(tab.id, requestedWindow.offset, requestedWindow.limit);
  }, [
    active,
    loadTabResultWindow,
    requestedWindow.limit,
    requestedWindow.offset,
    summary.resultSetId,
    tab.id,
    tab.result.requestedWindowSignature,
  ]);

  if (tab.result.windowStatus === 'failed') {
    return (
      <div className="px-4 py-6">
        <EmptyPanel message={tab.result.windowError?.message ?? 'Failed to load the cached result window.'} />
      </div>
    );
  }

  if (totalRows === 0) {
    return (
      <div className="px-4 py-6">
        <EmptyPanel message="The cached result contains no visible rows." />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[color-mix(in_oklch,_var(--surface-editor)_82%,_var(--surface-panel)_18%)]">
      <div
        className="min-h-0 overflow-auto"
        aria-colcount={summary.columns.length + 1}
        aria-rowcount={totalRows}
        data-testid="query-result-grid-scroll"
        ref={scrollContainerRef}
        role="grid"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
      >
        <div className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-panel)_92%,_black_8%)] backdrop-blur-sm" role="rowgroup">
          {table.getHeaderGroups().map((headerGroup) => (
            <div
              className="grid min-w-max w-max"
              key={headerGroup.id}
              role="row"
              style={{ gridTemplateColumns }}
            >
              {headerGroup.headers.map((header) =>
                renderHeaderCell(header.column, header.id, tab, toggleTabSort),
              )}
            </div>
          ))}
          <div
            className="grid min-w-max w-max border-t border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-elevated)_94%,_black_6%)]"
            role="row"
            style={{ gridTemplateColumns }}
          >
            {leafColumns.map((column) => renderFilterCell(column, tab, setTabColumnFilter))}
          </div>
        </div>

        <div
          className="relative min-w-max w-max"
          role="rowgroup"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {renderedRows.map((virtualRow) => {
            const row = rowMap.get(virtualRow.index);

            return (
              <div
                aria-rowindex={virtualRow.index + 1}
                className="grid min-w-max w-max border-b border-[var(--border-subtle)] text-sm text-[var(--text-secondary)]"
                data-testid={`result-row-${virtualRow.index}`}
                key={virtualRow.key}
                role="row"
                style={{
                  gridTemplateColumns,
                  minHeight: GRID_ROW_HEIGHT,
                  position: 'absolute',
                  top: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row
                  ? row.getVisibleCells().map((cell) => (
                      <div
                        className={
                          getColumnMeta(cell.column).kind === 'row-number'
                            ? 'border-r border-[var(--border-subtle)] px-3 py-2 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]'
                            : 'truncate border-r border-[var(--border-subtle)] px-3 py-2 font-mono text-[13px] last:border-r-0'
                        }
                        key={cell.id}
                        role="gridcell"
                        title={cellTitle(
                          getColumnMeta(cell.column).kind === 'row-number'
                            ? cell.row.original.absoluteIndex + 1
                            : cell.getValue<QueryResultCell>(),
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))
                  : leafColumns.map((column) => renderPlaceholderCell(column, virtualRow.index))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">
      {message}
    </div>
  );
}

function renderHeaderCell(
  column: Column<ResultGridRow>,
  key: string,
  tab: QueryTabState,
  toggleTabSort: QueryWorkspaceState['toggleTabSort'],
) {
  const meta = getColumnMeta(column);
  const width = `${column.getSize()}px`;

  if (meta.kind === 'row-number') {
    return (
      <div
        className="border-r border-[var(--border-subtle)] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]"
        key={key}
        role="columnheader"
        style={{ width }}
      >
        Row
      </div>
    );
  }

  const isSorted = tab.result.sort?.columnIndex === meta.columnIndex;

  return (
    <button
      className="flex items-center justify-between gap-2 border-r border-[var(--border-subtle)] px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)] last:border-r-0"
      data-testid={`result-column-${meta.columnIndex}`}
      key={key}
      onClick={() => {
        toggleTabSort(tab.id, meta.columnIndex);
      }}
      role="columnheader"
      style={{ width }}
      type="button"
    >
      <span className="truncate">{meta.name}</span>
      {isSorted ? (
        tab.result.sort?.direction === 'asc' ? (
          <ArrowUpWideNarrow className="h-3.5 w-3.5 text-[var(--accent-text)]" />
        ) : (
          <ArrowDownWideNarrow className="h-3.5 w-3.5 text-[var(--accent-text)]" />
        )
      ) : null}
    </button>
  );
}

function renderFilterCell(
  column: Column<ResultGridRow>,
  tab: QueryTabState,
  setTabColumnFilter: QueryWorkspaceState['setTabColumnFilter'],
) {
  const meta = getColumnMeta(column);

  if (meta.kind === 'row-number') {
    return (
      <div
        className="border-r border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--text-muted)]"
        key={column.id}
        role="gridcell"
      >
        contains
      </div>
    );
  }

  return (
    <label
      className="border-r border-[var(--border-subtle)] px-2 py-1.5 last:border-r-0"
      key={column.id}
      role="gridcell"
    >
      <input
        className="w-full rounded-lg border border-transparent bg-[var(--surface-panel)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]"
        data-testid={`result-filter-${meta.columnIndex}`}
        placeholder={meta.name}
        value={filterValueForColumn(tab, meta.columnIndex)}
        onChange={(event) => {
          setTabColumnFilter(tab.id, meta.columnIndex, event.target.value);
        }}
      />
    </label>
  );
}

function renderPlaceholderCell(column: Column<ResultGridRow>, rowIndex: number) {
  const meta = getColumnMeta(column);

  if (meta.kind === 'row-number') {
    return (
      <div
        className="border-r border-[var(--border-subtle)] px-3 py-2 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]"
        key={`${column.id}-${rowIndex}`}
        role="gridcell"
      >
        {rowIndex + 1}
      </div>
    );
  }

  return (
    <div
      className="truncate border-r border-[var(--border-subtle)] px-3 py-2 font-mono text-[13px] last:border-r-0"
      key={`${column.id}-${rowIndex}`}
      role="gridcell"
      title={meta.columnIndex === 0 ? 'Loading cached rows...' : ''}
    >
      {meta.columnIndex === 0 ? 'Loading cached rows...' : ''}
    </div>
  );
}

function getColumnMeta(column: Column<ResultGridRow>): ResultColumnMeta {
  return column.columnDef.meta as ResultColumnMeta;
}

function createRowNumberColumn(): ColumnDef<ResultGridRow, unknown> {
  return {
    id: ROW_NUMBER_COLUMN_ID,
    header: 'Row',
    cell: (info: CellContext<ResultGridRow, number>) => info.row.original.absoluteIndex + 1,
    maxSize: 72,
    meta: {
      kind: 'row-number',
    } satisfies ResultColumnMeta,
    minSize: 72,
    size: 72,
  };
}

function createResultColumn(
  columnName: string,
  columnIndex: number,
): ColumnDef<ResultGridRow, unknown> {
  return {
    accessorFn: (row: ResultGridRow) => row.cells[columnIndex] ?? null,
    cell: (info: CellContext<ResultGridRow, QueryResultCell>) => renderCell(info.getValue()),
    header: columnName,
    id: `column-${columnIndex}`,
    meta: {
      kind: 'result',
      columnIndex,
      name: columnName,
    } satisfies ResultColumnMeta,
    minSize: 180,
    size: 180,
  };
}

function filterValueForColumn(tab: QueryTabState, columnIndex: number): string {
  return tab.result.filters.find((filter) => filter.columnIndex === columnIndex)?.value ?? '';
}

function renderCell(cell: QueryResultCell): string {
  if (cell === null) {
    return 'null';
  }

  return String(cell);
}

function cellTitle(cell: QueryResultCell | number): string {
  return renderCell(cell);
}
