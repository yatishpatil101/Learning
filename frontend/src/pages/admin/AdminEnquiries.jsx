import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Eye } from 'lucide-react';
import { getDeal, getEnquiry, getEnquirySummary, getVisit, listDeals, listEnquiries, listVisits } from '../../services/enquiryBoardService.js';
import { addNote } from '../../services/noteService.js';
import { fmtINR, fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { MAX_PAGE_SIZE } from '../../services/apiLimits.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, Cell, Chips, ClearFilters, DATE_CHIPS, FactRow, IconAction, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox,
} from '../../components/admin/WorkQueue.jsx';
import FunnelView from './enquiries/FunnelView.jsx';
import { ENQUIRY_STATUS_OPTS, VISIT_STATUS_OPTS, DEAL_STATUS_OPTS, DEAL_TYPE_OPTS, AWAITING_STATUSES } from './enquiries/constants.js';

// Non-ISO values (a pre-written slot string) pass through unchanged.
const fmtWhen = (v) => {
  if (!v) return '\u2014';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const STATUS_OPTS = { enquiries: ENQUIRY_STATUS_OPTS, visits: VISIT_STATUS_OPTS, deals: DEAL_STATUS_OPTS };
const KIND = { enquiries: 'enquiry', visits: 'visit', deals: 'deal' };
const LISTERS = { enquiries: listEnquiries, visits: listVisits, deals: listDeals };
const PAGE_SIZE = 10;
const NOTES = {
  enquiries: 'Contact requests from buyers and tenants. The owner approves or declines; Responded adds a note to the listing.',
  visits: 'Site visits booked by buyers and tenants. The visitor and owner manage the slot.',
  funnel: 'Enquiry \u2192 visit \u2192 deal conversion, overall and by locality.',
};
const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

/** The board is read-only: `contact_requests.status` is the owner's decision, so "Responded" writes a note.
 * Lists carry masked mobiles; opening a row's detail returns the full number and is audited. */
export default function AdminEnquiries() {
  const { toast } = useToast();
  const [tab, setTab] = useTabParam(['enquiries', 'visits', 'deals', 'funnel'], 'enquiries');
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [typeF, setTypeF] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [list, setList] = useState(null);
  const [stale, setStale] = useState(false);
  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [funnelTime, setFunnelTime] = useState('');
  const [qLive, setQLive] = useState('');
  const resetKey = `${tab}|${statusF}|${typeF}|${qLive}|${dateRange}`;
  const [pageState, setPageState] = useState({ page: 1, key: resetKey });
  const page = pageState.key === resetKey ? pageState.page : 1;
  const latest = useRef(0);

  // Debounced: `q` changes on every keystroke and each settled value is a request.
  useEffect(() => {
    const id = setTimeout(() => setQLive(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    if (tab === 'funnel') return undefined;
    const ticket = ++latest.current;
    setStale(true);
    LISTERS[tab]({ status: statusF, deal: tab === 'deals' ? typeF : '', q: qLive, days: dateRange, page: page - 1, size: PAGE_SIZE })
      .then((res) => { if (ticket === latest.current) { setList(res); setStale(false); } })
      .catch((e) => { if (ticket === latest.current) { setStale(false); setList((cur) => cur || { items: [], total: 0 }); toast(e?.message || 'Could not load the board', 'error'); } });
    return () => { latest.current += 1; };
  }, [tab, statusF, typeF, qLive, dateRange, page, toast]);

  // One read feeds the tab and chip counts, the GMV note and the funnel; only the funnel date filter moves it.
  useEffect(() => {
    let live = true;
    getEnquirySummary({ days: funnelTime })
      .then((s) => { if (live) setSummary(s); })
      .catch((e) => toast(e?.message || 'Could not load the board totals', 'error'));
    return () => { live = false; };
  }, [funnelTime, toast]);

  // Filed against the listing: that is the case file a colleague opens tomorrow.
  const noteResponded = async (r) => {
    try {
      await addNote('listing', r.propertyId, `Responded to enquiry from ${r.customer}.`, 'responded');
      toast('Note added to the listing');
    } catch (e) {
      toast(e?.message || 'Could not add the note', 'error');
    }
  };

  const openDetail = async (r, kind) => {
    setDetail({ ...r, _kind: kind });
    const fetcher = kind === 'deal' ? getDeal : kind === 'visit' ? getVisit : getEnquiry;
    try {
      const full = await fetcher(r.id);
      setDetail((d) => (d && d.id === full.id ? { ...d, ...full } : d));
    } catch (e) {
      toast(e?.message || 'Could not load the latest details', 'error');
    }
  };

  if (!summary || (tab !== 'funnel' && !list)) return <Loading />;

  const rows = list?.items ?? [];
  const total = list?.total ?? 0;
  const paging = { page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, size: PAGE_SIZE, stale, onPage: (p) => setPageState({ page: p, key: resetKey }) };
  const switchTab = (id) => { setTab(id); setStatusF(''); setTypeF(''); };
  const filtered = Boolean(statusF || typeF || q || dateRange);
  const clear = () => { setStatusF(''); setTypeF(''); setQ(''); setDateRange(''); };
  const tabCounts = summary[tab] || {};
  const countChips = (opts, counts) => opts.map(([value, label]) => ({
    value, label: `${label} ${fmtNum(counts[value || 'all'] ?? 0)}`,
  }));

  const tabs = [
    { key: 'enquiries', label: 'Enquiries', count: summary.enquiries.all },
    { key: 'visits', label: 'Visits', count: summary.visits.all },
    { key: 'deals', label: 'Deals', count: summary.deals.all },
    { key: 'funnel', label: 'Funnel', count: null },
  ];

  const note = tab === 'deals' ? `Deals agreed through the platform \u2014 ${fmtINR(summary.gmv)} across all deals.` : NOTES[tab];

  // The export is the first 100 matching rows; the list's masked mobile is what it carries.
  const doExport = async () => {
    try {
      const all = (await LISTERS[tab]({ status: statusF, deal: tab === 'deals' ? typeF : '', q: qLive, days: dateRange, page: 0, size: MAX_PAGE_SIZE })).items;
      if (tab === 'deals') exportCsv('draazy-deals.csv', ['ID', 'Listing', 'Deal', 'Value', 'Date', 'Status'], all.map((r) => [r.id, r.listing, r.deal, r.value, fmtWhen(r.at), r.status]));
      else if (tab === 'visits') exportCsv('draazy-visits.csv', ['ID', 'Listing', 'Customer', 'Mobile', 'When', 'Status'], all.map((r) => [r.id, r.listing, r.customer, r.mobile, r.when || fmtWhen(r.slot), r.status]));
      else exportCsv('draazy-enquiries.csv', ['ID', 'Listing', 'Customer', 'Mobile', 'Locality', 'Date', 'Status'], all.map((r) => [r.id, r.listing, r.customer, r.mobile, r.locality, fmtWhen(r.at), r.status]));
    } catch (e) {
      toast(e?.message || 'Could not export the board', 'error');
    }
  };

  const icons = (r) => <IconAction label="View" icon={Eye} onClick={() => openDetail(r, KIND[tab])} />;

  const contact = (r, label) => (r.customer || r.mobile ? (
    <FactRow label={label}>
      <Cell className="font-medium text-gray-200">{r.customer}</Cell>
      <Cell className="tabular-nums">{r.mobile}</Cell>
    </FactRow>
  ) : null);

  const meta = (r) => {
    if (tab === 'visits') return <><span>Visit {r.when || fmtWhen(r.slot)}</span>{r.locality ? <><Dot /><span className="capitalize">{r.locality}</span></> : null}</>;
    if (tab === 'deals') return <><span>Closed {fmtWhen(r.at)}</span><Dot /><span className="capitalize">{r.deal}</span>{r.locality ? <><Dot /><span className="capitalize">{r.locality}</span></> : null}</>;
    return <><span>Raised {fmtWhen(r.at)}</span>{r.locality ? <><Dot /><span className="capitalize">{r.locality}</span></> : null}</>;
  };

  const toolbar = (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Listing, customer or mobile" label="Search the board" />
      <Chips label="Status" options={countChips(STATUS_OPTS[tab] || [], tabCounts)} value={statusF} onChange={setStatusF} />
      {tab === 'deals' ? <Chips label="Type" options={countChips(DEAL_TYPE_OPTS, summary.dealTypes)} value={typeF} onChange={setTypeF} /> : null}
      <Chips label="Date" options={DATE_CHIPS} value={dateRange} onChange={setDateRange} />
      {filtered ? <ClearFilters onClick={clear} /> : null}
      <div className="ml-auto"><PageNav {...paging} /></div>
    </>
  );
  return (
    <div>
      <PageHeader title="Enquiries & Deals" subtitle="Buyer and tenant demand — enquiries, scheduled visits and closed deals." actions={tab !== 'funnel' ? <button type="button" onClick={doExport} className="dz-btn dz-btn-ghost"><Download className="h-4 w-4" />Export CSV</button> : null} />

      <QueueTabs label="Demand board" active={tab} onChange={switchTab} tabs={tabs} />

      {tab === 'funnel' ? (
        <QueuePanel
          active="funnel"
          note={NOTES.funnel}
          toolbar={(
            <>
              <Chips label="Date" options={DATE_CHIPS} value={funnelTime} onChange={setFunnelTime} />
            </>
          )}
        >
          <div className="p-4">
            <FunnelView funnel={summary.funnel} />
          </div>
        </QueuePanel>
      ) : (
        <QueuePanel active={tab} note={note} toolbar={toolbar} footer={paging.pageCount > 1 ? <PageNav {...paging} /> : null}>
          <RowList isEmpty={!rows.length} empty={filtered ? 'Nothing matches these filters.' : `No ${tab} yet.`}>
            {rows.map((r) => (
              <RowCard
                key={r.id}
                id={r.id}
                title={r.listing}
                badges={<Badge status={r.status}>{tab === 'enquiries' && r.status === 'pending' ? 'Awaiting owner' : undefined}</Badge>}
                meta={meta(r)}
                facts={contact(r, tab === 'visits' ? 'Visitor' : 'Customer')}
                primary={tab === 'enquiries' && AWAITING_STATUSES.includes(r.status) ? (
                  <button type="button" onClick={() => noteResponded(r)} className={BTN.primary}><CheckCircle2 className="h-3.5 w-3.5" />Responded</button>
                ) : null}
                figure={tab === 'deals' ? <span className="text-lg font-bold tabular-nums text-white">{fmtINR(r.value)}</span> : null}
                icons={icons(r)}
              />
            ))}
          </RowList>
        </QueuePanel>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? (detail._kind === 'deal' ? `Deal · ${detail.id}` : detail._kind === 'visit' ? `Site visit · ${detail.id}` : `Enquiry · ${detail.id}`) : ''} size="md">
        {detail ? (
          <dl className="space-y-2 text-sm">
            {[
              ['Listing', detail.listing],
              ['Locality', detail.locality],
              ['Status', detail.status],
              detail._kind === 'deal' ? ['Deal type', detail.deal] : null,
              detail._kind === 'deal' ? ['Agreed value', fmtINR(detail.value)] : null,
              detail._kind === 'visit' ? ['Visit slot', detail.when || fmtWhen(detail.slot)] : null,
              detail._kind === 'visit' ? ['Mode', detail.mode] : null,
              ['Customer', detail.customer],
              ['Mobile', detail.mobile],
              [detail._kind === 'deal' ? 'Closed' : 'Raised', fmtWhen(detail.at)],
            ].filter(Boolean).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2 border-b border-white/5 py-1.5">
                <dt className="text-gray-400">{label}</dt>
                <dd className={classNames('font-medium capitalize', label === 'Mobile' ? 'tabular-nums normal-case' : '')}>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
