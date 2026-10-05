import { useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { classNames, fmtNum } from '../../lib/format.js';
import HScroll from '../ui/HScroll.jsx';

export const CHIP = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold';
export const CHIP_TONE = {
  neutral: 'border-white/10 bg-white/5 text-gray-300',
  red: 'border-rose-400/40 bg-rose-500/15 text-rose-200',
  amber: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
  sky: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  teal: 'border-teal-400/30 bg-teal-500/10 text-teal-200',
  violet: 'border-violet-400/40 bg-violet-500/15 text-violet-200',
  green: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
};
const ICON_BTN = 'grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-white/10 text-gray-400 transition hover:border-white/20 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40';
const GROUP = 'mt-2.5 border-t border-white/[0.06] pt-2.5';
const DASH = '\u2014';

export const DATE_CHIPS = [
  { value: '', label: 'All' },
  { value: '1', label: 'Today' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
];

/** `tabs`: [{ key, label, count }]; a null count hides the pill, a string (e.g. "100+") shows as is. */
export function QueueTabs({ tabs, active, onChange, label, idPrefix = 'queue', countTestId = 'tab-count' }) {
  return (
    <HScroll role="tablist" aria-label={label} wrapClassName="mb-4" fadeColor="var(--brand-dark)" className="flex gap-1 border-b border-white/10">
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.key}`}
            aria-controls={`${idPrefix}-panel`}
            data-tab={t.key}
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={classNames(
              '-mb-px flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              on ? 'border-brand-teal text-white' : 'border-transparent text-gray-400 hover:text-white',
            )}
          >
            {t.label}
            {t.count != null ? (
              <span data-testid={`${countTestId}-${t.key}`} className={classNames('rounded-full px-1.5 py-px text-[11px] tabular-nums', on ? 'bg-brand-teal/20 text-teal-200' : t.count ? 'bg-white/10 text-gray-200' : 'bg-white/5 text-gray-500')}>
                {typeof t.count === 'number' ? fmtNum(t.count) : t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </HScroll>
  );
}

/** The card a tab renders into: a one-line note, then the toolbar, then the rows. */
export function QueuePanel({ idPrefix = 'queue', active, note, noteTestId, toolbar, footer, children }) {
  return (
    <section id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={active ? `${idPrefix}-tab-${active}` : undefined} className="dz-card overflow-hidden p-0">
      {note ? <p className="border-b border-white/10 px-4 py-2.5 text-xs text-gray-400" data-testid={noteTestId}>{note}</p> : null}
      {toolbar ? <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">{toolbar}</div> : null}
      {children}
      {footer ? <div className="flex justify-end border-t border-white/10 p-3">{footer}</div> : null}
    </section>
  );
}

export function SearchBox({ value, onChange, placeholder, label = 'Search', className = 'w-full sm:w-64' }) {
  return (
    <label className={classNames('relative', className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="dz-input !h-9 !pl-9 text-sm" />
    </label>
  );
}

export function ClearFilters({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-gray-400 hover:text-white">
      <X className="h-3.5 w-3.5" /> Clear
    </button>
  );
}

export function Chips({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={classNames(
            'h-full shrink-0 cursor-pointer whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
            value === o.value ? 'bg-brand-teal text-ink' : 'text-gray-400 hover:bg-white/5 hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageNav({ page, pageCount, total, size, onPage, stale }) {
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(page * size, total);
  return (
    <nav aria-label="Pages" className="flex items-center gap-1.5 text-xs tabular-nums text-gray-400">
      <span data-testid="queue-range">{stale ? 'Searching…' : `${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(total)}`}</span>
      <button type="button" onClick={() => onPage(page - 1)} disabled={stale || page <= 1} aria-label="Previous page" className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-white/10 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => onPage(page + 1)} disabled={stale || page >= pageCount} aria-label="Next page" className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-white/10 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

export function IconAction({ label, onClick, icon: Icon, className, testId, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={classNames(ICON_BTN, className)} data-testid={testId}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

// Fixed columns so a value sits in the same place on every tile; a missing one shows a dash.
export function FactRow({ label, children }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-14 shrink-0 text-[11px] text-gray-500">{label}</dt>
      <dd className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-300 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">{children}</dd>
    </div>
  );
}

export const Cell = ({ children, className }) => (
  <span className={classNames('truncate', className)} title={typeof children === 'string' ? children : undefined}>{children || DASH}</span>
);

/** A queue row without a photo, laid out like the Properties tile: details left, actions in the right rail. */
export function RowCard({ title, lead, badges, meta, facts, chips, primary, figure, icons, testId = 'queue-row', id, selected }) {
  return (
    <li data-testid={testId} data-id={id} className={classNames('list-card glass overflow-hidden rounded-2xl transition hover:border-white/15', selected && 'ring-1 ring-teal-400/50')}>
      <div className="lr">
        <div className="lr-body">
          <div className="lr-info flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {lead}
              <h3 className="min-w-0 truncate text-[15px] font-bold leading-snug text-white" title={typeof title === 'string' ? title : undefined}>{title}</h3>
              {badges ? <span className="flex shrink-0 flex-wrap items-center gap-1.5">{badges}</span> : null}
            </div>
            {meta ? <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-gray-400">{meta}</p> : null}
            {facts ? <dl className={classNames(GROUP, 'space-y-1.5')}>{facts}</dl> : null}
            {chips ? <div className={classNames(GROUP, 'flex flex-wrap items-center gap-1.5')}>{chips}</div> : null}
          </div>
          <div className="flex w-[212px] shrink-0 flex-col items-end border-l border-white/[0.07] pl-[18px] text-right max-md:w-full max-md:items-start max-md:border-l-0 max-md:border-t max-md:pl-0 max-md:pt-3 max-md:text-left">
            <div className="flex min-h-9 flex-wrap items-start justify-end gap-1.5 max-md:justify-start">{primary}</div>
            {figure ? <div className="mt-3">{figure}</div> : null}
            {icons ? <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 pt-3 max-md:justify-start">{icons}</div> : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function RowList({ children, empty, isEmpty }) {
  if (isEmpty) return <p className="p-10 text-center text-sm text-gray-400">{empty}</p>;
  return <ul className="space-y-3 p-3">{children}</ul>;
}

/** Pages an in-memory list; going back to page 1 whenever `resetKey` (the filters) changes. */
export function useClientPaging(items, size, resetKey) {
  const [state, setState] = useState({ page: 1, key: resetKey });
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(state.key === resetKey ? state.page : 1, pageCount);
  return {
    items: items.slice((page - 1) * size, page * size),
    paging: { page, pageCount, total, size, onPage: (p) => setState({ page: p, key: resetKey }) },
  };
}
