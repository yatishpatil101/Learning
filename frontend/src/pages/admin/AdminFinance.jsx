import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Download, IndianRupee, Eye, Receipt, RefreshCw, Sparkles, TrendingUp, Users, Wallet } from 'lucide-react';
import { getSettings, rawDb } from '../../lib/mockApi.js';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { buildTransactions, buildRevenueSeries, rentFeeRevenue } from '../../lib/data/finance-admin.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Select from '../../components/ui/Select.jsx';
import { BarChart, LineChart, DoughnutChart, PALETTE } from '../../components/charts/index.jsx';

function pct(cur, prev) {
  if (!prev) return null;
  const d = Math.round((cur - prev) / prev * 1000) / 10;
  return { val: (d >= 0 ? '+' : '') + d + '%', up: d >= 0 };
}

// Defined outside component to avoid recreation on every render
function FlowRow({ label, amount, neg, pos, total }) {
  return (
    <div className={`flex justify-between border-b border-white/5 py-2 text-sm ${total ? 'font-bold border-white/15' : ''}`}>
      <span className="text-gray-300">{label}</span>
      <span className={neg ? 'text-red-400' : pos ? 'text-emerald-300' : 'font-medium'}>{neg ? '−' : ''}{fmtINR(Math.abs(amount))}</span>
    </div>
  );
}

