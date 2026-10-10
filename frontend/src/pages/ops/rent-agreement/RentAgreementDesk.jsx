import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getServiceRequestQueueSummary } from '../../../services/serviceRequestService.js';
import PageHeader from '../../../components/ui/PageHeader.jsx';
import Loading from '../../../components/ui/Loading.jsx';
import { classNames, fmtINR } from '../../../lib/format.js';
import { useTabParam } from '../../../lib/useTabParam.js';
import { PageNav, QueueTabs, SearchBox } from '../../../components/admin/WorkQueue.jsx';
import AdminServices from '../../admin/AdminServices.jsx';
import useDeskTickets from '../../admin/useDeskTickets.js';
import AgeTone from '../service-queue/AgeTone.jsx';
import { OverdueToggle, stageTabs, useQueue } from '../service-queue/deskQueue.jsx';
import RaCaseModal from './RaCaseModal.jsx';
import { caseSummary, nextStep } from './stages.js';

const PAGE_SIZE = 20;
const TABS = stageTabs('case');
const TAB_KEYS = TABS.map((t) => t.key);
const GRID = 'lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] lg:items-center lg:gap-3';
const NEXT_TONE = { desk: 'text-teal-200', customer: 'text-gray-400', colleague: 'text-amber-200', done: 'text-gray-500' };

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
  const tickets = useDeskTickets(summary?.openTickets);
  const summarySeq = useRef(0);
  const summaryKey = useRef('');
  const [reloadToken, setReloadToken] = useState(0);
  // A poll re-reads the list only when the summary moved; a user-driven load always does.
  const loadSummary = useCallback((polling = false) => {
    const seq = ++summarySeq.current;
    getServiceRequestQueueSummary('rental').then((value) => {
      if (seq !== summarySeq.current) return;
      const key = JSON.stringify(value);
      const moved = key !== summaryKey.current;
      summaryKey.current = key;
      setSummary(value);
      if (polling && moved) setReloadToken((n) => n + 1);
    }, () => {
      if (seq !== summarySeq.current || polling) return;
      summaryKey.current = '';
      setSummary(null);
    });
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const reload = useCallback(() => { loadSummary(); setReloadToken((n) => n + 1); }, [loadSummary]);

  const active = TABS.find((t) => t.key === tab);
  const queue = useQueue({
    type: 'rental', ...active.query, overdue: overdue || undefined, q: q.trim() || undefined, page: page - 1, size: PAGE_SIZE,
  }, reloadToken);
  const rows = queue.page?.items || [];
  const total = queue.page?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  // A desk left open still escalates rows to overdue, but a hidden tab polls nothing.
  useEffect(() => {
    const poll = () => { if (!document.hidden) loadSummary(true); };
    const t = setInterval(poll, 60_000);
    document.addEventListener('visibilitychange', poll);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', poll); };
  }, [loadSummary]);

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

      <QueueTabs
        label="Rent agreement queues"
        idPrefix="ra"
        countTestId="ra-count"
        active={tickets?.on ? 'tickets' : tab}
        onChange={(key) => (key === 'tickets' ? tickets.show() : setTab(key))}
        tabs={[
          ...TABS.map((t) => ({ key: t.key, label: t.label, count: summary ? t.count(summary) : null })),
          ...(tickets ? [tickets.tab] : []),
        ]}
      />

      {tickets?.on ? <AdminServices desk="rental" embedded idPrefix="ra" /> : (
      <section id="ra-panel" role="tabpanel" aria-labelledby={`ra-tab-${tab}`} className="dz-card overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, mobile or request id" label="Search name, mobile or request id" className="w-full sm:w-72" />
          <OverdueToggle on={overdue} count={summary?.overdue} onToggle={() => { setOverdue((v) => !v); setPage(1); }} />
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
      )}

      <RaCaseModal
        request={open}
        nextId={next?.id || null}
        onNext={() => setOpen(next)}
        onClose={close}
        onChanged={reload}
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
