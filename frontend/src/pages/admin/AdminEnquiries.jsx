import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CheckCircle2, Download, Eye, IndianRupee, MessageSquare, Unlock } from 'lucide-react';
import { listDeals, listEnquiries, listVisits, revealDeal, revealEnquiry, revealVisit } from '../../services/enquiryBoardService.js';
import { addNote } from '../../services/noteService.js';
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
import Loading from '../../components/ui/Loading.jsx';
import DateRangePills from '../../components/ui/DateRangePills.jsx';
import FunnelView from './enquiries/FunnelView.jsx';
import { ENQUIRY_STATUS_OPTS, VISIT_STATUS_OPTS, DEAL_STATUS_OPTS, DEAL_TYPE_OPTS, AWAITING_STATUSES } from './enquiries/constants.js';

/**
 * Timestamps arrive as ISO instants from the server and as pre-written strings from the mock store.
 * Formatting the parseable ones and passing everything else through keeps one column readable under
 * both providers without the page needing to know which one it is talking to.
 */
const fmtWhen = (v) => {
  if (!v) return '\u2014';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * The demand console — enquiries, site visits and closed deals (D25).
 *
 * ## Two things about this page are load-bearing
 *
 * **Mobile numbers arrive masked.** Not blanked, not omitted: `98XXXXX210`. Reading the board is an
 * ops-floor permission, and the board is a list of strangers' contact details, so the list never
 * carries one. An administrator who needs a number opens the row — that is a separate request, on a
 * separate role, and the server writes an `audit_log` entry before it answers. The reveal button is
 * therefore not a disclosure toggle in the browser; there is nothing here to toggle, because the
 * number was never sent.
 *
 * That also silently fixes the CSV export, which used to write `r.mobile` for every filtered row.
 * It still does — it just cannot reach anything now, because the rows in memory are the masked ones.
 *
 * **The board is read-only, and now it is read-only in both modes.** "Responded" writes an
 * **internal note on the listing** rather than flipping a status: `contact_requests.status` is the
 * *owner's* consent decision (`pending → approved | declined`, per `ContactRequestStatuses`), so a
 * desk writing "responded" into it would be forging a consent the owner never gave. A note is a
 * sentence a colleague can read next week and nobody has to take on trust.
 *
 * The console used to carry a second set of buttons — Close, visit completion, cancel, reschedule —
 * that wrote to the browser store through `mutateDb` and were hidden when the domain was live. They
 * are gone. They had no server-side meaning, so what they really offered was a desk that looked like
 * it worked and quietly did nothing to the platform; the toast said "Visit cancelled" and no visitor
 * was ever told. Deleting them is what removed the last `lib/mockApi.js` import under `pages/admin/`.
 */
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
  const [revealing, setRevealing] = useState('');
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

  /**
   * "Responded". The note goes against the **listing**, not against the enquiry: notes are a
   * back-office surface over the four record kinds ops already work cases on, and the listing is the
   * thing a colleague picking this up tomorrow will open. A new note entity for a row that has no
   * writes of its own would be a table to serve one sentence.
   *
   * Unconditional now. `addNote` is a real service call with a provider on both sides, so the mock
   * desk performs the same action the live one does instead of a different, invented one.
   */
  const noteResponded = async (r) => {
    try {
      await addNote('listing', r.propertyId, `Responded to enquiry from ${r.customer}.`, 'responded');
      toast('Note added to the listing');
    } catch (e) {
      toast(e?.message || 'Could not add the note', 'error');
    }
  };

  /**
   * Open one row's contact detail. The reply replaces the row in both the table and the modal, so a
   * revealed number stays readable for the rest of the session without a second audited request —
   * and a failure leaves the masked row exactly as it was.
   */
  const reveal = async (r, kind) => {
    const fetcher = kind === 'deal' ? revealDeal : kind === 'visit' ? revealVisit : revealEnquiry;
    const setter = kind === 'deal' ? setDeals : kind === 'visit' ? setVisits : setEnquiries;
    setRevealing(r.id);
    try {
      const full = await fetcher(r.id);
      setter((prev) => (prev || []).map((x) => (x.id === full.id ? { ...x, ...full } : x)));
      setDetail((d) => (d && d.id === full.id ? { ...d, ...full } : d));
      toast('Contact revealed — this was recorded');
    } catch (e) {
      toast(e?.message || 'Could not reveal the contact', 'error');
    } finally {
      setRevealing('');
    }
  };

  /** `98XXXXX210` is what the board shows; anything else is a real number or nothing. */
  const stillMasked = (r) => /^\d{2}X{5}\d{3}$/.test(String(r?.mobile ?? ''));

  const revealBtn = (r, kind) => (stillMasked(r) ? (
    <button
      onClick={() => reveal(r, kind)}
      disabled={revealing === r.id}
      title="Reveal contact (recorded)"
      aria-label="Reveal contact"
      className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5 disabled:opacity-40"
    ><Unlock className="h-3.5 w-3.5" /></button>
  ) : null);

  const kpis = useMemo(() => {
    const e = enquiries || [];
    const awaiting = e.filter((x) => AWAITING_STATUSES.includes(x.status)).length;
    const gmv = (deals || []).reduce((s, d) => s + (d.value || 0), 0);
    return [
      { label: 'Enquiries', value: fmtNum(e.length), icon: MessageSquare, tab: 'enquiries' },
      { label: 'Awaiting owner', value: fmtNum(awaiting), icon: MessageSquare, tab: 'enquiries' },
      { label: 'Site visits', value: fmtNum((visits || []).length), icon: CalendarCheck, tab: 'visits' },
      { label: 'Deal GMV', value: fmtINR(gmv), icon: IndianRupee, tab: 'deals' },
    ];
  }, [enquiries, visits, deals]);

  const rows = useMemo(() => {
    let base = tab === 'visits' ? visits : tab === 'deals' ? deals : (enquiries || []);
    if (statusF) base = base.filter((r) => r.status === statusF);
    if (typeF) base = base.filter((r) => r.deal === typeF);
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
      {revealBtn(r, 'enquiry')}
      {AWAITING_STATUSES.includes(r.status) ? (
        <button onClick={() => noteResponded(r)} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal hover:bg-brand-teal/20"><CheckCircle2 className="mr-1 inline h-3 w-3" />Responded</button>
      ) : null}
    </>
  );

  const visitActions = (r) => (
    <>
      <button onClick={() => setDetail({ ...r, _kind: 'visit' })} title="View" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Eye className="h-3.5 w-3.5" /></button>
      {revealBtn(r, 'visit')}
    </>
  );

  const dealActions = (r) => (
    <>
      <button onClick={() => setDetail({ ...r, _kind: 'deal' })} title="View" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Eye className="h-3.5 w-3.5" /></button>
      {revealBtn(r, 'deal')}
    </>
  );

  const enquiryCols = [
    { key: 'listing', header: 'Listing', render: (r) => <div><div className="font-semibold">{r.listing}</div><div className="text-xs text-gray-400">{r.id}</div></div> },
    { key: 'customer', header: 'Customer', render: (r) => <div><div>{r.customer}</div><div className="text-xs text-gray-400 tabular-nums">{r.mobile || '—'}</div></div> },
    { key: 'locality', header: 'Locality', render: (r) => <span className="capitalize">{r.locality || '—'}</span> },
    { key: 'at', header: 'When', render: (r) => <span className="text-xs text-gray-400">{fmtWhen(r.at)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', className: 'text-right whitespace-nowrap', render: (r) => (
      <div className="flex justify-end gap-1">{enquiryActions(r)}</div>
    ) },
  ];

  const visitCols = [
    { key: 'listing', header: 'Listing', render: (r) => <div><div className="font-semibold">{r.listing}</div><div className="text-xs text-gray-400">{r.id}</div></div> },
    { key: 'customer', header: 'Customer', render: (r) => <div><div>{r.customer}</div><div className="text-xs text-gray-400 tabular-nums">{r.mobile || '—'}</div></div> },
    { key: 'when', header: 'Visit date', render: (r) => <span className="text-xs text-gray-400">{r.when || fmtWhen(r.slot)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', className: 'text-right whitespace-nowrap', render: (r) => (
      <div className="flex justify-end gap-1">{visitActions(r)}</div>
    ) },
  ];

  const dealCols = [
    { key: 'listing', header: 'Listing', render: (r) => <div><div className="font-semibold">{r.listing}</div><div className="text-xs text-gray-400">{r.id}</div></div> },
    { key: 'deal', header: 'Type', render: (r) => <span className="capitalize">{r.deal}</span> },
    { key: 'value', header: 'Value', className: 'font-semibold', render: (r) => fmtINR(r.value) },
    { key: 'at', header: 'Closed', render: (r) => <span className="text-xs text-gray-400">{fmtWhen(r.at)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', className: 'text-right whitespace-nowrap', render: (r) => (
      dealActions(r)
    ) },
  ];

  // Mobile card renderers — one per tab (columns differ per record type)
  const enquiryCard = (r) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.listing}</div>
          <div className="mt-0.5 text-xs text-gray-500">{r.id} · <span className="capitalize">{r.locality || '—'}</span></div>
        </div>
        <Badge status={r.status} />
      </div>
      <div className="mt-2 text-sm text-gray-300">{r.customer} <span className="text-gray-500 tabular-nums">· {r.mobile || '—'}</span></div>
      <div className="mt-1 text-xs text-gray-500">{fmtWhen(r.at)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">{enquiryActions(r)}</div>
    </div>
  );

  const visitCard = (r) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.listing}</div>
          <div className="mt-0.5 text-xs text-gray-500">{r.id}</div>
        </div>
        <Badge status={r.status} />
      </div>
      <div className="mt-2 text-sm text-gray-300">{r.customer} <span className="text-gray-500 tabular-nums">· {r.mobile || '—'}</span></div>
      <div className="mt-1 text-xs text-gray-400">Visit: {r.when || fmtWhen(r.slot)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">{visitActions(r)}</div>
    </div>
  );

  const dealCard = (r) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.listing}</div>
          <div className="mt-0.5 text-xs text-gray-500">{r.id} · <span className="capitalize">{r.deal}</span></div>
        </div>
        <Badge status={r.status} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-base font-bold text-white">{fmtINR(r.value)}</span>
        <span className="text-xs text-gray-500">Closed {fmtWhen(r.at)}</span>
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

  /**
   * The mobile column exports whatever is in memory, which is the masked form for every row the
   * operator has not deliberately opened. That is the intended behaviour, not a limitation: a
   * spreadsheet of contact details assembled by clicking Export is exactly the disclosure the
   * per-row audited reveal exists to prevent.
   */
  const doExport = () => {
    if (tab === 'deals') exportCsv('draazy-deals.csv', ['ID', 'Listing', 'Deal', 'Value', 'Date', 'Status'], rows.map((r) => [r.id, r.listing, r.deal, r.value, fmtWhen(r.at), r.status]));
    else if (tab === 'visits') exportCsv('draazy-visits.csv', ['ID', 'Listing', 'Customer', 'Mobile', 'When', 'Status'], rows.map((r) => [r.id, r.listing, r.customer, r.mobile, r.when || fmtWhen(r.slot), r.status]));
    else exportCsv('draazy-enquiries.csv', ['ID', 'Listing', 'Customer', 'Mobile', 'Locality', 'Date', 'Status'], rows.map((r) => [r.id, r.listing, r.customer, r.mobile, r.locality, fmtWhen(r.at), r.status]));
  };

  return (
    <div>
      <PageHeader title="Enquiries & Deals" subtitle="Buyer and tenant demand — enquiries, scheduled visits and closed deals." actions={<button onClick={doExport} className="dz-btn dz-btn-ghost"><Download className="h-4 w-4" />Export CSV</button>} />

      {/* KPI tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.filter((k) => {
          if (k.tab === 'visits') return visitsEnabled;
          if (k.tab === 'deals') return dealsEnabled;
          return true;
        }).map((k) => (
          <div key={k.label} onClick={() => setTab(k.tab)} className="dz-card cursor-pointer p-4 hover:bg-white/5">
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listing, customer, mobile…" className="dz-input flex-1 min-w-[200px] max-w-sm" />
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
            {tab === 'deals' && (
              <div style={{ width: '130px' }}>
                <Select
                  value={typeF}
                  onChange={setTypeF}
                  placeholder="All types"
                  ariaLabel="Filter by type"
                  options={DEAL_TYPE_OPTS}
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

      {/* Detail modal.

          It used to render `Object.entries(detail)` — every field the row happened to carry, in
          whatever order the object was built, with a heading derived from the property name. That is
          a debugger, not a panel: it printed internal ids beside contact details under labels like
          "Property Id", and it grew a row every time a mapper gained a field. The fields below are
          the ones somebody reading a case needs, named once. */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? (detail._kind === 'deal' ? `Deal · ${detail.id}` : detail._kind === 'visit' ? `Site visit · ${detail.id}` : `Enquiry · ${detail.id}`) : ''} size="md">
        {detail ? (
          <>
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
            {stillMasked(detail) ? (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-gray-400">This number is masked. Revealing it is recorded against your account.</p>
                <button
                  onClick={() => reveal(detail, detail._kind)}
                  disabled={revealing === detail.id}
                  className="dz-btn dz-btn-ghost shrink-0 disabled:opacity-40"
                ><Unlock className="h-4 w-4" />{revealing === detail.id ? 'Revealing…' : 'Reveal contact'}</button>
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}
