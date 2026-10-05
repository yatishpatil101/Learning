import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { classNames, fmtNum } from '../../../lib/format.js';
import Select from '../../../components/ui/Select.jsx';
import { STATUS_OPTS } from './constants.js';

const PROGRESS_CHIPS = [
  { value: '', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_review', label: 'In review' },
  { value: 'needs_info', label: 'Needs info' },
  { value: 'awaiting_confirmation', label: 'Awaiting owner' },
];
const DEAL_CHIPS = [{ value: '', label: 'All' }, { value: 'buy', label: 'Buy' }, { value: 'rent', label: 'Rent' }];
const SOURCE_CHIPS = [{ value: '', label: 'Any source' }, { value: 'owner', label: 'Owner' }, { value: 'staff', label: 'Staff posted' }];
const SORT_CHIPS = [{ value: 'oldest', label: 'Oldest' }, { value: 'newest', label: 'Newest' }];

export const EMPTY_FILTERS = { q: '', deal: '', progress: '', status: '', source: '', featured: false, sort: 'oldest' };
export const ALL_TAB_DEFAULTS = { ...EMPTY_FILTERS, sort: 'newest' };

export function Chips({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={classNames(
            'h-full cursor-pointer whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
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

/** The one filter bar every queue tab shares: what to look at on the left, where you are on the right. */
export default function QueueFilterBar({ tab, filters, onChange, onClear, paging }) {
  const defaults = tab === 'all' ? ALL_TAB_DEFAULTS : EMPTY_FILTERS;
  const dirty = Object.keys(defaults).some((k) => filters[k] !== defaults[k]);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
      <label className="relative w-full sm:w-64">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Title, owner, mobile or ID"
          className="dz-input !h-9 !pl-9 text-sm"
        />
      </label>
      <Chips label="Deal" options={DEAL_CHIPS} value={filters.deal} onChange={(deal) => onChange({ deal })} />
      {tab === 'verify' ? (
        <Chips label="Progress" options={PROGRESS_CHIPS} value={filters.progress} onChange={(progress) => onChange({ progress })} />
      ) : null}
      {tab === 'all' ? (
        <>
          <div className="w-44"><Select value={filters.status} onChange={(status) => onChange({ status })} options={STATUS_OPTS} ariaLabel="Filter by status" /></div>
          <Chips label="Source" options={SOURCE_CHIPS} value={filters.source} onChange={(source) => onChange({ source })} />
          <button
            type="button"
            aria-pressed={filters.featured}
            onClick={() => onChange({ featured: !filters.featured })}
            className={classNames('h-9 cursor-pointer rounded-lg border px-3 text-xs font-medium transition-colors', filters.featured ? 'border-amber-400/40 bg-amber-500/15 text-amber-200' : 'border-white/10 text-gray-400 hover:text-white')}
          >
            Featured only
          </button>
        </>
      ) : null}
      <Chips label="Sort" options={SORT_CHIPS} value={filters.sort} onChange={(sort) => onChange({ sort })} />
      {dirty ? (
        <button type="button" onClick={onClear} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-gray-400 hover:text-white">
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      ) : null}
      <div className="ml-auto">
        <PageNav {...paging} />
      </div>
    </div>
  );
}
