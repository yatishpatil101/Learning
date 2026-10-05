import { useCallback, useEffect, useState } from 'react';
import { Clock, RefreshCw, Search, X } from 'lucide-react';
import { identityReviewSummary, listIdentityReviews } from '../../services/identityReviewService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Select from '../../components/ui/Select.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasPermission } from '../../lib/adminModules.js';
import { classNames, fmtNum } from '../../lib/format.js';
import { useTabParam } from '../../lib/useTabParam.js';
import { Chips, PageNav } from '../admin/properties/QueueFilterBar.jsx';
import KycReviewModal from './kyc/KycReviewModal.jsx';
import { CLAIM_HOLD_LIMIT, DOC_OPTIONS, STATUS_LABELS, dateLabel, docLabel, elapsed } from './kyc/vocabulary.js';

const PAGE_SIZE = 10;
const TABS = [
  { key: 'needs', label: 'Needs review', status: 'pending', count: (s) => s.pending, empty: 'All caught up — no KYC cases waiting.', note: 'Pending cases, oldest first. Opening one claims it for 30 minutes, so nobody else can decide it.' },
  { key: 'qa', label: 'QA sample', status: 'qa', count: (s) => s.qa, empty: 'No approvals waiting for a QA check.', note: 'Approvals picked at random for a second check by a different reviewer. Your own approvals are not listed.' },
  { key: 'decided', label: 'Decided', status: 'decided', count: (s) => s.decided, empty: 'Nothing decided yet.', note: 'Verified, rejected and revoked cases — open one to revoke a badge or read its history.' },
];
const TAB_KEYS = TABS.map((t) => t.key);
const EMPTY_FILTERS = { q: '', docType: '', claim: '', overdue: false, outcome: '', sort: 'oldest' };
const defaultsFor = (tab) => (tab === 'decided' ? { ...EMPTY_FILTERS, sort: 'newest' } : EMPTY_FILTERS);
const OUTCOME_CHIPS = [{ value: '', label: 'Any outcome' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }, { value: 'revoked', label: 'Revoked' }];
const SORT_CHIPS = [{ value: 'oldest', label: 'Oldest' }, { value: 'newest', label: 'Newest' }];
const GRID = 'grid grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.2fr)_4.5rem] items-center gap-3';
const AGE_TONE = { ok: 'text-gray-400', warn: 'font-semibold text-amber-300', breach: 'font-semibold text-rose-300' };

/* Only the filters the tab's server query understands go on the wire. */
function queryFor(tab, f, page) {
  const base = { status: TABS.find((t) => t.key === tab).status, q: f.q.trim() || undefined, docType: f.docType || undefined, sort: f.sort, page: page - 1, size: PAGE_SIZE };
  if (tab === 'needs') return { ...base, claim: f.claim || undefined, overdue: f.overdue || undefined };
  if (tab === 'decided') return { ...base, outcome: f.outcome || undefined };
  return base;
}

