import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, RefreshCw, Search } from 'lucide-react';
import { getServiceRequestQueueSummary, listServiceRequestQueue } from '../../../services/serviceRequestService.js';
import PageHeader from '../../../components/ui/PageHeader.jsx';
import Loading from '../../../components/ui/Loading.jsx';
import { classNames, fmtINR, fmtNum } from '../../../lib/format.js';
import { useTabParam } from '../../../lib/useTabParam.js';
import { PageNav } from '../../admin/properties/QueueFilterBar.jsx';
import AgeTone from '../service-queue/AgeTone.jsx';
import RaCaseModal from './RaCaseModal.jsx';
import { caseSummary, nextStep } from './stages.js';

const PAGE_SIZE = 20;
const DESK_TURN = 'assigned,in-progress,changes-requested,approved';
const TABS = [
  { key: 'pickup', label: 'To pick up', query: { status: 'new' }, count: (s) => s.toPickUp, empty: 'Nothing waiting to be picked up.' },
  { key: 'mine', label: 'My cases', query: { mine: true, status: `${DESK_TURN},draft-shared` }, count: (s) => s.mine, empty: 'You hold no open cases.' },
  { key: 'progress', label: 'In progress', query: { status: DESK_TURN }, count: (s) => s.inProgress, empty: 'No case is waiting on the desk.' },
  { key: 'customer', label: 'With customer', query: { status: 'draft-shared' }, count: (s) => s.withCustomer, empty: 'No draft is out with a customer.' },
  { key: 'closed', label: 'Closed', query: { status: 'completed,cancelled' }, count: (s) => s.closed, empty: 'No closed cases yet.' },
];
const TAB_KEYS = TABS.map((t) => t.key);
const GRID = 'lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] lg:items-center lg:gap-3';
const NEXT_TONE = { desk: 'text-teal-200', customer: 'text-gray-400', colleague: 'text-amber-200', done: 'text-gray-500' };

