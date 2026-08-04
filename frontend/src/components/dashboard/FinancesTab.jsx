import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import Tabs from '../ui/Tabs.jsx';
import { fmtINR } from '../../lib/format.js';
import { PALETTE } from '../charts/index.jsx';
import TenantFinancesTab from './TenantFinancesTab.jsx';
import {
  INCOME_CATS, EXPENSE_CATS, CAT_KEYS, getBasis, setBasis, getTransactions, addTransaction, deleteTransaction,
  financeSummary, expenseBreakdown, cashflowByMonth, getDues,
  exportTransactionsCSV, exportStatementPDF,
} from '../../lib/data/finances.js';
import FinancesHeader from './finances/FinancesHeader.jsx';
import KpiStrip from './finances/KpiStrip.jsx';
import DuesSection from './finances/DuesSection.jsx';
import ActivityPanel from './finances/ActivityPanel.jsx';
import InsightsPanel from './finances/InsightsPanel.jsx';
import ReportsPanel from './finances/ReportsPanel.jsx';
import AddTransactionModal from './finances/AddTransactionModal.jsx';
import BasisModal from './finances/BasisModal.jsx';

export default function FinancesTab({ user, listings, toast, isOwner = true, showRental = false }) {
  const { t } = useTranslation();
  /* Finances is role-aware (mirrors Documents): owners get the property P&L,
     tenants get the Rent Wallet, and a user who is both can switch between them. */
  const canOwner = isOwner;
  const canTenant = showRental;
  // `ctx` is only the user's explicit choice in the both-available case. When just
  // one context exists we early-return it below, so no effect is needed to "fix" ctx.
  const [ctx, setCtx] = useState(canOwner ? 'owner' : 'tenant');

  if (!canOwner && canTenant) return <TenantFinancesTab user={user} toast={toast} />;
  if (canOwner && !canTenant) return <OwnerFinances user={user} listings={listings} toast={toast} />;

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl bg-white/5 border border-white/10 p-1">
        <button onClick={() => setCtx('owner')} className={'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition ' + (ctx === 'owner' ? 'bg-brand-teal/15 text-brand-teal' : 'text-gray-400 hover:text-white')}>
          <Icon name="home" className="w-4 h-4" /> {t('fin.myProperties')}
        </button>
        <button onClick={() => setCtx('tenant')} className={'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition ' + (ctx === 'tenant' ? 'bg-brand-teal/15 text-brand-teal' : 'text-gray-400 hover:text-white')}>
          <Icon name="wallet" className="w-4 h-4" /> {t('fin.rentWallet')}
        </button>
      </div>
      {ctx === 'tenant' ? <TenantFinancesTab user={user} toast={toast} /> : <OwnerFinances user={user} listings={listings} toast={toast} />}
    </div>
  );
}

