'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns,
  Download,
  FileSpreadsheet,
  Search,
} from 'lucide-react';
import {
  ExportColumn,
  exportRowsToCsv,
  exportRowsToXlsx,
} from '@/lib/excel-utils';

export interface TableColumn<T> {
  id: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  exportValue?: (row: T) => string | number | boolean | undefined;
  align?: 'left' | 'right' | 'center';
  defaultHidden?: boolean;
}

export type DataColumn<T> = TableColumn<T>;

interface DataTableProps<T> {
  title: string;
  subtitle?: string;
  data: T[];
  columns: TableColumn<T>[];
  getRowId?: (row: T) => string;
  rowKey?: (row: T) => string;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  exportFilename?: string;
  bulkActions?: Array<{
    label: string;
    onExecute?: (selectedIds: string[]) => void;
    onClick?: (selectedIds: string[]) => void;
    variant?: 'default' | 'danger';
  }>;
  headerActions?: React.ReactNode;
  emptyMessage?: string;
}

export function DataTable<T>({
  title,
  subtitle,
  data,
  columns,
  getRowId: getRowIdProp,
  rowKey,
  searchPlaceholder = 'Filter records...',
  searchFilter,
  exportFilename = 'printswift-local-sample-export',
  bulkActions,
  headerActions,
  emptyMessage = 'No matching sample records found for the active filters.',
}: DataTableProps<T>) {
  const getRowId = useMemo(
    () =>
      getRowIdProp ||
      rowKey ||
      ((row: T) => String((row as Record<string, unknown>).id || '')),
    [getRowIdProp, rowKey]
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColId, setSortColId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hiddenColIds, setHiddenColIds] = useState<string[]>(() =>
    columns.filter((c) => c.defaultHidden).map((c) => c.id)
  );
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColIds.includes(c.id)),
    [columns, hiddenColIds]
  );

  const filteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = data;
    if (q) {
      if (searchFilter) {
        list = list.filter((row) => searchFilter(row, q));
      } else {
        list = list.filter((row) =>
          columns.some((col) => {
            const val = col.accessor(row);
            return (
              (typeof val === 'string' || typeof val === 'number') &&
              String(val).toLowerCase().includes(q)
            );
          })
        );
      }
    }
    if (sortColId) {
      const col = columns.find((c) => c.id === sortColId);
      if (col) {
        list = [...list].sort((a, b) => {
          const rawA = col.sortValue ? col.sortValue(a) : col.accessor(a);
          const rawB = col.sortValue ? col.sortValue(b) : col.accessor(b);
          const va =
            typeof rawA === 'number' || typeof rawA === 'string'
              ? rawA
              : String(rawA ?? '');
          const vb =
            typeof rawB === 'number' || typeof rawB === 'string'
              ? rawB
              : String(rawB ?? '');
          if (va < vb) return sortDir === 'asc' ? -1 : 1;
          if (va > vb) return sortDir === 'asc' ? 1 : -1;
          return 0;
        });
      }
    }
    return list;
  }, [data, searchQuery, searchFilter, sortColId, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, safePage, pageSize]);

  const handleSort = (colId: string) => {
    if (sortColId === colId) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColId(colId);
      setSortDir('asc');
    }
  };

  const toggleAllVisible = () => {
    const visibleIds = pagedData.map(getRowId);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const exportCols: ExportColumn<T>[] = useMemo(
    () =>
      visibleColumns
        .filter((c) => c.id !== 'actions')
        .map((c) => ({
          key: c.id,
          header: c.header,
          getValue: (row: T) => {
            if (c.exportValue) return c.exportValue(row);
            const v = c.accessor(row);
            if (
              typeof v === 'string' ||
              typeof v === 'number' ||
              typeof v === 'boolean'
            ) {
              return v;
            }
            return '';
          },
        })),
    [visibleColumns]
  );

  const handleExportXlsx = () => {
    exportRowsToXlsx(filteredData, exportCols, `${exportFilename}.xlsx`);
  };

  const handleExportCsv = () => {
    exportRowsToCsv(filteredData, exportCols, `${exportFilename}.csv`);
  };

  return (
    <div className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl overflow-hidden">
      {/* Top Toolbar */}
      <div className="p-4 border-b border-[var(--ps-border)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--ps-text)]">{title}</h3>
          {subtitle && (
            <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">{subtitle}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="pl-8 pr-3 py-1.5 text-xs bg-[var(--ps-bg)] border border-[var(--ps-border)] rounded-lg text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] w-48 sm:w-60"
            />
          </div>

          {/* Column Visibility Toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColumnMenu((p) => !p)}
              aria-label="Toggle table columns"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--ps-bg)] border border-[var(--ps-border)] rounded-lg text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors whitespace-nowrap shrink-0"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Columns</span>
            </button>
            {showColumnMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-lg shadow-lg p-2 z-30">
                <p className="text-[11px] font-semibold text-[var(--ps-text-muted)] px-2 py-1">
                  Visible Columns
                </p>
                {columns.map((col) => {
                  const isVis = !hiddenColIds.includes(col.id);
                  return (
                    <label
                      key={col.id}
                      className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isVis}
                        onChange={() => {
                          setHiddenColIds((prev) =>
                            isVis
                              ? [...prev, col.id]
                              : prev.filter((id) => id !== col.id)
                          );
                        }}
                      />
                      <span className="truncate">{col.header}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {exportCols.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportXlsx}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--ps-bg)] border border-[var(--ps-border)] rounded-lg text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Export Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--ps-bg)] border border-[var(--ps-border)] rounded-lg text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV (.csv)</span>
              </button>
            </>
          )}

          {headerActions}
        </div>
      </div>

      {/* Bulk Action Bar */}
      {bulkActions && selectedIds.length > 0 && (
        <div className="px-4 py-2 bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[var(--ps-text)] tabular-nums">
            {selectedIds.length} record(s) selected
          </span>
          <div className="flex items-center gap-2">
            {bulkActions.map((action, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  (action.onExecute || action.onClick)?.(selectedIds);
                  setSelectedIds([]);
                }}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  action.variant === 'danger'
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-90'
                }`}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1 text-xs text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60">
              {bulkActions && (
                <th className="py-2.5 px-3 w-9">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={
                      pagedData.length > 0 &&
                      pagedData.every((r) => selectedIds.includes(getRowId(r)))
                    }
                    onChange={toggleAllVisible}
                  />
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  className={`py-2.5 px-3 text-xs font-semibold text-[var(--ps-text-muted)] whitespace-nowrap ${
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                        ? 'text-center'
                        : 'text-left'
                  }`}
                >
                  {col.id !== 'actions' ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col.id)}
                      className="inline-flex items-center gap-1 hover:text-[var(--ps-text)]"
                    >
                      <span>{col.header}</span>
                      {sortColId === col.id ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="w-3 h-3" />
                        ) : (
                          <ArrowDown className="w-3 h-3" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-50" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ps-border)] text-xs">
            {pagedData.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (bulkActions ? 1 : 0)}
                  className="py-10 text-center text-sm text-[var(--ps-text-muted)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pagedData.map((row) => {
                const rowId = getRowId(row);
                return (
                  <tr
                    key={rowId}
                    className="hover:bg-[var(--ps-surface-alt)]/50 transition-colors"
                  >
                    {bulkActions && (
                      <td className="py-2.5 px-3">
                        <input
                          type="checkbox"
                          aria-label={`Select row ${rowId}`}
                          checked={selectedIds.includes(rowId)}
                          onChange={() => toggleRow(rowId)}
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={col.id}
                        className={`py-2.5 px-3 text-[var(--ps-text)] ${
                          col.align === 'right'
                            ? 'text-right tabular-nums'
                            : col.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                        }`}
                      >
                        {col.render ? col.render(row) : col.accessor(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Responsive Mobile Card Presentation */}
      <div className="md:hidden divide-y divide-[var(--ps-border)]">
        {pagedData.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--ps-text-muted)]">
            {emptyMessage}
          </div>
        ) : (
          pagedData.map((row) => {
            const rowId = getRowId(row);
            return (
              <div key={rowId} className="p-4 space-y-2">
                {visibleColumns.map((col) => (
                  <div
                    key={col.id}
                    className="flex items-start justify-between gap-3 text-xs"
                  >
                    <span className="text-[var(--ps-text-muted)] font-medium shrink-0">
                      {col.header}
                    </span>
                    <div className="text-[var(--ps-text)] text-right">
                      {col.render ? col.render(row) : col.accessor(row)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-3 border-t border-[var(--ps-border)] flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--ps-text-muted)]">
        <div className="flex items-center gap-2 tabular-nums">
          <span>
            Showing {filteredData.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
            {Math.min(safePage * pageSize, filteredData.length)} of{' '}
            {filteredData.length} sample records
          </span>
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-[var(--ps-bg)] border border-[var(--ps-border)] rounded px-2 py-1 text-xs text-[var(--ps-text)]"
          >
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5 tabular-nums">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
            className="p-1.5 rounded border border-[var(--ps-border)] disabled:opacity-40 hover:bg-[var(--ps-surface-alt)]"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="px-2">
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Next page"
            className="p-1.5 rounded border border-[var(--ps-border)] disabled:opacity-40 hover:bg-[var(--ps-surface-alt)]"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default DataTable;

