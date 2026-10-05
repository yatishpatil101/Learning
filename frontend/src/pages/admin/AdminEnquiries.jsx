import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Eye, Unlock } from 'lucide-react';
import { listDeals, listEnquiries, listVisits, revealDeal, revealEnquiry, revealVisit } from '../../services/enquiryBoardService.js';
import { addNote } from '../../services/noteService.js';
import { fmtINR, fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, Cell, Chips, ClearFilters, DATE_CHIPS, FactRow, IconAction, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox, useClientPaging,
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
const NOTES = {
  enquiries: 'Contact requests from buyers and tenants. The owner approves or declines; Responded adds a note to the listing.',
  visits: 'Site visits booked by buyers and tenants. The visitor and owner manage the slot.',
  funnel: 'Enquiry \u2192 visit \u2192 deal conversion, overall and by locality.',
};
const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

/** Mobile numbers arrive masked; revealing one is a separate audit-logged request, so the CSV cannot leak it.
 * Read-only: `contact_requests.status` is the owner's consent, so no Close/cancel button has a server meaning. */
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
  const [funnelDeal, setFunnelDeal] = useState('');

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

  // Filed against the listing: that is the case file a colleague opens tomorrow.
  const noteResponded = async (r) => {
    try {
      await addNote('listing', r.propertyId, `Responded to enquiry from ${r.customer}.`, 'responded');
      toast('Note added to the listing');
    } catch (e) {
      toast(e?.message || 'Could not add the note', 'error');
    }
  };

  // The reply replaces the row in place, so a revealed number stays readable without a second audited request.
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

  const stillMasked = (r) => /^\d{2}X{5}\d{3}$/.test(String(r?.mobile ?? ''));

  const base = tab === 'visits' ? visits : tab === 'deals' ? deals : (enquiries || []);
  const needle = q.trim().toLowerCase();
  const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
  const rows = base.filter((r) => (!statusF || r.status === statusF)
    && (!typeF || r.deal === typeF)
    && (!needle || JSON.stringify(r).toLowerCase().includes(needle))
    && (!cutoff || new Date(r.at || r.slot || r.when || '').getTime() >= cutoff));
  const page = useClientPaging(rows, 10, `${tab}|${statusF}|${typeF}|${q}|${dateRange}`);

  if (!enquiries) return <Loading />;

  const switchTab = (id) => { setTab(id); setStatusF(''); setTypeF(''); };
  const filtered = Boolean(statusF || typeF || q || dateRange);
  const clear = () => { setStatusF(''); setTypeF(''); setQ(''); setDateRange(''); };
  const countChips = (opts, key) => opts.map(([value, label]) => ({
    value, label: `${label} ${fmtNum(value ? base.filter((r) => r[key] === value).length : base.length)}`,
  }));

  const tabs = [
    { key: 'enquiries', label: 'Enquiries', count: enquiries.length },
    visitsEnabled ? { key: 'visits', label: 'Visits', count: visits.length } : null,
    dealsEnabled ? { key: 'deals', label: 'Deals', count: deals.length } : null,
    { key: 'funnel', label: 'Funnel', count: null },
  ].filter(Boolean);

  const gmv = deals.reduce((s, d) => s + (d.value || 0), 0);
  const note = tab === 'deals' ? `Deals agreed through the platform \u2014 ${fmtINR(gmv)} across all deals.` : NOTES[tab];

  const doExport = () => {
    if (tab === 'deals') exportCsv('draazy-deals.csv', ['ID', 'Listing', 'Deal', 'Value', 'Date', 'Status'], rows.map((r) => [r.id, r.listing, r.deal, r.value, fmtWhen(r.at), r.status]));
    else if (tab === 'visits') exportCsv('draazy-visits.csv', ['ID', 'Listing', 'Customer', 'Mobile', 'When', 'Status'], rows.map((r) => [r.id, r.listing, r.customer, r.mobile, r.when || fmtWhen(r.slot), r.status]));
    else exportCsv('draazy-enquiries.csv', ['ID', 'Listing', 'Customer', 'Mobile', 'Locality', 'Date', 'Status'], rows.map((r) => [r.id, r.listing, r.customer, r.mobile, r.locality, fmtWhen(r.at), r.status]));
  };

  const icons = (r) => (
    <>
      <IconAction label="View" icon={Eye} onClick={() => setDetail({ ...r, _kind: KIND[tab] })} />
      {stillMasked(r) ? <IconAction label="Reveal contact" icon={Unlock} onClick={() => reveal(r, KIND[tab])} disabled={revealing === r.id} /> : null}
    </>
  );

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
      <Chips label="Status" options={countChips(STATUS_OPTS[tab] || [], 'status')} value={statusF} onChange={setStatusF} />
      {tab === 'deals' ? <Chips label="Type" options={countChips(DEAL_TYPE_OPTS, 'deal')} value={typeF} onChange={setTypeF} /> : null}
      <Chips label="Date" options={DATE_CHIPS} value={dateRange} onChange={setDateRange} />
      {filtered ? <ClearFilters onClick={clear} /> : null}
      <div className="ml-auto"><PageNav {...page.paging} /></div>
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
              <Chips label="Deal type" options={DEAL_TYPE_OPTS.map(([value, label]) => ({ value, label }))} value={funnelDeal} onChange={setFunnelDeal} />
              <Chips label="Date" options={DATE_CHIPS} value={funnelTime} onChange={setFunnelTime} />
            </>
          )}
        >
          <div className="p-4">
            <FunnelView enquiries={enquiries} visits={visits} deals={deals} funnelTime={funnelTime} funnelDeal={funnelDeal} />
          </div>
        </QueuePanel>
      ) : (
        <QueuePanel active={tab} note={note} toolbar={toolbar} footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}>
          <RowList isEmpty={!rows.length} empty={filtered ? 'Nothing matches these filters.' : `No ${tab} yet.`}>
            {page.items.map((r) => (
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
                  type="button"
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