export default function AdminFinance() {
  const { optionEnabled } = useAdminFlags();
  const [settings, setSettings] = useState(null);
  const [range, setRange] = useState(12);
  const [txQ, setTxQ] = useState('');
  const [txType, setTxType] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let alive = true;
    getSettings().then((s) => alive && setSettings(s));
    return () => { alive = false; };
  }, []);

  const series = useMemo(() => buildRevenueSeries(24), []);
  const transactions = useMemo(() => buildTransactions(), []);
  const db = useMemo(() => rawDb(), []);

  const month = series[series.length - 1];
  const prev = series[series.length - 2] || month;
  const monthTotal = month.subscriptions + month.services + month.featured;
  const prevTotal = prev.subscriptions + prev.services + prev.featured;
  const ytd = series.slice(-12).reduce((s, m) => s + m.subscriptions + m.services + m.featured, 0);
  const fees = (settings?.fees) || {};
  const gstRate = (fees.gstPercent || 18) / 100;
  const rentFee = rentFeeRevenue(db);
  const users = (db.users || []).length;
  const arpu = Math.round(monthTotal / Math.max(1, users));
  const ownerPlan = fees.ownerPlanMonthly || Math.round(fees.ownerPlanYearly / 12 || 500);
  const seekerPlan = fees.seekerPlanMonthly || 299;
  const ownerShare = Math.round(month.subscriptions * 0.55);
  const ownerSubs = Math.max(0, Math.round(ownerShare / Math.max(1, ownerPlan)));
  const seekerSubs = Math.max(0, Math.round((month.subscriptions - ownerShare) / Math.max(1, seekerPlan)));
  const partnerPayout = Math.round(month.services * 0.65);
  const commission = month.services - partnerPayout;
  const netRetained = monthTotal - partnerPayout;
  const gstAmount = Math.round(monthTotal * gstRate);
  const { refunds, pending } = useMemo(() => {
    let r = 0, p = 0;
    for (const t of transactions) {
      if (t.status === 'refunded') r += Math.abs(t.amount);
      else if (t.status === 'pending') p += Math.abs(t.amount);
    }
    return { refunds: r, pending: p };
  }, [transactions]);

  const slicedSeries = useMemo(() => series.slice(-range), [series, range]);

  const txRows = useMemo(() => {
    let rows = transactions;
    if (txType) rows = rows.filter((r) => r.type === txType);
    if (txStatus) rows = rows.filter((r) => r.status === txStatus);
    if (txQ) { const n = txQ.toLowerCase(); rows = rows.filter((r) => (r.id + r.party + r.type).toLowerCase().includes(n)); }
    return rows;
  }, [transactions, txType, txStatus, txQ]);

  const txTypes = useMemo(() => [...new Set(transactions.map((t) => t.type))].sort(), [transactions]);

  if (!settings) return <Loading />;

  const KPIS = [
    { label: 'MRR (subscriptions)', value: fmtINR(month.subscriptions), delta: pct(month.subscriptions, prev.subscriptions), icon: RefreshCw },
    { label: 'Revenue this month', value: fmtINR(monthTotal), delta: pct(monthTotal, prevTotal), icon: IndianRupee },
    { label: 'Services revenue', value: fmtINR(month.services), delta: pct(month.services, prev.services), icon: Receipt },
    { label: 'Featured revenue', value: fmtINR(month.featured), delta: pct(month.featured, prev.featured), icon: Sparkles },
    { label: 'Revenue (12 mo)', value: fmtINR(ytd), delta: null, icon: TrendingUp },
    { label: 'Rent-pay fees', value: fmtINR(rentFee), delta: null, icon: Wallet },
    { label: 'ARPU', value: fmtINR(arpu), delta: null, icon: Users },
  ];

  const doRevenueExport = () => exportCsv('punenest-revenue.csv', ['Month', 'Subscriptions', 'Services', 'Featured', 'Total'], series.map((m) => [m.month, m.subscriptions, m.services, m.featured, m.subscriptions + m.services + m.featured]));
  const doTxExport = () => exportCsv('punenest-transactions.csv', ['ID', 'Date', 'Party', 'Type', 'Amount', 'Status', 'Method'], txRows.map((r) => [r.id, r.date, r.party, r.type, r.amount, r.status, r.method || '']));

  const txCols = [
    { key: 'id', header: 'ID', render: (r) => <span className="font-mono text-xs text-gray-400">{r.id}</span> },
    { key: 'date', header: 'Date', render: (r) => <span className="text-xs text-gray-400">{r.date}</span> },
    { key: 'party', header: 'Party', render: (r) => <span>{r.party}</span> },
    { key: 'type', header: 'Type', render: (r) => <span className="text-xs">{r.type}</span> },
    { key: 'amount', header: 'Amount', className: 'font-semibold', render: (r) => <span className={r.amount < 0 ? 'text-red-400' : ''}>{fmtINR(r.amount)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', render: (r) => <button onClick={() => setDetail(r)} className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Eye className="h-3.5 w-3.5" /></button> },
  ];

  const txCard = (r) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.party}</div>
          <div className="mt-0.5 font-mono text-xs text-gray-500">{r.id} · {r.date}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`font-semibold ${r.amount < 0 ? 'text-red-400' : ''}`}>{fmtINR(r.amount)}</div>
          <div className="mt-1"><Badge status={r.status} /></div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
        <span className="text-xs text-gray-400">{r.type}{r.method ? ` · ${r.method}` : ''}</span>
        <button onClick={() => setDetail(r)} className="pn-btn pn-btn-ghost pn-btn-sm"><Eye className="h-3.5 w-3.5" />View</button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Finance" subtitle="Revenue, subscriptions, transactions and platform economics." actions={
        <button onClick={doRevenueExport} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" />Revenue CSV</button>
      } />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {KPIS.map((k) => (
          <div key={k.label} className="pn-card p-3">
            <div className="flex items-start justify-between gap-1">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><k.icon className="h-3.5 w-3.5" /></span>
            </div>
            <div className="mt-2 text-xl font-extrabold">{k.value}</div>
            <div className="mt-0.5 text-xs text-gray-400">{k.label}</div>
            {k.delta ? <div className={`mt-1 text-xs font-medium ${k.delta.up ? 'text-emerald-300' : 'text-red-400'}`}>{k.delta.val} MoM</div> : <div className="mt-1 h-4" />}
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
              labels={slicedSeries.map((m) => m.month)}
              datasets={[
                { label: 'Subscriptions', data: slicedSeries.map((m) => m.subscriptions), stack: 's', color: PALETTE[0] },
                { label: 'Services', data: slicedSeries.map((m) => m.services), stack: 's', color: PALETTE[1] },
                { label: 'Featured', data: slicedSeries.map((m) => m.featured), stack: 's', color: PALETTE[2] },
              ]}
              height={280}
              options={{ scales: { x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { stacked: true, ticks: { color: '#94a3b8', callback: (v) => '₹' + Math.round(v / 1000) + 'k' }, grid: { color: 'rgba(255,255,255,.05)' } } } }}
            />
          </div>
          <div className="pn-card p-4">
            <h3 className="mb-3 font-bold">Revenue mix (this month)</h3>
            <DoughnutChart
              labels={['Subscriptions', 'Services', 'Featured']}
              values={[month.subscriptions, month.services, month.featured]}
              colors={[PALETTE[0], PALETTE[1], PALETTE[2]]}
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
              labels={slicedSeries.map((m) => m.month)}
              datasets={[{ label: 'MRR', data: slicedSeries.map((m) => m.subscriptions), fill: true }]}
              options={{ scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { ticks: { color: '#94a3b8', callback: (v) => '₹' + Math.round(v / 1000) + 'k' }, grid: { color: 'rgba(255,255,255,.05)' } } } }}
            />
          </div>
          <div className="pn-card p-4">
            <h3 className="mb-2 text-sm font-bold">Subscriptions</h3>
            <p className="mb-3 text-xs text-gray-500">Active paid plans (this month)</p>
            {[['Owner plan', ownerSubs, ownerPlan], ['Seeker plan', seekerSubs, seekerPlan]].map(([name, count, price]) => (
              <div key={name} className="flex items-center justify-between border-b border-white/5 py-2 text-sm">
                <div><div className="font-medium">{name}</div><div className="text-xs text-gray-500">{fmtNum(count)} active · {fmtINR(price)}/mo</div></div>
                <div className="font-semibold">{fmtINR(count * price)}</div>
              </div>
            ))}
            <div className="flex justify-between border-t border-white/15 pt-2 text-sm font-bold">
              <span className="text-gray-400">MRR total</span><span>{fmtINR(month.subscriptions)}</span>
            </div>
          </div>
          <div className="space-y-4">
            <div className="pn-card p-4">
              <h3 className="mb-1 text-sm font-bold">Net position</h3>
              <p className="mb-2 text-xs text-gray-500">This month, after tax & payouts</p>
              <FlowRow label="Gross revenue" amount={monthTotal} />
              <FlowRow label={`GST collected (${fees.gstPercent || 18}%)`} amount={gstAmount} pos />
              <FlowRow label="Partner payouts" amount={partnerPayout} neg />
              <FlowRow label="Net retained" amount={netRetained} total />
            </div>
            <div className="pn-card p-4">
              <h3 className="mb-1 text-sm font-bold">Payouts & outstanding</h3>
              <FlowRow label="Partner payouts (65%)" amount={partnerPayout} neg />
              <FlowRow label="Platform commission (35%)" amount={commission} pos />
              <FlowRow label="Outstanding (pending)" amount={pending} />
              <FlowRow label="Refunds (recent)" amount={refunds} neg />
            </div>
          </div>
        </div>
      )}

      {/* Transactions table */}
      {optionEnabled('finance.transactions') && (
        <div className="pn-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-bold">Recent transactions</h3>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input value={txQ} onChange={(e) => setTxQ(e.target.value)} placeholder="Search party or type…" className="pn-input py-1 text-xs sm:w-48" />
              <Select
                size="sm"
                value={txType}
                onChange={setTxType}
                ariaLabel="Filter by type"
                className="[--dd-sm-w:200px]"
                options={[{ value: '', label: 'All types' }, ...txTypes.map((t) => ({ value: t, label: t }))]}
              />
              <Select
                size="sm"
                value={txStatus}
                onChange={setTxStatus}
                ariaLabel="Filter by status"
                className="[--dd-sm-w:128px]"
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'closed', label: 'Closed' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'refunded', label: 'Refunded' },
                  { value: 'failed', label: 'Failed' },
                ]}
              />
              <button onClick={doTxExport} className="pn-btn pn-btn-ghost py-1 text-xs"><Download className="h-3.5 w-3.5" />CSV</button>
            </div>
          </div>
          <Table columns={txCols} rows={txRows} pageSize={15} label="transactions" empty="No transactions match." mobileCard={txCard} />
        </div>
      )}

      {/* Transaction detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Transaction · ${detail.id}` : ''} size="md">
        {detail ? (
          <dl className="space-y-2 text-sm">
            {[['ID', detail.id], ['Date', detail.date], ['Party', detail.party], ['Type', detail.type], ['Amount', fmtINR(detail.amount)], ['Status', detail.status], ['Method', detail.method || '—']].map(([k, v]) => (
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
