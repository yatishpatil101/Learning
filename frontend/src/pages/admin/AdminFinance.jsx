import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, IndianRupee, Eye, Receipt, RefreshCw, TrendingUp, Users, UserCheck } from 'lucide-react';
import { getFinanceOverview, getFinanceSeries, listFinanceTransactions } from '../../services/financeService.js';
import { fmtINR, fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useTabParam } from '../../lib/useTabParam.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Select from '../../components/ui/Select.jsx';
import { BarChart, LineChart, DoughnutChart, PALETTE } from '../../components/charts/index.jsx';
import { cssColour, useIsLightTheme } from '../../lib/themeColour';
import {
  BTN, Chips, IconAction, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox, useClientPaging,
} from '../../components/admin/WorkQueue.jsx';

/** The widest window the console offers, and therefore what it fetches once and slices locally. */
const MAX_MONTHS = 24;

/** Search and the status filter are server-side; CSV export walks every page, not just the window. */
const LEDGER_PAGE_SIZE = 100;
const TX_PER_PAGE = 20;

/** Must match `AdminFinanceService.LEDGER_KINDS`: an unknown kind is a 400, not an empty page. */
const KIND_LABELS = {
  subscription: 'Subscription',
};

const TX_STATUSES = [
  { value: '', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
];

const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

async function fetchWholeLedger(filters) {
  const rows = [];
  for (let page = 0; ; page += 1) {
    const res = await listFinanceTransactions({ ...filters, page, size: LEDGER_PAGE_SIZE });
    rows.push(...res.items);
    if (res.items.length < LEDGER_PAGE_SIZE || rows.length >= res.total) return rows;
  }
}

function pct(cur, prev) {
  // `!prev` already covers 0 and null; the finite checks stop an absent field rendering "+NaN%".
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || !prev) return null;
  const d = Math.round((cur - prev) / prev * 1000) / 10;
  return { val: (d >= 0 ? '+' : '') + d + '%', up: d >= 0 };
}