function OwnerFinances({ user, listings, toast }) {
  const { t } = useTranslation();
  const [finProp, setFinProp] = useState((listings || [])[0]?.id || '');
  const [finPeriod, setFinPeriod] = useState('all');
  const [finType, setFinType] = useState('all');
  const [txForm, setTxForm] = useState({ type: 'income', category: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '', recurring: false });
  const [showTxForm, setShowTxForm] = useState(false);
  const [showAllTx, setShowAllTx] = useState(false);
  const [showBasisModal, setShowBasisModal] = useState(false);
  const [tick, setTick] = useState(0);

  const mob = user?.mobile || '';
  const basis = useMemo(() => finProp ? getBasis(mob, finProp) : null, [mob, finProp, tick]);
  const txs = useMemo(() => finProp ? (getTransactions(mob, finProp) || []) : [], [mob, finProp, tick]);
  const duesRaw = useMemo(() => finProp ? (getDues(mob, finProp) || []) : [], [mob, finProp, tick]);
  const dues = useMemo(() => ({ overdue: duesRaw.filter((d) => d.daysUntil < 0), upcoming: duesRaw.filter((d) => d.daysUntil >= 0) }), [duesRaw]);
  const summary = useMemo(() => finProp ? (financeSummary(mob, finProp, finPeriod) || { income: 0, expense: 0, net: 0 }) : { income: 0, expense: 0, net: 0 }, [mob, finProp, finPeriod, tick]);
  const expBreak = useMemo(() => { const raw = finProp ? (expenseBreakdown(mob, finProp, finPeriod) || {}) : {}; return Object.entries(raw).map(([category, amount]) => ({ category, amount })); }, [mob, finProp, finPeriod, tick]);
  const cf = useMemo(() => finProp ? (cashflowByMonth(mob, finProp) || { labels: [], incomeData: [], expenseData: [] }) : { labels: [], incomeData: [], expenseData: [] }, [mob, finProp, tick]);

  // Month-over-month KPI deltas, derived from the already-computed cashflow series
  // (no extra data pass). Only surfaced where "up = good" holds — Collected and Net —
  // so the Stat up/down colours (emerald/rose) stay truthful.
  const kpiTrend = useMemo(() => {
    const inc = cf.incomeData || [];
    const exp = cf.expenseData || [];
    const n = inc.length;
    if (n < 2) return { income: null, net: null };
    const net = (i) => (inc[i] || 0) - (exp[i] || 0);
    const trend = (cur, prev) => {
      const diff = (cur || 0) - (prev || 0);
      if (!diff) return null;
      const pct = prev > 0 ? Math.round((Math.abs(diff) / prev) * 100) : null;
      return { dir: diff > 0 ? 'up' : 'down', text: pct != null ? t('fin.trendPct', { pct }) : t('fin.trendPlain') };
    };
    return { income: trend(inc[n - 1], inc[n - 2]), net: trend(net(n - 1), net(n - 2)) };
  }, [cf, t]);

  const netSeries = useMemo(
    () => (cf.incomeData || []).map((v, i) => (v || 0) - ((cf.expenseData || [])[i] || 0)),
    [cf],
  );

  // Single at-a-glance health signal, shown in the header on every tab so the user
  // never loses sight of money-at-risk. Priority: overdue > due-soon/negative > healthy.
  const health = useMemo(() => {
    if (dues.overdue.length > 0) return { label: t('fin.healthOverdue', { count: dues.overdue.length }), cls: 'bg-rose-500/15 text-rose-300', dot: 'bg-rose-400' };
    if (dues.upcoming.length > 0) return { label: t('fin.healthDueSoon', { count: dues.upcoming.length }), cls: 'bg-amber-500/15 text-amber-300', dot: 'bg-amber-400' };
    if (summary.net < 0) return { label: t('fin.healthNegative'), cls: 'bg-amber-500/15 text-amber-300', dot: 'bg-amber-400' };
    return { label: t('fin.healthHealthy'), cls: 'bg-emerald-500/15 text-emerald-300', dot: 'bg-emerald-400' };
  }, [dues, summary.net, t]);

  const remindDue = (d) => toast(t('fin.remindSent', { category: t(CAT_KEYS[d.category] || d.category, { defaultValue: d.category }), amount: fmtINR(d.amount) }), 'success');
  const openBasisModal = () => setShowBasisModal(true);

  // Listings load asynchronously, so on a direct visit to #finances the initial
  // finProp can be empty (nothing selected → every KPI/chart/basis reads blank and
  // saves land in an orphan bucket). Auto-select the first property once listings
  // arrive, and recover if the current selection drops out of the list.
  useEffect(() => {
    const opts = listings || [];
    if (opts.length === 0) return;
    if (!finProp || !opts.some((l) => l.id === finProp)) setFinProp(opts[0].id);
  }, [listings, finProp]);

  const periodOpts = [
    { value: 'all', label: t('fin.periodAll') },
    { value: 'month', label: t('fin.periodMonth') },
    { value: 'quarter', label: t('fin.periodQuarter') },
    { value: 'year', label: t('fin.periodYear') },
  ];
  const typeOpts = [
    { value: 'all', label: t('fin.typeAll') },
    { value: 'income', label: t('fin.typeIncome') },
    { value: 'expense', label: t('fin.typeExpense') },
  ];
  // The stored value stays the English category id; only the visible label is translated.
  const catOpts = txForm.type === 'income'
    ? (INCOME_CATS || []).map((c) => ({ value: c, label: t(CAT_KEYS[c] || c, { defaultValue: c }) }))
    : (EXPENSE_CATS || []).map((c) => ({ value: c, label: t(CAT_KEYS[c] || c, { defaultValue: c }) }));

  const filteredTxs = useMemo(() => {
    let list = [...txs];
    if (finType !== 'all') list = list.filter((t) => t.type === finType);
    if (finPeriod !== 'all') {
      const now = new Date();
      let start;
      if (finPeriod === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
      else if (finPeriod === 'quarter') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      else start = new Date(now.getFullYear(), 0, 1);
      list = list.filter((t) => new Date(t.date) >= start);
    }
    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [txs, finType, finPeriod]);

  const submitTx = () => {
    if (!txForm.category || !txForm.amount || isNaN(parseFloat(txForm.amount))) {
      toast(t('fin.fillCatAmount'), 'error');
      return;
    }
    addTransaction(mob, finProp, {
      type: txForm.type,
      category: txForm.category,
      amount: parseFloat(txForm.amount),
      date: txForm.date,
      note: txForm.notes,
      repeat: txForm.recurring ? 'monthly' : 'none',
    });
    setTxForm({ type: 'income', category: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '', recurring: false });
    setShowTxForm(false);
    setTick((tk) => tk + 1);
    toast(t('fin.txAdded'), 'success');
  };
  const removeTx = (id) => {
    deleteTransaction(mob, finProp, id);
    setTick((tk) => tk + 1);
    toast(t('fin.txRemoved'));
  };
  const doExportCSV = () => {
    exportTransactionsCSV(mob, finProp);
    toast(t('fin.csvExported'), 'success');
  };
  const doExportPDF = async () => {
    await exportStatementPDF(mob, finProp, (listings || []).find((l) => l.id === finProp)?.title || finProp);
    toast(t('fin.pdfDownloaded'), 'success');
  };

  // Ownership basis form state
  const [basisForm, setBasisForm] = useState({
    type: basis?.type || 'owned',
    purchasePrice: basis?.purchasePrice || '',
    purchaseDate: basis?.purchaseDate || '',
    currentValue: basis?.currentValue || '',
  });
  const saveBasis = () => {
    setBasis(mob, finProp, {
      type: basisForm.type,
      purchasePrice: parseFloat(basisForm.purchasePrice) || 0,
      purchaseDate: basisForm.purchaseDate,
      currentValue: parseFloat(basisForm.currentValue) || 0,
    });
    setTick((tk) => tk + 1);
    toast(t('fin.basisSaved'), 'success');
  };
  useEffect(() => {
    const b = finProp ? getBasis(mob, finProp) : null;
    setBasisForm({
      type: b?.type || 'owned',
      purchasePrice: b?.purchasePrice || '',
      purchaseDate: b?.purchaseDate || '',
      currentValue: b?.currentValue || '',
    });
  }, [finProp, mob]);

  const cfData = useMemo(() => ({
    labels: cf.labels || [],
    datasets: [
      { label: t('fin.typeIncome'), data: cf.incomeData || [], backgroundColor: PALETTE[0] },
      { label: t('fin.typeExpense'), data: cf.expenseData || [], backgroundColor: PALETTE[1] },
    ],
  }), [cf, t]);
  const expData = useMemo(() => ({
    labels: expBreak.map((e) => t(CAT_KEYS[e.category] || e.category, { defaultValue: e.category })),
    values: expBreak.map((e) => e.amount),
    colors: PALETTE,
  }), [expBreak, t]);

  const activityPanel = (
    <ActivityPanel
      finType={finType} setFinType={setFinType} typeOpts={typeOpts}
      filteredTxs={filteredTxs} showAllTx={showAllTx} setShowAllTx={setShowAllTx}
      onAdd={() => setShowTxForm(true)} onRemove={removeTx}
    />
  );

  const insightsPanel = <InsightsPanel cf={cf} cfData={cfData} expBreak={expBreak} expData={expData} />;

  const reportsPanel = <ReportsPanel basis={basis} summary={summary} onEditBasis={openBasisModal} />;

  return (
    <>
      <div className="space-y-5">
        <FinancesHeader
          finProp={finProp} setFinProp={setFinProp} listings={listings}
          finPeriod={finPeriod} setFinPeriod={setFinPeriod} periodOpts={periodOpts}
          health={health} onExportCSV={doExportCSV} onExportPDF={doExportPDF}
        />

        <KpiStrip summary={summary} kpiTrend={kpiTrend} cf={cf} netSeries={netSeries} basis={basis} onEditBasis={openBasisModal} />

        <DuesSection dues={dues} onRemind={remindDue} />

        {/* Detail tabs keep the deep data one tap away instead of one long scroll */}
        <Tabs
          variant="underline"
          items={[
            { key: 'activity', label: t('fin.tabActivity'), icon: 'receipt-indian-rupee', content: activityPanel },
            { key: 'insights', label: t('fin.tabInsights'), icon: 'bar-chart-3', content: insightsPanel },
            { key: 'reports', label: t('fin.tabReports'), icon: 'file-text', content: reportsPanel },
          ]}
        />
      </div>

      {/* Thumb-zone quick add (mobile only; desktop uses the Add button in Activity).
          Docked to --pn-bottom-inset rather than a hardcoded bottom-6, and anchored
          bottom-LEFT: the Nestor FAB owns the bottom-right corner at z-1300, so this
          button was both sitting under the bottom nav (z-40 < z-70) and unreachable
          behind the assistant. Same failure the listings filters pill hit. */}
      <button
        type="button"
        onClick={() => setShowTxForm(true)}
        aria-label={t('fin.addTransaction')}
        className="lg:hidden fixed left-4 z-[60] w-14 h-14 rounded-full bg-brand-teal text-ink shadow-xl shadow-black/30 flex items-center justify-center active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        style={{ bottom: 'calc(var(--pn-bottom-inset) + 1rem)' }}
      >
        <Icon name="plus" className="w-6 h-6" />
      </button>

      <AddTransactionModal
        open={showTxForm}
        onClose={() => setShowTxForm(false)}
        txForm={txForm} setTxForm={setTxForm} catOpts={catOpts} onSubmit={submitTx}
      />

      <BasisModal
        open={showBasisModal}
        onClose={() => setShowBasisModal(false)}
        basisForm={basisForm} setBasisForm={setBasisForm} onSave={saveBasis}
      />
    </>
  );
}
