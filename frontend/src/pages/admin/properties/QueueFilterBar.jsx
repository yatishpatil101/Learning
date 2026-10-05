import { classNames } from '../../../lib/format.js';
import Select from '../../../components/ui/Select.jsx';
import { Chips, ClearFilters, PageNav, SearchBox } from '../../../components/admin/WorkQueue.jsx';
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

/** The one filter bar every queue tab shares: what to look at on the left, where you are on the right. */
export default function QueueFilterBar({ tab, filters, onChange, onClear, paging }) {
  const defaults = tab === 'all' ? ALL_TAB_DEFAULTS : EMPTY_FILTERS;
  const dirty = Object.keys(defaults).some((k) => filters[k] !== defaults[k]);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
      <SearchBox value={filters.q} onChange={(q) => onChange({ q })} placeholder="Title, owner, mobile or ID" />
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
      {dirty ? <ClearFilters onClick={onClear} /> : null}
      <div className="ml-auto">
        <PageNav {...paging} />
      </div>
    </div>
  );
}