function monthLabel(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

/** Structural zeroes need labels: refunds and service receipts are absent paths, not quiet months. */
function NotMeasured({ children }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-amber-300/90">
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function FlowRow({ label, amount, neg, pos, total, note, noteLabel }) {
  return (
    <div className={`border-b border-white/5 py-2 text-sm ${total ? 'font-bold border-white/15' : ''}`}>
      <div className="flex justify-between">
        <span className="text-gray-300">{label}</span>
        <span className={neg ? 'text-red-400' : pos ? 'text-emerald-300' : 'font-medium'}>
          {neg ? '−' : ''}{fmtINR(Math.abs(amount))}
          {note && noteLabel ? <span className="ml-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-amber-300/90">{noteLabel}</span> : null}
        </span>
      </div>
      {note ? <NotMeasured>{note}</NotMeasured> : null}
    </div>
  );
}

export default function AdminFinance() {
  /* Chart options below read cssColour at render, so a theme flip must re-render them. */
  useIsLightTheme();
  const { t } = useTranslation();
  const [finance, setFinance] = useState(null);
  const [series, setSeries] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [range, setRange] = useState(12);
  const [txQ, setTxQ] = useState('');
  const [txTerm, setTxTerm] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useTabParam(['overview', 'transactions'], 'overview');
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    /* `allSettled`, not `all`: the two reads feed independent panels, and one failing must not
       blank the other. */
    Promise.allSettled([getFinanceOverview(), getFinanceSeries(MAX_MONTHS)]).then(([f, sr]) => {
      if (!alive) return;
      setFinance(f.status === 'fulfilled' ? f.value : null);
      setOverviewFailed(f.status !== 'fulfilled');
      setSeries(sr.status === 'fulfilled' ? sr.value : []);
    });
    return () => { alive = false; };
  }, [attempt]);

  const retryOverview = () => { setOverviewFailed(false); setAttempt((n) => n + 1); };

  useEffect(() => {
    const id = setTimeout(() => setTxTerm(txQ.trim()), 300);
    return () => clearTimeout(id);
  }, [txQ]);

  const txFilters = useMemo(
    () => ({ status: txStatus, q: txTerm }),
    [txStatus, txTerm],
  );

  useEffect(() => {
    let alive = true;
    listFinanceTransactions({ ...txFilters, size: LEDGER_PAGE_SIZE })
      .then((res) => { if (alive) setLedger({ items: res.items, total: res.total }); })
      .catch(() => { if (alive) setLedger({ items: [], total: 0, failed: true }); });
    return () => { alive = false; };
  }, [txFilters, attempt]);

  const slicedSeries = useMemo(() => (series || []).slice(-range), [series, range]);

  const txRows = ledger?.items || [];
  const txTotal = ledger?.total || 0;
  const { items: pageTx, paging } = useClientPaging(txRows, TX_PER_PAGE, `${txStatus}|${txTerm}`);

  if (overviewFailed) {
    return (
      <div>
        <PageHeader title="Finance" subtitle="Revenue, subscriptions, transactions and platform economics." />
        <div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
          Could not load the finance overview.{' '}
          <button type="button" onClick={retryOverview} className="underline underline-offset-2">Retry</button>
        </div>
      </div>
    );
  }
  if (!finance) return <Loading />;

  const month = slicedSeries[slicedSeries.length - 1]
    || { month: '', subscriptions: 0, services: 0 };
  const prev = slicedSeries[slicedSeries.length - 2] || month;
  const monthTotal = month.subscriptions + month.services;
  const prevTotal = prev.subscriptions + prev.services;
  const ytd = (series || []).slice(-12)
    .reduce((s, m) => s + m.subscriptions + m.services, 0);

  const {
    refundsMeasured, serviceOrdersCounted,
    mrr, monthRevenue, users, payingUsers, plans,
  } = finance;

  /* The two denominators, and the only arithmetic left on this page. Both guard against a zero
     divisor rather than against a missing one: with no paying users, ARPPU is ₹0, not Infinity. */
  const arpu = users > 0 ? Math.round(monthRevenue / users) : 0;
  const arppu = payingUsers > 0 ? Math.round(monthRevenue / payingUsers) : 0;

  const disclosures = [
    !refundsMeasured && { id: 'refunds', text: t('adminFinance.refundsNotMeasured') },
    !serviceOrdersCounted && { id: 'services', text: t('adminFinance.servicesNotCounted') },
  ].filter(Boolean);

  const KPIS = [
    { label: 'MRR (subscriptions)', value: fmtINR(mrr), delta: null, icon: RefreshCw },
    /* Value and delta must share the same source, or a lag between reads captions this figure wrong. */
    { label: 'Revenue this month', value: fmtINR(monthTotal), delta: pct(monthTotal, prevTotal), icon: IndianRupee },
    /* Figure-local wording: the aggregate rows say revenue *excludes* services, which would read as
       a denial of the number printed directly above it on this card. */
    { label: 'Services revenue', value: fmtINR(month.services), delta: null, icon: Receipt, note: serviceOrdersCounted ? null : t('adminFinance.servicesQuoted') },
    { label: 'Revenue (12 mo)', value: fmtINR(ytd), delta: null, icon: TrendingUp },
    { label: 'ARPU', value: fmtINR(arpu), delta: null, icon: Users, note: t('adminFinance.arpuBasis', { count: users }) },
    { label: 'ARPPU', value: fmtINR(arppu), delta: null, icon: UserCheck, note: t('adminFinance.arppuBasis', { count: payingUsers }) },
  ];

  const doRevenueExport = () => exportCsv(
    'draazy-revenue.csv',
    ['Month', 'Subscriptions', 'Services', 'Total'],
    (series || []).map((m) => [m.month, m.subscriptions, m.services, m.subscriptions + m.services]),
  );

  /* Every matching row, not the page on screen: past the hundredth transaction the table is a
     window and the export is the ledger. */
  const doTxExport = async () => {
    const rows = await fetchWholeLedger(txFilters);
    exportCsv(
      'draazy-transactions.csv',
      ['ID', 'Date', 'Party', 'Type', 'Platform take', 'Status'],
      rows.map((r) => [r.id, r.date, r.party, KIND_LABELS[r.kind] || r.kind, r.amount, r.status]),
    );
  };

  /* "Platform take" names the platform's cut, not necessarily the gross amount that changed hands. */
  const txRow = (r) => (
    <RowCard
      key={r.id}
      id={r.id}
      title={r.party}
      badges={<Badge status={r.status} />}
      meta={<><span className="font-mono">{r.id}</span><Dot /><span>{r.date}</span><Dot /><span>{KIND_LABELS[r.kind] || r.kind}</span></>}
      figure={(
        <div className="text-right max-md:text-left">
          <div className={classNames('text-lg font-bold tabular-nums', r.amount < 0 && 'text-red-400')}>{fmtINR(r.amount)}</div>
          <div className="text-[11px] text-gray-500">Platform take</div>
        </div>
      )}
      icons={<IconAction label={`Open transaction ${r.id}`} icon={Eye} onClick={() => setDetail(r)} />}
    />
  );
  const ledgerTruncated = txTotal > txRows.length;

  return (
    <div>
      <PageHeader title="Finance" subtitle="Revenue, subscriptions, transactions and platform economics." actions={
        <button onClick={doRevenueExport} className="dz-btn dz-btn-ghost"><Download className="h-4 w-4" />Revenue CSV</button>
      } />

      <QueueTabs
        tabs={[{ key: 'overview', label: 'Overview', count: null }, { key: 'transactions', label: 'Transactions', count: ledger ? txTotal : null }]}
        active={tab}
        onChange={setTab}
        label="Finance views"
        idPrefix="finance"
      />

      {tab === 'overview' ? (<div id="finance-panel" role="tabpanel" aria-labelledby="finance-tab-overview">
      {disclosures.length > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4" data-testid="finance-disclosures">
          {/* h3 to match the other panels on this page — the banner is           their sibling, not their parent. */}
          <h3 className="flex items-center gap-2 text-sm font-bold text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('adminFinance.disclosureTitle')}
          </h3>
          <p className="mt-1 text-xs text-gray-400">{t('adminFinance.disclosureLead')}</p>
          <ul className="mt-2 space-y-1.5">
            {disclosures.map((d) => (
              <li key={d.id} className="flex items-start gap-1.5 text-xs leading-snug text-amber-100/85">
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300/70" />
                <span>{d.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k.label} className="dz-card p-3">
            <div className="flex items-start justify-between gap-1">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><k.icon className="h-3.5 w-3.5" /></span>
            </div>
            <div className="mt-2 text-xl font-extrabold">{k.value}</div>
            <div className="mt-0.5 text-xs text-gray-400">{k.label}</div>
            {k.delta ? <div className={`mt-1 text-xs font-medium ${k.delta.up ? 'text-emerald-300' : 'text-red-400'}`}>{k.delta.val} MoM</div> : <div className="mt-1 h-4" />}
            {k.note ? <NotMeasured>{k.note}</NotMeasured> : null}
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="dz-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold">Revenue by month</h3>
            <Select
              size="sm"
              value={String(range)}
              onChange={(v) => setRange(+v)}
              ariaLabel="Revenue window"
              options={[
                { value: '6', label: '6 months' },
                { value: '12', label: '12 months' },
                { value: '24', label: '24 months' },
              ]}
            />
          </div>
          <BarChart
            labels={slicedSeries.map((m) => monthLabel(m.month))}
            datasets={[
              { label: 'Subscriptions', data: slicedSeries.map((m) => m.subscriptions), stack: 's', color: PALETTE[0] },
              { label: 'Services', data: slicedSeries.map((m) => m.services), stack: 's', color: PALETTE[1] },
            ]}
            height={280}
            options={{ scales: { x: { stacked: true, ticks: { color: cssColour('slate-400') }, grid: { color: cssColour('white', 0.05) } }, y: { stacked: true, ticks: { color: cssColour('slate-400'), callback: (v) => '₹' + Math.round(v / 1000) + 'k' }, grid: { color: cssColour('white', 0.05) } } } }}
          />
          {!serviceOrdersCounted && <NotMeasured>{t('adminFinance.servicesQuoted')}</NotMeasured>}
        </div>
        <div className="dz-card p-4">
          <h3 className="mb-3 font-bold">Revenue mix (this month)</h3>
          <DoughnutChart
            labels={['Subscriptions', 'Services']}
            values={[month.subscriptions, month.services]}
            colors={[PALETTE[0], PALETTE[1]]}
            height={280}
          />
        </div>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="dz-card p-4">
          <h3 className="mb-3 font-bold">MRR growth</h3>
          <LineChart
            labels={slicedSeries.map((m) => monthLabel(m.month))}
            datasets={[{ label: 'MRR', data: slicedSeries.map((m) => m.subscriptions), fill: true }]}
            options={{ scales: { x: { ticks: { color: cssColour('slate-400') }, grid: { color: cssColour('white', 0.05) } }, y: { ticks: { color: cssColour('slate-400'), callback: (v) => '₹' + Math.round(v / 1000) + 'k' }, grid: { color: cssColour('white', 0.05) } } } }}
          />
          <p className="mt-2 text-xs text-gray-500">{t('adminFinance.mrrChartBasis')}</p>
        </div>
        <div className="dz-card p-4">
          <h3 className="mb-2 text-sm font-bold">Subscriptions</h3>
          <p className="mb-3 text-xs text-gray-500">Active paid plans</p>
          {(plans || []).length === 0 ? (
            <p className="py-2 text-sm text-gray-500">{t('adminFinance.noActivePlans')}</p>
          ) : (plans || []).map((p) => (
            /* Keyed on price too: a repriced plan returns one line per price cohort, so the name is not unique. */
            <div key={`${p.name}:${p.price}`} className="flex items-center justify-between border-b border-white/5 py-2 text-sm">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-500">{fmtNum(p.active)} active · {fmtINR(p.price)}/{p.billingCycle === 'yearly' ? 'yr' : p.billingCycle === 'quarterly' ? 'qtr' : 'mo'}</div>
              </div>
              <div className="font-semibold">{fmtINR(p.monthlyValue)}</div>
            </div>
          ))}
          <div className="flex justify-between border-t border-white/15 pt-2 text-sm font-bold">
            <span className="text-gray-400">MRR total</span><span>{fmtINR(mrr)}</span>
          </div>
        </div>
        <div className="space-y-4">
          <div className="dz-card p-4">
            <h3 className="mb-1 text-sm font-bold">Net position</h3>
            <p className="mb-2 text-xs text-gray-500">This month</p>
            <FlowRow
              label="Gross revenue"
              amount={monthRevenue}
              note={serviceOrdersCounted ? null : t('adminFinance.servicesNotCounted')}
              noteLabel={t('adminFinance.notMeasured')}
            />
            {/* Rent-payment rail rows are absent rather than zeroed; zero would imply a quiet month. */}
            <FlowRow
              label="Refunds"
              amount={finance.refunds}
              neg
              note={refundsMeasured ? null : t('adminFinance.refundsNotMeasured')}
              noteLabel={t('adminFinance.notMeasured')}
            />
            <FlowRow label="Net retained" amount={monthRevenue - finance.refunds} total />
          </div>
        </div>
      </div>
      </div>) : (
        <QueuePanel
          idPrefix="finance"
          active={tab}
          note={ledgerTruncated
            ? `Showing the newest ${fmtNum(txRows.length)} of ${fmtNum(txTotal)} matching transactions. The CSV has all of them.`
            : 'Platform take per payment, newest first. The CSV has every matching row.'}
          noteTestId={ledgerTruncated ? 'ledger-window' : undefined}
          toolbar={(
            <>
              <SearchBox value={txQ} onChange={setTxQ} placeholder="Search party…" label="Search party" />
              {/* The ledger only ever derives `paid` and `pending`; the server answers 400 for `refunded`. */}
              <Chips label="Status" options={TX_STATUSES} value={txStatus} onChange={setTxStatus} />
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={doTxExport} className={BTN.ghost}><Download className="h-3.5 w-3.5" />Export CSV</button>
                <PageNav {...paging} />
              </div>
            </>
          )}
        >
          <RowList isEmpty={!txRows.length} empty={ledger?.failed ? <span role="alert">Could not load transactions. <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline underline-offset-2">Retry</button></span> : 'No transactions match.'}>
            {pageTx.map(txRow)}
          </RowList>
        </QueuePanel>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Transaction · ${detail.id}` : ''} size="md">
        {detail ? (
          <dl className="space-y-2 text-sm">
            {[['ID', detail.id], ['Date', detail.date], ['Party', detail.party], ['Type', KIND_LABELS[detail.kind] || detail.kind], ['Platform take', fmtINR(detail.amount)], ['Status', detail.status]].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-white/5 py-1.5">
                <dt className="text-gray-400">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