// `stale` keeps the last page on screen but inert until the newer query answers.
function useKycQueue(query, reloadToken) {
  const key = JSON.stringify(query);
  const [state, setState] = useState({ page: null, failed: false, key: null });
  const debounced = Boolean(query.q);
  useEffect(() => {
    let alive = true;
    const run = () => listIdentityReviews(JSON.parse(key))
      .then((res) => { if (alive) setState({ page: res, failed: false, key }); })
      .catch((err) => {
        console.error('[OpsIdentityReview] queue failed', key, err);
        if (alive) setState({ page: null, failed: true, key });
      });
    const t = setTimeout(run, debounced ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [key, reloadToken, debounced]);
  return { ...state, stale: state.key != null && state.key !== key };
}

export default function OpsIdentityReview() {
  const { user } = useAuth();
  const canWrite = hasPermission(user, 'identity:write');
  const [tab, setTab] = useTabParam(TAB_KEYS, 'needs');
  const [filters, setFilters] = useState(() => defaultsFor(tab));
  const [page, setPage] = useState(1);
  // Reset during render, not in an effect: the tab also changes from outside (back button).
  const [filtersTab, setFiltersTab] = useState(tab);
  if (filtersTab !== tab) {
    setFiltersTab(tab);
    setFilters(defaultsFor(tab));
    setPage(1);
  }
  const defaults = defaultsFor(tab);
  const filtered = Object.keys(defaults).some((k) => filters[k] !== defaults[k]);
  const changeFilters = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  // `null` on failure, so a tab count is omitted rather than reading "0" — an all-clear nobody issued.
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(() => identityReviewSummary().then(setSummary).catch((err) => {
    console.error('[OpsIdentityReview] summary unavailable', err);
    setSummary(null);
  }), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => { loadSummary(); setReloadToken((n) => n + 1); }, [loadSummary]);

  const queue = useKycQueue(queryFor(tab, filters, page), reloadToken);
  const rows = queue.page?.items || [];
  const total = queue.page?.total ?? 0;
  const pageCount = queue.page?.totalPages ?? 0;

  // A decision can empty the last page; step back rather than showing "nothing here" over a backlog.
  useEffect(() => {
    if (queue.page && !queue.stale && rows.length === 0 && page > 1 && pageCount > 0) setPage(pageCount);
  }, [queue.page, queue.stale, rows.length, page, pageCount]);

  // Without a tick a desk left open never escalates a row to overdue.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAgeTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const [openId, setOpenId] = useState(null);
  const openIndex = rows.findIndex((r) => r.id === openId);
  const nextId = (openIndex >= 0 ? rows.slice(openIndex + 1) : rows)
    .find((r) => r.id !== openId && (!r.claimedByName || r.claimedByMe))?.id || null;

  const active = TABS.find((t) => t.key === tab);
  const paging = { page, pageCount, total, size: PAGE_SIZE, onPage: setPage, stale: queue.stale };

  return (
    <div className="pb-20">
      <PageHeader
        title="KYC Review"
        subtitle="Verify one person at a time. Approval confirms the badge; submission alone does not."
        actions={<button type="button" onClick={reload} className="dz-btn dz-btn-ghost"><RefreshCw className="h-4 w-4" /> Refresh</button>}
      />

      <div role="tablist" aria-label="KYC queues" className="mb-4 flex gap-1 border-b border-white/10">
        {TABS.map((t) => {
          const n = summary ? t.count(summary) : null;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`kyc-tab-${t.key}`}
              aria-controls="kyc-panel"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={classNames(
                '-mb-px flex cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                on ? 'border-brand-teal text-white' : 'border-transparent text-gray-400 hover:text-white',
              )}
            >
              {t.label}
              {n != null ? (
                <span data-testid={`kyc-count-${t.key}`} className={classNames('rounded-full px-1.5 py-px text-[11px] tabular-nums', on ? 'bg-brand-teal/20 text-teal-200' : n ? 'bg-white/10 text-gray-200' : 'bg-white/5 text-gray-500')}>
                  {fmtNum(n)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section id="kyc-panel" role="tabpanel" aria-labelledby={`kyc-tab-${tab}`} className="dz-card overflow-hidden p-0">
        <p className="border-b border-white/10 px-4 py-2.5 text-xs text-gray-400">{active.note}</p>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          <label className="relative w-64">
            <span className="sr-only">Search name or mobile</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input value={filters.q} onChange={(e) => changeFilters({ q: e.target.value })} placeholder="Name or mobile" className="dz-input !h-9 !pl-9 text-sm" />
          </label>
          <div className="w-36"><Select value={filters.docType} onChange={(docType) => changeFilters({ docType })} options={DOC_OPTIONS} ariaLabel="Document type" size="sm" /></div>
          {tab === 'needs' ? (
            <>
              <Chips
                label="Claim"
                value={filters.claim}
                onChange={(claim) => changeFilters({ claim })}
                options={[
                  { value: '', label: 'All' },
                  { value: 'unclaimed', label: 'Unclaimed' },
                  { value: 'mine', label: summary ? `Mine ${summary.mine}/${CLAIM_HOLD_LIMIT}` : 'Mine' },
                  { value: 'others', label: 'Others' },
                ]}
              />
              <button
                type="button"
                aria-pressed={filters.overdue}
                onClick={() => changeFilters({ overdue: !filters.overdue })}
                className={classNames('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors', filters.overdue ? 'border-rose-400/40 bg-rose-500/15 text-rose-200' : 'border-white/10 text-gray-400 hover:text-white')}
              >
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Overdue{summary ? ` ${fmtNum(summary.overdue)}` : ''}
              </button>
            </>
          ) : null}
          {tab === 'decided' ? <Chips label="Outcome" options={OUTCOME_CHIPS} value={filters.outcome} onChange={(outcome) => changeFilters({ outcome })} /> : null}
          <Chips label="Sort" options={SORT_CHIPS} value={filters.sort} onChange={(sort) => changeFilters({ sort })} />
          {filtered ? (
            <button type="button" onClick={() => changeFilters(defaults)} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-gray-400 hover:text-white">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          ) : null}
          <div className="ml-auto"><PageNav {...paging} /></div>
        </div>

        <div aria-busy={queue.stale || undefined} className={queue.stale ? 'pointer-events-none select-none opacity-50' : undefined}>
          {queue.failed && !queue.stale ? (
            <p className="p-10 text-center text-sm text-gray-400" data-testid="queue-error">
              Could not load the KYC queue. This is a failed request, not an empty queue — retry before acting on it.
            </p>
          ) : queue.page == null ? <Loading /> : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-gray-400">{filtered ? 'No cases match these filters.' : active.empty}</p>
          ) : (
            <div>
              <div aria-hidden="true" className={classNames(GRID, 'border-b border-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500')}>
                <div>Applicant</div>
                <div>Document</div>
                <div>{tab === 'needs' ? 'Waiting' : tab === 'qa' ? 'Sampled' : 'Decided'}</div>
                <div>{tab === 'needs' ? 'Claim' : tab === 'qa' ? 'Approved by' : 'Outcome'}</div>
                <div />
              </div>
              <ul>
                {rows.map((row) => <QueueRow key={row.id} row={row} tab={tab} onOpen={() => setOpenId(row.id)} />)}
              </ul>
            </div>
          )}
        </div>
        {pageCount > 1 ? <div className="flex justify-end border-t border-white/10 p-3"><PageNav {...paging} /></div> : null}
      </section>

      <KycReviewModal
        openId={openId}
        nextId={nextId}
        onNext={() => setOpenId(nextId)}
        onClose={() => setOpenId(null)}
        onChanged={reload}
        canWrite={canWrite}
        user={user}
      />
    </div>
  );
}

function QueueRow({ row, tab, onOpen }) {
  const lockedByOther = row.claimedByName && !row.claimedByMe;
  const age = tab === 'needs' ? elapsed(row.submittedAt) : tab === 'qa' ? elapsed(row.qaSampledAt) : null;
  return (
    <li className="border-b border-white/[0.06] last:border-b-0">
      <button type="button" onClick={onOpen} data-testid="kyc-row" className={classNames(GRID, 'w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-white/[0.03]', lockedByOther && 'opacity-60')}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{row.userName || 'Unknown user'}</div>
          <div className="truncate text-xs tabular-nums text-gray-500">{row.userMobile || '—'}</div>
        </div>
        <div className="truncate text-sm text-gray-300">{docLabel(row.docType)}</div>
        <div className={classNames('flex items-center gap-1.5 text-xs tabular-nums', age ? AGE_TONE[age.tone] : 'text-gray-400')}>
          {age ? <><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{age.text}{age.tone === 'breach' ? ' · overdue' : age.tone === 'warn' ? ' · due soon' : ''}</> : dateLabel(row.revokedAt || row.decidedAt)}
        </div>
        <div className="min-w-0 truncate text-xs">
          {tab === 'needs' ? (
            row.claimedByMe ? <span className="text-teal-200">Claimed by you</span>
              : lockedByOther ? <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-amber-200">In review · {row.claimedByName}</span>
                : <span className="text-gray-500">Unclaimed</span>
          ) : tab === 'qa' ? (
            <span className="text-gray-300">{row.approvedByName || row.reviewerName || '—'}</span>
          ) : (
            <Badge status={row.status}>{STATUS_LABELS[row.status] || row.status}</Badge>
          )}
        </div>
        <span className="justify-self-end text-xs font-semibold text-brand-teal">{tab === 'decided' ? 'View' : 'Review'}</span>
      </button>
    </li>
  );
}
