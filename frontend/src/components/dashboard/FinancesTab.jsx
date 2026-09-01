import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import Tabs from '../ui/Tabs.jsx';
import { fmtINR } from '../../lib/format.js';
import { PALETTE } from '../charts/index.jsx';
import TenantFinancesTab from './TenantFinancesTab.jsx';
import {
  INCOME_CATS, EXPENSE_CATS, CAT_KEYS, filterByPeriod,
  exportTransactionsCSV, exportStatementPDF,
} from '../../lib/data/finances.js';
import {
  getBasis, setBasis, listTransactions, addTransaction, deleteTransaction,
  financeSummary, cashflow as cashflowApi, dues as duesApi,
} from '../../services/rentService.js';
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
  /* The finance routes parse `{propId}` as a UUID and 404 on anything else, so the selector has to
     carry the **uuid** — not `l.id`, which is the listing's *slug* (`p5002`) because the property
     routes accept slug-or-id and a slug makes a prettier URL. The `l.id` fallback is retained for
     rows that carry no separate uuid; it is a safety net rather than a live path, since every
     row the API returns here has one. */
  const propKey = (l) => String(l?.uuid || l?.id || '');
  /* "My Listings" is a **heterogeneous** array: `loadMyListings` concatenates flatmate posts,
     groups and rooms ahead of the owner's actual properties, all wearing the same listing shape
     and flagged `flatmate:true`. A flatmate post's id is a `flatmate_seeker_posts` row, not a
     property — so offering one here, or defaulting to `listings[0]`, pointed all five
     `/me/finances/{propId}/…` reads at a UUID the properties table has never heard of and the tab
     answered a real owner with a burst of 404s. Because the flatmate rows are concatenated FIRST,
     that was the default for every owner who had any. A P&L is a property thing; narrow once here
     so the picker, the initial selection, the recovery effect and the PDF title cannot disagree
     about what counts as one. */
  const propOpts = useMemo(() => (listings || []).filter((l) => !l.flatmate), [listings]);
  const [finProp, setFinProp] = useState(propKey(propOpts[0]));
  const [finPeriod, setFinPeriod] = useState('all');
  const [finType, setFinType] = useState('all');
  const [txForm, setTxForm] = useState({ type: 'income', category: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '', recurring: false });
  const [showTxForm, setShowTxForm] = useState(false);
  const [showAllTx, setShowAllTx] = useState(false);
  const [showBasisModal, setShowBasisModal] = useState(false);
  const [tick, setTick] = useState(0);

  const mob = user?.mobile || '';

  /* The period-independent half of what this tab renders, in one pass.

     `summary`, `cashflow` and `dues` used to be client-side reductions over the transaction list.
     They are endpoints now — not for tidiness, but because the ledger is **paged**, so reducing
     over what the client happened to hold produced a summary of page one wearing the label of a
     summary. The server counts the whole book. (`summary` has since moved to its own effect below,
     because it is the one read the period selector moves.)

     Keyed on `finProp` and a `tick` the mutations bump, so a save re-reads rather than patching
     derived values by hand and hoping they stay consistent with each other. */
  const EMPTY = { basis: null, txs: [], duesRaw: [], cf: [] };
  const [fin, setFin] = useState(EMPTY);
  useEffect(() => {
    if (!finProp) { setFin(EMPTY); return undefined; }
    let alive = true;
    Promise.all([
      getBasis(finProp).catch(() => null),
      listTransactions(finProp).catch(() => ({ items: [] })),
      duesApi(finProp).catch(() => []),
      cashflowApi(finProp).catch(() => []),
    ]).then(([basisRow, txPage, duesRows, cfRows]) => {
      if (!alive) return;
      setFin({
        basis: basisRow,
        txs: txPage?.items || [],
        duesRaw: duesRows || [],
        cf: cfRows || [],
      });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finProp, tick]);

  /* The summary is its own read because it is the only one of the five that is **scoped to the
     period selector**. It used to be fetched with no period at all, so the KPI strip answered
     all-time while the table below it answered the selected window — and the two disagreed even
     about where "year" starts, because the table pivoted on 1 January and the server pivots on
     1 April (D178). Asking the server for the selected window is what makes the card and the table
     two views of one answer; the ledger, dues and cashflow do not move when the period does, so
     they stay in the effect above rather than being re-pulled on every toggle. */
  const EMPTY_SUMMARY = { income: 0, expense: 0, net: 0 };
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  useEffect(() => {
    if (!finProp) { setSummary(EMPTY_SUMMARY); return undefined; }
    let alive = true;
    financeSummary(finProp, finPeriod)
      .catch(() => EMPTY_SUMMARY)
      .then((row) => { if (alive) setSummary(row || EMPTY_SUMMARY); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finProp, finPeriod, tick]);

  const { basis, txs, duesRaw } = fin;
  const dues = useMemo(() => ({ overdue: duesRaw.filter((d) => d.daysUntil < 0), upcoming: duesRaw.filter((d) => d.daysUntil >= 0) }), [duesRaw]);
  // The transaction list is already the complete owner-scoped server ledger. Reading
  // `expenseBreakdown` here used a browser-local finance key, so a second device showed a correct
  // headline summary beside an empty expense chart. Derive this presentation-only grouping from
  // the fetched rows instead of making the chart a second store.
  const expBreak = useMemo(() => {
    const totals = new Map();
    for (const transaction of filterByPeriod(txs, finPeriod)) {
      if (transaction.type !== 'expense') continue;
      totals.set(transaction.category, (totals.get(transaction.category) || 0) + (Number(transaction.amount) || 0));
    }
    return [...totals].map(([category, amount]) => ({ category, amount }));
  }, [txs, finPeriod]);
  /* The chart wants three parallel arrays; the wire sends a list of points. Reshaped here rather
     than in the mapper, because the shape is this chart's, not the domain's. */
  const cf = useMemo(() => ({
    labels: fin.cf.map((p) => p.month),
    incomeData: fin.cf.map((p) => p.income),
    expenseData: fin.cf.map((p) => p.expense),
  }), [fin.cf]);

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
    const opts = propOpts;
    if (opts.length === 0) return;
    if (!finProp || !opts.some((l) => propKey(l) === finProp)) setFinProp(propKey(opts[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propOpts, finProp]);

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

  /* The window is `filterByPeriod`'s, not this component's. That function is the frontend's only
     copy of the arithmetic and mirrors the server's `SummaryPeriods.startOf`, so the rows listed
     here are the rows the KPI strip above already counted — including `year` meaning 1 April, which
     the hand-rolled version here got wrong from January to March (D178). */
  const filteredTxs = useMemo(() => {
    const typed = finType === 'all' ? txs : txs.filter((t) => t.type === finType);
    return filterByPeriod(typed, finPeriod).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [txs, finType, finPeriod]);

  const submitTx = async () => {
    if (!txForm.category || !txForm.amount || isNaN(parseFloat(txForm.amount))) {
      toast(t('fin.fillCatAmount'), 'error');
      return;
    }
    try {
      // The store called the repeat interval `repeat`; the wire calls it `recurring`. One name wins
      // at the seam, and it is the wire's.
      await addTransaction(finProp, {
        type: txForm.type,
        category: txForm.category,
        amount: parseFloat(txForm.amount),
        date: txForm.date,
        note: txForm.notes,
        recurring: txForm.recurring ? 'monthly' : 'none',
      });
    } catch (err) {
      toast(err?.body?.error || err?.message || t('fin.fillCatAmount'), 'error');
      return;
    }
    setTxForm({ type: 'income', category: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '', recurring: false });
    setShowTxForm(false);
    setTick((tk) => tk + 1);
    toast(t('fin.txAdded'), 'success');
  };
  const removeTx = async (id) => {
    try {
      await deleteTransaction(finProp, id);
    } catch (err) {
      toast(err?.body?.error || err?.message || t('fin.txRemoved'), 'error');
      return;
    }
    setTick((tk) => tk + 1);
    toast(t('fin.txRemoved'));
  };
  const doExportCSV = () => {
    exportTransactionsCSV(mob, finProp);
    toast(t('fin.csvExported'), 'success');
  };
  const doExportPDF = async () => {
    await exportStatementPDF(mob, finProp, propOpts.find((l) => propKey(l) === finProp)?.title || finProp);
    toast(t('fin.pdfDownloaded'), 'success');
  };

  // Ownership basis form state
  const [basisForm, setBasisForm] = useState({
    type: basis?.type || 'owned',
    purchasePrice: basis?.purchasePrice || '',
    purchaseDate: basis?.purchaseDate || '',
    currentValue: basis?.currentValue || '',
  });
  const saveBasis = async () => {
    try {
      await setBasis(finProp, {
        purchasePrice: parseFloat(basisForm.purchasePrice) || 0,
        purchaseDate: basisForm.purchaseDate,
        currentValue: parseFloat(basisForm.currentValue) || 0,
      });
    } catch (err) {
      toast(err?.body?.error || err?.message || t('fin.basisSaved'), 'error');
      return;
    }
    setTick((tk) => tk + 1);
    toast(t('fin.basisSaved'), 'success');
  };
  // The basis form mirrors whatever the load resolved, rather than re-fetching. `basis` is already
  // the answer for this property; asking again would be a second request for a value in hand.
  useEffect(() => {
    setBasisForm({
      type: basis?.type || 'owned',
      purchasePrice: basis?.purchasePrice || '',
      purchaseDate: basis?.purchaseDate || '',
      currentValue: basis?.currentValue || '',
    });
  }, [basis]);

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
          finProp={finProp} setFinProp={setFinProp} listings={propOpts}
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
          Docked to --dz-bottom-inset rather than a hardcoded bottom-6, and anchored
          bottom-LEFT: the Nestor FAB owns the bottom-right corner at z-1300, so this
          button was both sitting under the bottom nav (z-40 < z-70) and unreachable
          behind the assistant. Same failure the listings filters pill hit. */}
      <button
        type="button"
        onClick={() => setShowTxForm(true)}
        aria-label={t('fin.addTransaction')}
        className="lg:hidden fixed left-4 z-[60] w-14 h-14 rounded-full bg-brand-teal text-ink shadow-xl shadow-black/30 flex items-center justify-center active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        style={{ bottom: 'calc(var(--dz-bottom-inset) + 1rem)' }}
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
