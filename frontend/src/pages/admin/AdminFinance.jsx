/**
 * Finance console — on the live seam (ledger item 20, D235).
 *
 * ## What this screen used to be
 *
 * Every number on it was invented in the browser. The revenue curve came from
 * `120000 + ((seed * 7919) % 80000)` where `seed` was the year and month; the ledger's statuses came
 * from rotating a ten-element array and its amounts from four hardcoded fee constants; partner
 * payouts were 65% of the invented services figure and commission the other 35%; MRR was split
 * 55/45 between two plans and divided by a price to produce a subscriber count. "Rent-pay fees"
 * summed `db.rentFeeLedger`, a collection that never existed in `db.json`, so the only tile that was
 * genuinely measured had always read ₹0 for a reason nobody could have guessed from the screen.
 *
 * `GET /admin/finance` had existed and been admin-gated the whole time, with no caller.
 *
 * ## What it is now, and the four calls that shaped it
 *
 * Every figure comes from `services/financeService.js`. Nothing on this page computes money any
 * more except two divisions that are presentation (ARPU and ARPPU). Where the server cannot source
 * a figure, the figure is **zero and disclosed** rather than modelled — the `NotMeasured` marker
 * below is the mechanism, and it predates this port.
 *
 * 1. **Four bands, not three.** The chart keeps a services band and it renders a measured ₹0 under
 *    the "quoted, not received" marker, rather than being dropped. The marketplace visibly takes
 *    bookings, so a chart with no services in it reads as a rendering fault instead of as a
 *    statement about the business. Rent fees, previously a lone tile, are now the fourth band —
 *    they are revenue and belong in the total.
 * 2. **Both denominators.** ARPU (everyone) and ARPPU (everyone who paid this month) are separate
 *    tiles, because one figure under an unqualified label invites the reader to assume it is the
 *    other.
 * 3. **The payouts panel stays and stops inventing.** "Partner payouts (65%)" and "Platform
 *    commission (35%)" were a split of a number that was itself fabricated; there is no payout
 *    ledger, no partner agreement, and no remittance has ever been executed. The rows now read the
 *    server's `payoutsCompleted` and `refunds` — both structural zeros — and keep the markers that
 *    say so. The day a payout rail ships, the numbers move on their own.
 * 4. **The subscription book is listed, not derived.** Plan rows come from the server's `plans`,
 *    which sums to `mrr` by construction. Offline there are no subscription records, so the panel
 *    renders its empty state rather than a modelled one.
 *
 * `settings` is still read, for one thing only: the GST percentage in a row label. The disclosure
 * flags moved to the finance payload, where they sit beside the figures they qualify.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Download, IndianRupee, Eye, Receipt, RefreshCw, Sparkles, TrendingUp, Users, UserCheck, Wallet } from 'lucide-react';
import { getSettings } from '../../services/settingsService.js';
import { getFinanceOverview, getFinanceSeries, listFinanceTransactions } from '../../services/financeService.js';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Select from '../../components/ui/Select.jsx';
import { BarChart, LineChart, DoughnutChart, PALETTE } from '../../components/charts/index.jsx';

/** The widest window the console offers, and therefore what it fetches once and slices locally. */
const MAX_MONTHS = 24;

/** How many ledger rows one request asks for. The table pages 15 at a time client-side. */
const LEDGER_PAGE_SIZE = 100;

/** Wire `kind` to the words the console has always shown. The server sends the source, not a label. */
const KIND_LABELS = {
  rent_fee: 'Rent payment (fee)',
  subscription: 'Subscription',
  featured: 'Featured listing',
};

function pct(cur, prev) {
  // `!prev` already covers 0 and null; the finite checks stop an absent field rendering "+NaN%".
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || !prev) return null;
  const d = Math.round((cur - prev) / prev * 1000) / 10;
  return { val: (d >= 0 ? '+' : '') + d + '%', up: d >= 0 };
}

