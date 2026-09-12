import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { classNames } from '../../lib/format.js';

/* Themed data table. columns: [{ key, header, render?(row), className? }]
   Pass pageSize to enable client-side pagination (port of admin-components.js pager):
   shows "Showing X–Y of Z" plus prev/next + numbered page buttons with ellipsis. */
function pageNumbers(page, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  if (page > 4) out.push('…');
  for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) out.push(i);
  if (page < total - 3) out.push('…');
  out.push(total);
  return out;
}

export default function Table({
  columns,
  rows,
  rowKey = (r) => r.id,
  empty = 'Nothing here yet.',
  onRowClick,
  pageSize,
  label = 'records',
  selectable,     // enable row checkboxes
  selected,       // Set of selected row keys
  onSelect,       // (key) => void — toggle single row
  onSelectAll,    // (checked) => void — toggle all visible rows
  mobileCard,     // optional (row) => JSX — stacked card layout shown < sm instead of the table
}) {
  const [page, setPage] = useState(1);
  const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const view = useMemo(() => {
    if (!pageSize) return rows;
    const s = (page - 1) * pageSize;
    return rows.slice(s, s + pageSize);
  }, [rows, page, pageSize]);

  const start = rows.length ? (page - 1) * (pageSize || 0) + 1 : 0;
  const end = pageSize ? Math.min(page * pageSize, rows.length) : rows.length;

  const allVisibleSelected = view.length > 0 && view.every((r) => selected?.has(rowKey(r)));

  return (
    <div>
      {/* Mobile: stacked cards (only when a card renderer is supplied) */}
      {mobileCard ? (
        <div className="sm:hidden">
          {selectable && rows.length > 0 ? (
            <label className="mb-3 flex items-center gap-2 px-1 text-xs font-medium text-gray-400">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(e) => onSelectAll?.(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded accent-teal-500"
              />
              Select all on page
            </label>
          ) : null}
          {rows.length === 0 ? (
            <div className="dz-card p-8 text-center text-gray-500">{empty}</div>
          ) : (
            <div className="space-y-3">
              {view.map((row) => (
                <div key={rowKey(row)}>{mobileCard(row)}</div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className={classNames('overflow-x-auto dz-card', mobileCard && 'hidden sm:block')}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400">
              {selectable && (
                <th className="w-10 p-4">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => onSelectAll?.(e.target.checked)}
                    className="accent-teal-500 h-4 w-4 rounded cursor-pointer"
                  />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} className={classNames('p-4 font-medium', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="p-8 text-center text-gray-500">
                  {empty}
                </td>
              </tr>
            ) : (
              view.map((row) => {
                const key = rowKey(row);
                const isSelected = selectable && selected?.has(key);
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={classNames('border-t border-white/5', onRowClick && 'cursor-pointer hover:bg-white/5', isSelected && 'bg-teal-500/5')}
                  >
                    {selectable && (
                      <td className="w-10 p-4">
                        <input
                          type="checkbox"
                          checked={!!isSelected}
                          onChange={() => onSelect?.(key)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-teal-500 h-4 w-4 rounded cursor-pointer"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={classNames('p-4', c.className)}>
                        {c.render ? c.render(row) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pageSize && rows.length ? (
        <div className="mt-3 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="text-xs text-gray-400">
            Showing {start}–{end} of {rows.length} {label}
          </div>
          {totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageNumbers(page, totalPages).map((x, i) =>
                x === '…' ? (
                  <span key={`e${i}`} className="px-1 text-gray-500">
                    …
                  </span>
                ) : (
                  <button
                    key={x}
                    onClick={() => setPage(x)}
                    className={classNames(
                      'h-8 min-w-8 rounded-lg border px-2 text-sm',
                      x === page ? 'border-brand-teal bg-brand-teal/15 text-brand-teal' : 'border-white/10 text-gray-300 hover:bg-white/5',
                    )}
                  >
                    {x}
                  </button>
                ),
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