// `stale` keeps the last page on screen but inert until the newer query answers.
function useQueue(query, reloadToken) {
  const key = JSON.stringify(query);
  const [state, setState] = useState({ page: null, failed: false, key: null });
  const debounced = Boolean(query.q);
  useEffect(() => {
    let alive = true;
    const run = () => listServiceRequestQueue(JSON.parse(key))
      .then((res) => { if (alive) setState({ page: res, failed: false, key }); })
      .catch(() => { if (alive) setState({ page: null, failed: true, key }); });
    const t = setTimeout(run, debounced ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [key, reloadToken, debounced]);
  return { ...state, stale: state.key != null && state.key !== key };
}

export default function RentAgreementDesk() {
  const [tab, setTab] = useTabParam(TAB_KEYS, 'pickup');
  const [q, setQ] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [pageTab, setPageTab] = useState(tab);
  if (pageTab !== tab) {
    setPageTab(tab);
    setPage(1);
  }

  // `null` on failure, so a tab count is omitted rather than reading "0".
  const [summary, setSummary] = useState(null);
  const summarySeq = useRef(0);
  const loadSummary = useCallback(() => {
    const seq = ++summarySeq.current;
    const settle = (value) => { if (seq === summarySeq.current) setSummary(value); };
    getServiceRequestQueueSummary('rental').then(settle, () => settle(null));
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => { loadSummary(); setReloadToken((n) => n + 1); }, [loadSummary]);

  const active = TABS.find((t) => t.key === tab);
  const queue = useQueue({
    type: 'rental', ...active.query, overdue: overdue || undefined, q: q.trim() || undefined, page: page - 1, size: PAGE_SIZE,
  }, reloadToken);
  const rows = queue.page?.items || [];
  const total = queue.page?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  // A desk left open must still escalate rows to overdue and notice a colleague taking the open case.
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  // The open case is held as an object: taking it can move it off this tab, and the modal must stay put.
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const openIndex = rows.findIndex((r) => r.id === open?.id);
  const next = rows.slice(openIndex + 1).find((r) => r.id !== open?.id && (!r.assignedTo || r.assignedToMe)) || null;
  const paging = { page, pageCount, total, size: PAGE_SIZE, onPage: setPage, stale: queue.stale };

  return (
    <div className="pb-20">
      <PageHeader
        title="Rent Agreement"
        subtitle="Paid rent agreements, from pick-up to police intimation."
        actions={<button type="button" onClick={reload} className="dz-btn dz-btn-ghost"><RefreshCw className="h-4 w-4" /> Refresh</button>}
      />

      <div role="tablist" aria-label="Rent agreement queues" className="mb-4 flex gap-1 overflow-x-auto border-b border-white/10">
        {TABS.map((t) => {
          const n = summary ? t.count(summary) : null;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`ra-tab-${t.key}`}
              aria-controls="ra-panel"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={classNames(
                '-mb-px flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                on ? 'border-brand-teal text-white' : 'border-transparent text-gray-400 hover:text-white',
              )}
            >
              {t.label}
              {n != null ? (
                <span data-testid={`ra-count-${t.key}`} className={classNames('rounded-full px-1.5 py-px text-[11px] tabular-nums', on ? 'bg-brand-teal/20 text-teal-200' : n ? 'bg-white/10 text-gray-200' : 'bg-white/5 text-gray-500')}>
                  {fmtNum(n)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section id="ra-panel" role="tabpanel" aria-labelledby={`ra-tab-${tab}`} className="dz-card overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Search name, mobile or request id</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, mobile or request id" className="dz-input !h-9 !pl-9 text-sm" />
          </label>
          <button
            type="button"
            aria-pressed={overdue}
            onClick={() => { setOverdue((v) => !v); setPage(1); }}
            className={classNames('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors', overdue ? 'border-rose-400/40 bg-rose-500/15 text-rose-200' : 'border-white/10 text-gray-400 hover:text-white')}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Overdue{summary ? ` ${fmtNum(summary.overdue)}` : ''}
          </button>
          <div className="ml-auto"><PageNav {...paging} /></div>
        </div>

        <div aria-busy={queue.stale || undefined} className={queue.stale ? 'pointer-events-none select-none opacity-50' : undefined}>
          {queue.failed && !queue.stale ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-gray-400" data-testid="queue-error">
              Could not load the rent agreement queue. This is a failed request, not an empty queue.
              <button type="button" onClick={reload} className="dz-btn dz-btn-primary"><RefreshCw className="h-4 w-4" /> Try again</button>
            </div>
          ) : queue.page == null ? <Loading /> : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-gray-400">{q.trim() || overdue ? 'No cases match these filters.' : active.empty}</p>
          ) : (
            <div>
              <div aria-hidden="true" className={classNames(GRID, 'hidden border-b border-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500')}>
                <div>Owner → Tenant</div>
                <div>Flat</div>
                <div>Terms</div>
                <div>Next step</div>
                <div>SLA</div>
                <div>Holder</div>
              </div>
              <ul>{rows.map((row) => <CaseRow key={row.id} row={row} onOpen={() => setOpen(row)} />)}</ul>
            </div>
          )}
        </div>
        {pageCount > 1 ? <div className="flex justify-end border-t border-white/10 p-3"><PageNav {...paging} /></div> : null}
      </section>

      <RaCaseModal
        request={open}
        nextId={next?.id || null}
        onNext={() => setOpen(next)}
        onClose={close}
        onChanged={reload}
        reloadToken={reloadToken}
      />
    </div>
  );
}

function CaseRow({ row, onOpen }) {
  const s = caseSummary(row.details);
  const next = nextStep(row);
  const heldByOther = row.assignedTo && !row.assignedToMe;
  return (
    <li className="border-b border-white/[0.06] last:border-b-0">
      <button type="button" onClick={onOpen} data-testid="ra-row" className={classNames(GRID, 'block w-full cursor-pointer space-y-1 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] lg:space-y-0', heldByOther && 'opacity-70')}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{s.owner || 'Owner not given'}</div>
          <div className="truncate text-xs text-gray-400">→ {s.tenants || 'Tenant not given'}</div>
        </div>
        <div className="min-w-0 truncate text-xs text-gray-300">
          {[s.flat, s.locality].filter(Boolean).join(' · ') || '—'}
        </div>
        <div className="text-xs tabular-nums text-gray-300">
          {s.rent ? `${fmtINR(s.rent)}/mo` : '—'}
          <span className="text-gray-500">{s.deposit ? ` · ${fmtINR(s.deposit)} dep` : ''}{s.months ? ` · ${s.months} mo` : ''}</span>
        </div>
        <div className={classNames('min-w-0 text-xs', NEXT_TONE[next.who])}>{next.text}</div>
        <div className="text-xs"><AgeTone request={row} /></div>
        <div className="truncate text-xs">
          {row.assignedToMe ? <span className="text-teal-200">You</span> : row.assignedTo ? <span className="text-gray-300">{row.assignedTo}</span> : <span className="text-gray-500">Unassigned</span>}
        </div>
      </button>
    </li>
  );
}