/** `2026-08-01` becomes `Aug 26`, the chart's axis label. */
function monthLabel(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

/* Structural zeros disclose themselves (tech debt D63/D65).
 *
 * Three of the money lines on this screen describe paths the platform does not have: no payout has
 * ever been executed, there is no refund path at all, and revenue excludes the services marketplace
 * because `service_orders.amount` is a quote rather than a receipt. Rendered plainly they are
 * indistinguishable from a quiet month, and an operator reading "₹0 refunded" concludes something
 * false about the business rather than something true about the software.
 *
 * So the marker is attached to the figure, not printed instead of it: the row keeps its number and
 * gains a reason. Which markers show now travels **with the finance payload** rather than in the
 * settings document — the server owns these flags (`punenest.finance.*`), and putting them beside
 * the figures they qualify means a figure and its disclosure can no longer arrive from two
 * different reads and disagree. Absent still means "not measured": the default has to be today's
 * truth, because a disclosure that defaults to "measured" is a lie told by a typo.
 */
function NotMeasured({ children }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-amber-300/90">
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

// Defined outside component to avoid recreation on every render
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
  const { t } = useTranslation();
  const { optionEnabled } = useAdminFlags();
  const [settings, setSettings] = useState(null);
  const [finance, setFinance] = useState(null);
  const [series, setSeries] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [range, setRange] = useState(12);
  const [txQ, setTxQ] = useState('');
  const [txType, setTxType] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [detail, setDetail] = useState(null);

  /* One effect, four reads, `alive` guarding every setter.
     The reads are issued together rather than chained: they are independent GETs and serialising
     them would put three round trips between the operator and the first number. */
  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      getSettings(),
      getFinanceOverview(),
      getFinanceSeries(MAX_MONTHS),
      listFinanceTransactions({ size: LEDGER_PAGE_SIZE }),
    ]).then(([s, f, sr, tx]) => {
      if (!alive) return;
      /* `allSettled`, not `all`: these four feed four independent panels, and one failing read must
         not blank the other three. A rejected read leaves its panel on the empty state it already
         has for "no rows", which is the honest rendering of "we could not tell you". */
      setSettings(s.status === 'fulfilled' ? s.value : {});
      setFinance(f.status === 'fulfilled' ? f.value : null);
      setSeries(sr.status === 'fulfilled' ? sr.value : []);
      setLedger(tx.status === 'fulfilled' ? tx.value.items : []);
    });
    return () => { alive = false; };
  }, []);

  const slicedSeries = useMemo(() => (series || []).slice(-range), [series, range]);

  const transactions = useMemo(() => ledger || [], [ledger]);

  const txRows = useMemo(() => {
    let rows = transactions;
    if (txType) rows = rows.filter((r) => r.kind === txType);
    if (txStatus) rows = rows.filter((r) => r.status === txStatus);
    if (txQ) {
      const n = txQ.toLowerCase();
      rows = rows.filter((r) => `${r.party} ${KIND_LABELS[r.kind] || r.kind}`.toLowerCase().includes(n));
    }
    return rows;
  }, [transactions, txType, txStatus, txQ]);

  const txTypes = useMemo(
    () => [...new Set(transactions.map((tx) => tx.kind))].sort(),
    [transactions],
  );

  if (!settings || !finance) return <Loading />;

  const month = slicedSeries[slicedSeries.length - 1]
    || { month: '', rent: 0, subscriptions: 0, featured: 0, services: 0 };
  const prev = slicedSeries[slicedSeries.length - 2] || month;
  const monthTotal = month.rent + month.subscriptions + month.featured + month.services;
  const prevTotal = prev.rent + prev.subscriptions + prev.featured + prev.services;
  const ytd = (series || []).slice(-12)
    .reduce((s, m) => s + m.rent + m.subscriptions + m.featured + m.services, 0);

  const fees = (settings.fees) || {};
  const {
    payoutsMeasured, refundsMeasured, serviceOrdersCounted,
    mrr, monthRevenue, users, payingUsers, gstCollected, pendingSettlement, plans,
  } = finance;

  /* The two denominators, and the only arithmetic left on this page. Both guard against a zero
     divisor rather than against a missing one: with no paying users, ARPPU is ₹0, not Infinity. */
  const arpu = users > 0 ? Math.round(monthRevenue / users) : 0;
  const arppu = payingUsers > 0 ? Math.round(monthRevenue / payingUsers) : 0;

  const disclosures = [
    !payoutsMeasured && { id: 'payouts', text: t('adminFinance.payoutsNotMeasured') },
    !refundsMeasured && { id: 'refunds', text: t('adminFinance.refundsNotMeasured') },
    !serviceOrdersCounted && { id: 'services', text: t('adminFinance.servicesNotCounted') },
  ].filter(Boolean);

  const KPIS = [
    { label: 'MRR (subscriptions)', value: fmtINR(mrr), delta: null, icon: RefreshCw },
    /* Value and delta from the same source. The value used to come from the overview's
       `monthRevenue` while the delta compared two series buckets, so a lag between the two reads
       could caption a healthy figure "−100% MoM". A delta must describe the number above it. */
    { label: 'Revenue this month', value: fmtINR(monthTotal), delta: pct(monthTotal, prevTotal), icon: IndianRupee },
    /* Figure-local wording: the aggregate rows say revenue *excludes* services, which would read as
       a denial of the number printed directly above it on this card. */
    { label: 'Services revenue', value: fmtINR(month.services), delta: null, icon: Receipt, note: serviceOrdersCounted ? null : t('adminFinance.servicesQuoted') },
    { label: 'Featured revenue', value: fmtINR(month.featured), delta: pct(month.featured, prev?.featured), icon: Sparkles },
    { label: 'Revenue (12 mo)', value: fmtINR(ytd), delta: null, icon: TrendingUp },
    { label: 'Rent-pay fees', value: fmtINR(month.rent), delta: pct(month.rent, prev?.rent), icon: Wallet },
    { label: 'ARPU', value: fmtINR(arpu), delta: null, icon: Users, note: t('adminFinance.arpuBasis', { count: users }) },
    { label: 'ARPPU', value: fmtINR(arppu), delta: null, icon: UserCheck, note: t('adminFinance.arppuBasis', { count: payingUsers }) },
  ];

  const doRevenueExport = () => exportCsv(
    'punenest-revenue.csv',
    ['Month', 'Rent fees', 'Subscriptions', 'Featured', 'Services', 'Total'],
    (series || []).map((m) => [m.month, m.rent, m.subscriptions, m.featured, m.services,
      m.rent + m.subscriptions + m.featured + m.services]),
  );

  return (
    <div>
      <PageHeader title="Finance" subtitle="Revenue, subscriptions, transactions and platform economics." actions={
        <button onClick={doRevenueExport} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" />Revenue CSV</button>
      } />

      {/* Deliberately not `pn-card`: that class sets the `background` and `border` shorthands and is
          declared after `@tailwind utilities` at equal specificity, so it would silently overwrite
          the amber and render this as an ordinary panel. Same recipe as the help-page callout. */}
      {disclosures.length > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4" data-testid="finance-disclosures">
          {/* h3 to match the other panels on this page — the banner is their sibling, not their
              parent, and the outline must not change shape when a flag is flipped. */}
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
          <div key={k.label} className="pn-card p-3">
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

      {/* Deal Pipeline cross-reference */}
      <div className="mb-5">
        <div className="pn-card p-4 flex items-center justify-between max-w-sm">
          <div>
            <div className="text-sm font-bold text-gray-200">Deal Pipeline</div>
            <div className="mt-0.5 text-xs text-gray-400">Track deal GMV in Enquiries</div>
          </div>
          <Link to="/admin/enquiries" className="inline-flex items-center gap-1 text-sm font-medium text-brand-teal hover:underline">
            View all deals <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Charts row */}
      {optionEnabled('finance.charts') && (
        <div className="mb-5 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="pn-card p-4">
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
                { label: 'Featured', data: slicedSeries.map((m) => m.featured), stack: 's', color: PALETTE[2] },
                { label: 'Rent fees', data: slicedSeries.map((m) => m.rent), stack: 's', color: PALETTE[3] },
              ]}
              height={280}
              options={{ scales: { x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { stacked: true, ticks: { color: '#94a3b8', callback: (v) => '₹' + Math.round(v / 1000) + 'k' }, grid: { color: 'rgba(255,255,255,.05)' } } } }}
            />
            {!serviceOrdersCounted && <NotMeasured>{t('adminFinance.servicesQuoted')}</NotMeasured>}
          </div>
          <div className="pn-card p-4">
            <h3 className="mb-3 font-bold">Revenue mix (this month)</h3>
            <DoughnutChart
              labels={['Subscriptions', 'Services', 'Featured', 'Rent fees']}
              values={[month.subscriptions, month.services, month.featured, month.rent]}
              colors={[PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[3]]}
              height={280}
            />
          </div>
        </div>
      )}

      {/* MRR line + panels */}
      {optionEnabled('finance.models') && (
        <div className="mb-5 grid gap-4 lg:grid-cols-[2fr_1fr_1fr]">
          <div className="pn-card p-4">
            <h3 className="mb-3 font-bold">MRR growth</h3>
            <LineChart
              labels={slicedSeries.map((m) => monthLabel(m.month))}
              datasets={[{ label: 'MRR', data: slicedSeries.map((m) => m.subscriptions), fill: true }]}
              options={{ scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { ticks: { color: '#94a3b8', callback: (v) => '₹' + Math.round(v / 1000) + 'k' }, grid: { color: 'rgba(255,255,255,.05)' } } } }}
            />
            {/* The chart plots subscription revenue *booked* per month; the tile plots the current
                run rate. They are different questions and will legitimately differ, so the panel
                says which one it is drawing rather than letting the reader assume. */}
            <p className="mt-2 text-xs text-gray-500">{t('adminFinance.mrrChartBasis')}</p>
          </div>
          <div className="pn-card p-4">
            <h3 className="mb-2 text-sm font-bold">Subscriptions</h3>
            <p className="mb-3 text-xs text-gray-500">Active paid plans</p>
            {(plans || []).length === 0 ? (
              /* An empty book is a fact, not a failure — and printing it beats printing a modelled
                 one. The old screen divided an invented MRR by a price to produce a subscriber
                 count, which is how a console reports customers it does not have. */
              <p className="py-2 text-sm text-gray-500">{t('adminFinance.noActivePlans')}</p>
            ) : (plans || []).map((p) => (
              <div key={p.name} className="flex items-center justify-between border-b border-white/5 py-2 text-sm">
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
            <div className="pn-card p-4">
              <h3 className="mb-1 text-sm font-bold">Net position</h3>
              <p className="mb-2 text-xs text-gray-500">This month</p>
              <FlowRow
                label="Gross revenue"
                amount={monthRevenue}
                note={serviceOrdersCounted ? null : t('adminFinance.servicesNotCounted')}
                noteLabel={t('adminFinance.notMeasured')}
              />
              {/* Rent only — it is the one source that stores tax as its own number. Saying so in
                  the label is cheaper than a disclosure and more precise than either. */}
              <FlowRow label={gstPercent === null ? 'GST collected on rent' : `GST collected on rent (${gstPercent}%)`} amount={gstCollected} pos />
              <FlowRow
                label="Partner payouts"
                amount={finance.payoutsCompleted}
                neg
                note={payoutsMeasured ? null : t('adminFinance.payoutsNotMeasured')}
                noteLabel={t('adminFinance.notMeasured')}
              />
              <FlowRow label="Net retained" amount={monthRevenue - finance.payoutsCompleted} total />
            </div>
            <div className="pn-card p-4">
              <h3 className="mb-1 text-sm font-bold">Payouts & outstanding</h3>
              {/* Rent the platform holds and owes landlords. A liability, and the one figure in this
                  panel that has always been real. */}
              <FlowRow label="Rent held for landlords" amount={finance.payoutsDue} />
              <FlowRow
                label="Partner payouts made"
                amount={finance.payoutsCompleted}
                neg
                note={payoutsMeasured ? null : t('adminFinance.payoutsNotMeasured')}
                noteLabel={t('adminFinance.notMeasured')}
              />
              <FlowRow label="Outstanding (unsettled fees)" amount={pendingSettlement} />
              <FlowRow
                label="Refunds"
                amount={finance.refunds}
                neg
                note={refundsMeasured ? null : t('adminFinance.refundsNotMeasured')}
                noteLabel={t('adminFinance.notMeasured')}
              />
            </div>
          </div>
        </div>
      )}

      {/* Transactions ledger */}
      {optionEnabled('finance.transactions') && <LedgerPanel />}
    </div>
  );
}

