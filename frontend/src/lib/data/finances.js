/* localStorage keys match the HTML prototype's, for data interop. */

const INCOME_CATS= ['Rent received', 'Deposit received', 'Other income'];
const EXPENSE_CATS = ['Society maintenance', 'Property tax', 'Home loan EMI', 'Repairs', 'Insurance', 'Utilities', 'Commission / fees', 'Other expense'];
export { INCOME_CATS, EXPENSE_CATS };

/* Category ids are stored on every saved transaction and due, so they stay English — renaming
   the visible copy can never orphan a ledger. Look the id up here for a translated label. */
export const CAT_KEYS = {
  'Rent received': 'fin.catRentReceived',
  'Deposit received': 'fin.catDepositReceived',
  'Other income': 'fin.catOtherIncome',
  'Society maintenance': 'fin.catMaintenance',
  'Property tax': 'fin.catPropertyTax',
  'Home loan EMI': 'fin.catEmi',
  Repairs: 'fin.catRepairs',
  Insurance: 'fin.catInsurance',
  Utilities: 'fin.catUtilities',
  'Commission / fees': 'fin.catCommission',
  'Other expense': 'fin.catOtherExpense',
};

const finKey = (mobile, propId) => `draazyFin:${mobile || 'anon'}:${propId || 'all'}`;
const basisKey = (mobile, propId) => `draazyFinBasis:${mobile || 'anon'}:${propId || 'all'}`;
const loanKey = (mobile, propId) => `draazyFinLoan:${mobile || 'anon'}:${propId || 'all'}`;
const tenantKey = (mobile, propId) => `draazyFinTenant:${mobile || 'anon'}:${propId || 'all'}`;
const budgetKey = (mobile, propId) => `draazyFinBudget:${mobile || 'anon'}:${propId || 'all'}`;

function get(k, def) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch { return def; }
}
function set(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
  return v;
}

export function getBasis(mobile, propId) { return get(basisKey(mobile, propId), null); }
export function setBasis(mobile, propId, { type, purchasePrice, purchaseDate, currentValue }) {
  return set(basisKey(mobile, propId), {
    type: type || 'owned',
    purchasePrice: Number(purchasePrice) || 0,
    purchaseDate: purchaseDate || null,
    currentValue: Number(currentValue) || 0,
    updatedAt: Date.now(),
  });
}

export function getTransactions(mobile, propId) { return get(finKey(mobile, propId), []); }
export function setTransactions(mobile, propId, txns) { return set(finKey(mobile, propId), txns); }

export function addTransaction(mobile, propId, { type, category, amount, date, repeat, note }) {
  const txns = getTransactions(mobile, propId);
  const id = 't' + Date.now();
  const rec = {
    id, type: type || 'expense', category: category || 'Other expense',
    amount: Number(amount) || 0, date: date || new Date().toISOString().slice(0, 10),
    repeat: repeat || 'none', note: note || '', createdAt: Date.now(),
  };
  txns.unshift(rec);
  setTransactions(mobile, propId, txns);
  return rec;
}

export function updateTransaction(mobile, propId, txnId, patch) {
  const txns = getTransactions(mobile, propId);
  const idx = txns.findIndex((t) => t.id === txnId);
  if (idx >= 0) {
    txns[idx] = { ...txns[idx], ...patch, updatedAt: Date.now() };
    setTransactions(mobile, propId, txns);
    return txns[idx];
  }
  return null;
}

export function deleteTransaction(mobile, propId, txnId) {
  const txns = getTransactions(mobile, propId).filter((t) => t.id !== txnId);
  setTransactions(mobile, propId, txns);
  return txns;
}

export function getLoan(mobile, propId) { return get(loanKey(mobile, propId), null); }
export function setLoan(mobile, propId, { amount, rate, tenure, startDate }) {
  return set(loanKey(mobile, propId), {
    amount: Number(amount) || 0, rate: Number(rate) || 8.5, tenure: Number(tenure) || 20,
    startDate: startDate || null, updatedAt: Date.now(),
  });
}

export function getTenant(mobile, propId) { return get(tenantKey(mobile, propId), null); }
export function setTenant(mobile, propId, { name, rent, deposit, leaseStart, leaseEnd, escalation }) {
  return set(tenantKey(mobile, propId), {
    name: name || '', rent: Number(rent) || 0, deposit: Number(deposit) || 0,
    leaseStart: leaseStart || null, leaseEnd: leaseEnd || null,
    escalation: Number(escalation) || 5, updatedAt: Date.now(),
  });
}

export function getBudgets(mobile, propId) { return get(budgetKey(mobile, propId), {}); }
export function setBudgets(mobile, propId, budgets) { return set(budgetKey(mobile, propId), budgets); }
export function setBudget(mobile, propId, category, amount) {
  const b = getBudgets(mobile, propId);
  b[category] = Number(amount) || 0;
  return setBudgets(mobile, propId, b);
}

export function calculateEMI(principal, annualRate, tenureYears) {
  const P = Number(principal) || 0;
  const r = (Number(annualRate) || 8.5) / 12 / 100;
  const n = (Number(tenureYears) || 20) * 12;
  if (P <= 0 || r <= 0 || n <= 0) return { emi: 0, total: 0, interest: 0 };
  const emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const total = emi * n;
  return { emi: Math.round(emi), total: Math.round(total), interest: Math.round(total - P) };
}

