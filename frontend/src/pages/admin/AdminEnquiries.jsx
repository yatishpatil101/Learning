import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CheckCircle2, Download, Eye, IndianRupee, MessageSquare, X } from 'lucide-react';
import { listDeals, listEnquiries, listVisits, logAudit } from '../../lib/mockApi.js';
import { fmtINR, fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import DateField from '../../components/ui/DateField.jsx';
import TimeField from '../../components/ui/TimeField.jsx';
import Loading from '../../components/ui/Loading.jsx';
import DateRangePills from '../../components/ui/DateRangePills.jsx';
import FunnelView from './enquiries/FunnelView.jsx';
import { ENQUIRY_STATUS_OPTS, VISIT_STATUS_OPTS, DEAL_STATUS_OPTS, ENQUIRY_TYPE_OPTS, DEAL_TYPE_OPTS } from './enquiries/constants.js';
import { updateCollection } from './enquiries/helpers.js';
import { parseWhen, formatWhen, isoFromWhen, todayIso } from '../../lib/visitWhen.js';

export default function AdminEnquiries() {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const [tab, setTab] = useTabParam(['enquiries', 'visits', 'deals', 'funnel'], 'enquiries');
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [typeF, setTypeF] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [enquiries, setEnquiries] = useState(null);
  const [visits, setVisits] = useState([]);
  const [deals, setDeals] = useState([]);
  const [detail, setDetail] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('10:30 AM');
  const [funnelTime, setFunnelTime] = useState('');

  const visitsEnabled = optionEnabled('enquiries.visits');
  const dealsEnabled = optionEnabled('enquiries.deals');

  const reload = () =>
    Promise.all([
      listEnquiries(),
      visitsEnabled ? listVisits() : Promise.resolve([]),
      dealsEnabled ? listDeals() : Promise.resolve([]),
    ]).then(([e, v, d]) => {
      setEnquiries(e); setVisits(v); setDeals(d);
    });

  useEffect(() => { let a = true; reload().then(() => !a); return () => { a = false; }; }, [visitsEnabled, dealsEnabled]); // eslint-disable-line

  const act = async (col, id, patch, msg, type = 'success') => {
    updateCollection(col, id, patch);
    logAudit('Enquiries', `${msg} (${id})`);
    await reload();
    toast(msg, type);
  };

  const kpis = useMemo(() => {
    const e = enquiries || [];
    const openLeads = e.filter((x) => x.status === 'new' || x.status === 'open').length;
    const gmv = (deals || []).reduce((s, d) => s + (d.value || 0), 0);
    return [
      { label: 'Enquiries', value: fmtNum(e.length), icon: MessageSquare, tab: 'enquiries' },
      { label: 'Open leads', value: fmtNum(openLeads), icon: MessageSquare, tab: 'enquiries' },
      { label: 'Site visits', value: fmtNum((visits || []).length), icon: CalendarCheck, tab: 'visits' },
      { label: 'Deal GMV', value: fmtINR(gmv), icon: IndianRupee, tab: 'deals' },
    ];
  }, [enquiries, visits, deals]);

  const rows = useMemo(() => {
    let base = tab === 'visits' ? visits : tab === 'deals' ? deals : (enquiries || []);
    if (statusF) base = base.filter((r) => r.status === statusF);
    if (typeF) base = base.filter((r) => r.kind === typeF || r.deal === typeF);
    if (q) { const n = q.toLowerCase(); base = base.filter((r) => JSON.stringify(r).toLowerCase().includes(n)); }
    if (dateRange) {
      const cutoff = Date.now() - Number(dateRange) * 86400000;
      base = base.filter((r) => new Date(r.at || r.when || '').getTime() >= cutoff);
    }
    return base;
  }, [tab, q, statusF, typeF, dateRange, enquiries, visits, deals]);

  if (!enquiries) return <Loading />;

  const enquiryActions = (r) => (
    <>
      <button onClick={() => setDetail({ ...r, _kind: 'enquiry' })} title="View" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Eye className="h-3.5 w-3.5" /></button>
      {r.status === 'new' || r.status === 'open' ? <>
        <button onClick={() => act('enquiries', r.id, { status: 'responded' }, 'Marked as responded')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal hover:bg-brand-teal/20"><CheckCircle2 className="mr-1 inline h-3 w-3" />Responded</button>
        <button onClick={() => act('enquiries', r.id, { status: 'closed' }, 'Enquiry closed', 'error')} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"><X className="mr-1 inline h-3 w-3" />Close</button>
      </> : null}
    </>
  );

  const visitActions = (r) => (
    <>
      <button onClick={() => setDetail({ ...r, _kind: 'visit' })} title="View" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Eye className="h-3.5 w-3.5" /></button>
      {r.status !== 'completed' && r.status !== 'cancelled' ? <>
        <button onClick={() => act('visits', r.id, { status: 'completed' }, 'Visit completed')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal"><CheckCircle2 className="mr-1 inline h-3 w-3" />Completed</button>
        <button onClick={() => { const pw = parseWhen(r.when); setReschedule(r); setRescheduleDate(isoFromWhen(r.when) || todayIso()); setRescheduleTime(pw.timeLabel || '10:30 AM'); }} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"><CalendarCheck className="mr-1 inline h-3 w-3" />Reschedule</button>
        <button onClick={() => act('visits', r.id, { status: 'cancelled' }, 'Visit cancelled', 'error')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"><X className="mr-1 inline h-3 w-3" />Cancel</button>
      </> : null}
    </>
  );

  const dealActions = (r) => (
    <button onClick={() => setDetail({ ...r, _kind: 'deal' })} title="View" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Eye className="h-3.5 w-3.5" /></button>
  );

  const enquiryCols = [
    { key: 'listing', header: 'Listing', render: (r) => <div><div className="font-semibold">{r.listing}</div><div className="text-xs text-gray-400">{r.id}</div></div> },
    { key: 'customer', header: 'Customer', render: (r) => <div><div>{r.customer}</div><div className="text-xs text-gray-400">{r.mobile}</div></div> },
    { key: 'kind', header: 'Type', render: (r) => <span className="capitalize">{r.kind || '—'}</span> },
    { key: 'at', header: 'When', render: (r) => <span className="text-xs text-gray-400">{r.at}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', className: 'text-right whitespace-nowrap', render: (r) => (
      <div className="flex justify-end gap-1">{enquiryActions(r)}</div>
    ) },
  ];

  const visitCols = [
    { key: 'listing', header: 'Listing', render: (r) => <div><div className="font-semibold">{r.listing}</div><div className="text-xs text-gray-400">{r.id}</div></div> },
    { key: 'customer', header: 'Customer', render: (r) => <div><div>{r.customer}</div><div className="text-xs text-gray-400">{r.mobile}</div></div> },
    { key: 'when', header: 'Visit date', render: (r) => <span className="text-xs text-gray-400">{r.when}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', className: 'text-right whitespace-nowrap', render: (r) => (
      <div className="flex justify-end gap-1">{visitActions(r)}</div>
    ) },
  ];

  const dealCols = [
    { key: 'listing', header: 'Listing', render: (r) => <div><div className="font-semibold">{r.listing}</div><div className="text-xs text-gray-400">{r.id}</div></div> },
    { key: 'deal', header: 'Type', render: (r) => <span className="capitalize">{r.deal}</span> },
    { key: 'value', header: 'Value', className: 'font-semibold', render: (r) => fmtINR(r.value) },
    { key: 'at', header: 'Closed', render: (r) => <span className="text-xs text-gray-400">{r.at}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', className: 'text-right whitespace-nowrap', render: (r) => (
      dealActions(r)
    ) },
  ];

  // Mobile card renderers — one per tab (columns differ per record type)
  const enquiryCard = (r) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.listing}</div>
          <div className="mt-0.5 text-xs text-gray-500">{r.id} · <span className="capitalize">{r.kind || '—'}</span></div>
        </div>
        <Badge status={r.status} />
      </div>
      <div className="mt-2 text-sm text-gray-300">{r.customer} <span className="text-gray-500">· {r.mobile}</span></div>
      <div className="mt-1 text-xs text-gray-500">{r.at}</div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">{enquiryActions(r)}</div>
    </div>
  );

  const visitCard = (r) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.listing}</div>
          <div className="mt-0.5 text-xs text-gray-500">{r.id}</div>
        </div>
        <Badge status={r.status} />
      </div>
      <div className="mt-2 text-sm text-gray-300">{r.customer} <span className="text-gray-500">· {r.mobile}</span></div>
      <div className="mt-1 text-xs text-gray-400">Visit: {r.when}</div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">{visitActions(r)}</div>
    </div>
  );

  const dealCard = (r) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.listing}</div>
          <div className="mt-0.5 text-xs text-gray-500">{r.id} · <span className="capitalize">{r.deal}</span></div>
        </div>
        <Badge status={r.status} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-base font-bold text-white">{fmtINR(r.value)}</span>
        <span className="text-xs text-gray-500">Closed {r.at}</span>
      </div>
      <div className="mt-3 flex items-center gap-1.5 border-t border-white/5 pt-3">{dealActions(r)}</div>
    </div>
  );

  const MOBILE_CARDS = { enquiries: enquiryCard, visits: visitCard, deals: dealCard };

  const COLS = { enquiries: enquiryCols, visits: visitCols, deals: dealCols };
  const ALL_TABS = [['enquiries', 'Enquiries', enquiries.length], ['visits', 'Visits', visits.length], ['deals', 'Deals', deals.length], ['funnel', 'Funnel', '']];
  const TABS = ALL_TABS.filter(([id]) => {
    if (id === 'visits') return visitsEnabled;
    if (id === 'deals') return dealsEnabled;
    return true;
  });

  const doExport = () => {
    if (tab === 'deals') exportCsv('punenest-deals.csv', ['ID', 'Listing', 'Deal', 'Value', 'Date', 'Status'], rows.map((r) => [r.id, r.listing, r.deal, r.value, r.at, r.status]));
    else if (tab === 'visits') exportCsv('punenest-visits.csv', ['ID', 'Listing', 'Customer', 'Mobile', 'When', 'Status'], rows.map((r) => [r.id, r.listing, r.customer, r.mobile, r.when, r.status]));
    else exportCsv('punenest-enquiries.csv', ['ID', 'Listing', 'Customer', 'Mobile', 'Type', 'Date', 'Status'], rows.map((r) => [r.id, r.listing, r.customer, r.mobile, r.kind, r.at, r.status]));
  };

  return (
    <div>
      <PageHeader title="Enquiries & Deals" subtitle="Buyer and tenant demand — enquiries, scheduled visits and closed deals." actions={<button onClick={doExport} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" />Export CSV</button>} />

      {/* KPI tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.filter((k) => {
          if (k.tab === 'visits') return visitsEnabled;
          if (k.tab === 'deals') return dealsEnabled;
          return true;
        }).map((k) => (
          <div key={k.label} onClick={() => setTab(k.tab)} className="pn-card cursor-pointer p-4 hover:bg-white/5">
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{k.label}</div><div className="mt-1 text-2xl font-extrabold">{k.value}</div></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><k.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <HScroll fadeColor="var(--brand-card, #1a1730)" wrapClassName="mb-4" className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {TABS.map(([id, label, count]) => (
          <button key={id} onClick={() => { setTab(id); setStatusF(''); setTypeF(''); }} className={classNames('flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            {label} {count !== '' ? <span className="opacity-70">({fmtNum(count)})</span> : null}
          </button>
        ))}
      </HScroll>

      {/* Filters — search left, dropdowns right */}
      {tab !== 'funnel' && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listing, customer, mobile…" className="pn-input flex-1 min-w-[200px] max-w-sm" />
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <div style={{ width: '140px' }}>
              <Select
                value={statusF}
                onChange={setStatusF}
                placeholder="All statuses"
                ariaLabel="Filter by status"
                options={tab === 'enquiries' ? ENQUIRY_STATUS_OPTS : tab === 'visits' ? VISIT_STATUS_OPTS : DEAL_STATUS_OPTS}
              />
            </div>
            {tab !== 'visits' && (
              <div style={{ width: '130px' }}>
                <Select
                  value={typeF}
                  onChange={setTypeF}
                  placeholder="All types"
                  ariaLabel="Filter by type"
                  options={tab === 'enquiries' ? ENQUIRY_TYPE_OPTS : DEAL_TYPE_OPTS}
                />
              </div>
            )}
            <DateRangePills value={dateRange} onChange={setDateRange} />
            <span className="text-xs text-gray-500 tabular-nums">{rows.length} shown</span>
          </div>
        </div>
      )}

      {tab !== 'funnel' ? (
        <Table columns={COLS[tab]} rows={rows} pageSize={10} label="records" empty="Nothing matches this filter." mobileCard={MOBILE_CARDS[tab]} />
      ) : (
        <FunnelView enquiries={enquiries || []} visits={visits || []} deals={deals || []} funnelTime={funnelTime} setFunnelTime={setFunnelTime} />
      )}

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? (detail._kind === 'deal' ? `Deal · ${detail.id}` : detail._kind === 'visit' ? `Site visit · ${detail.id}` : `Enquiry · ${detail.id}`) : ''} size="md">
        {detail ? (
          <dl className="space-y-2 text-sm">
            {Object.entries(detail).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-white/5 py-1.5">
                <dt className="capitalize text-gray-400">{k.replace(/([A-Z])/g, ' $1')}</dt>
                <dd className="font-medium">{typeof v === 'number' && k === 'value' ? fmtINR(v) : String(v ?? '—')}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Modal>

      {/* Reschedule modal */}
      <Modal open={!!reschedule} onClose={() => setReschedule(null)} title={reschedule ? `Reschedule visit · ${reschedule.id}` : ''} size="sm" footer={<>
        <button onClick={() => setReschedule(null)} className="pn-btn pn-btn-ghost">Cancel</button>
        <button onClick={() => { const mode = parseWhen(reschedule.when).mode || 'in-person'; act('visits', reschedule.id, { when: formatWhen(rescheduleDate, rescheduleTime, mode) }, 'Visit rescheduled'); setReschedule(null); }} disabled={!rescheduleDate || !rescheduleTime} className="pn-btn pn-btn-primary disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
      </>}>
        <div className="space-y-3">
          <label className="block text-sm"><span className="mb-1.5 block text-gray-400">New visit date</span>
            <DateField value={rescheduleDate} onChange={setRescheduleDate} min={todayIso()} ariaLabel="New visit date" className="pn-input" />
          </label>
          <div>
            <span className="mb-1.5 block text-sm text-gray-400">Time slot</span>
            <TimeField value={rescheduleTime} onChange={setRescheduleTime} ariaLabel="New visit time" className="pn-input" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