/** Mirrors `SummaryPeriods` on the server. */
export const FIN_PERIODS = ['all', 'month', 'quarter', 'year'];

/* The only copy of this arithmetic in the frontend; must stay a mirror of `SummaryPeriods.startOf`
   on the server. `year` is the Indian financial year, 1 April – 31 March. */
export function periodStart(period, now = new Date()) {
  switch (period) {
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'quarter':
      return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    case 'year':
      // Month index 3 is April. Before April we are still in the FY that began last April.
      return now.getMonth() >= 3
        ? new Date(now.getFullYear(), 3, 1)
        : new Date(now.getFullYear() - 1, 3, 1);
    default:
      return null;
  }
}

/** Rows on or after the window's start. `all` (a null start) keeps everything. */
export function filterByPeriod(txns, period, now = new Date()) {
  const start = periodStart(period, now);
  if (!start) return [...(txns || [])];
  return (txns || []).filter((t) => new Date(t.date) >= start);
}

export function financeSummary(mobile, propId, period = 'all', now = new Date()) {
  const txns = filterByPeriod(getTransactions(mobile, propId), period, now);

  const income = txns.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
  const expense = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);
  return { income, expense, net: income - expense, count: txns.length };
}

export function expenseBreakdown(mobile, propId, period = 'all', now = new Date()) {
  const txns = filterByPeriod(
    getTransactions(mobile, propId).filter((t) => t.type === 'expense'),
    period,
    now,
  );

  const byCategory = {};
  txns.forEach((t) => { byCategory[t.category] = (byCategory[t.category] || 0) + (t.amount || 0); });
  return byCategory;
}

export function cashflowByMonth(mobile, propId, months = 12) {
  const txns = getTransactions(mobile, propId);
  const now = new Date();
  const labels = [];
  const incomeData = [];
  const expenseData = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    // Year-month key from LOCAL parts: toISOString() would shift local midnight into the
    // previous month for UTC+ zones (e.g. IST), emptying the current month's bucket.
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }));
    const monthTxns = txns.filter((t) => (t.date || '').startsWith(ym));
    incomeData.push(monthTxns.filter((t) => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0));
    expenseData.push(monthTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0));
  }
  return { labels, incomeData, expenseData };
}

export function getDues(mobile, propId) {
  const txns = getTransactions(mobile, propId).filter((t) => t.repeat && t.repeat !== 'none');
  const now = new Date();
  const dues = [];

  txns.forEach((t) => {
    const lastDate = new Date(t.date);
    let nextDue;
    if (t.repeat === 'monthly') {
      nextDue = new Date(now.getFullYear(), now.getMonth(), lastDate.getDate());
      if (nextDue <= lastDate || nextDue > new Date(now.getFullYear(), now.getMonth() + 1, 0)) {
        nextDue.setMonth(nextDue.getMonth() + 1);
      }
    } else if (t.repeat === 'quarterly') {
      nextDue = new Date(lastDate);
      while (nextDue <= now) nextDue.setMonth(nextDue.getMonth() + 3);
    } else if (t.repeat === 'yearly') {
      nextDue = new Date(lastDate);
      while (nextDue <= now) nextDue.setFullYear(nextDue.getFullYear() + 1);
    }
    if (nextDue) {
      const daysUntil = Math.ceil((nextDue - now) / 86400000);
      dues.push({ ...t, nextDue: nextDue.toISOString().slice(0, 10), daysUntil });
    }
  });

  return dues.sort((a, b) => a.daysUntil - b.daysUntil);
}

export function exportTransactionsCSV(mobile, propId) {
  const txns = getTransactions(mobile, propId);
  const header = ['Date', 'Type', 'Category', 'Amount', 'Note', 'Repeat'];
  const rows = txns.map((t) => [t.date, t.type, t.category, t.amount, t.note || '', t.repeat || 'none']);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `draazy-transactions-${propId || 'all'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// jsPDF (~382 KB) is loaded on demand: a static import here would put the whole PDF library in
// front of first paint for every visitor.
export async function exportStatementPDF(mobile, propId, title) {
  const txns = getTransactions(mobile, propId);
  const summary = financeSummary(mobile, propId, 'all');
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.setFontSize(18);
  doc.text('Property Finance Statement', 20, 20);
  doc.setFontSize(10);
  let top = 28;
  if (title) { doc.text(String(title), 20, top); top += 6; }
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 20, top);

  doc.setFontSize(12);
  doc.text(`Total Income: ₹${summary.income.toLocaleString('en-IN')}`, 20, 42);
  doc.text(`Total Expense: ₹${summary.expense.toLocaleString('en-IN')}`, 20, 50);
  doc.text(`Net: ₹${summary.net.toLocaleString('en-IN')}`, 20, 58);

  doc.setFontSize(10);
  let y = 72;
  doc.text('Date', 20, y); doc.text('Type', 50, y); doc.text('Category', 75, y); doc.text('Amount', 140, y);
  y += 8;

  txns.slice(0, 40).forEach((t) => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(t.date || '', 20, y);
    doc.text(t.type || '', 50, y);
    doc.text((t.category || '').slice(0, 20), 75, y);
    doc.text(`₹${(t.amount || 0).toLocaleString('en-IN')}`, 140, y);
    y += 6;
  });

  doc.save(`draazy-statement-${propId || 'all'}.pdf`);
}
