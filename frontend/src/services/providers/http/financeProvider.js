/** The one apparent exception is `unwrapPage` on the ledger, which is a shape adapter and not a calculation. */
import { get, unwrapPage } from '../../http.js';

/** Coerce to a whole-rupee number. An absent figure is zero, never `NaN` and never a string. */
const rupees = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** A separate coercer because `users` and `payingUsers` are counts of people, not money. */
const count = (value) => Math.max(0, Math.round(rupees(value)));

export async function getFinanceOverview() {
  const res = (await get('/admin/finance')) || {};
  return {
    revenue: rupees(res.revenue),
    payoutsDue: rupees(res.payoutsDue),
    payoutsCompleted: rupees(res.payoutsCompleted),
    refunds: rupees(res.refunds),
    breakdown: Array.isArray(res.breakdown)
      ? res.breakdown.map((line) => ({ source: line.source, amount: rupees(line.amount) }))
      : [],
    payoutsMeasured: res.payoutsMeasured === true,
    refundsMeasured: res.refundsMeasured === true,
    serviceOrdersCounted: res.serviceOrdersCounted === true,
    mrr: rupees(res.mrr),
    monthRevenue: rupees(res.monthRevenue),
    users: count(res.users),
    payingUsers: count(res.payingUsers),
    gstCollected: rupees(res.gstCollected),
    pendingSettlement: rupees(res.pendingSettlement),
    plans: Array.isArray(res.plans)
      ? res.plans.map((p) => ({
        name: p.name,
        audience: p.audience,
        billingCycle: p.billingCycle,
        price: rupees(p.price),
        active: count(p.active),
        monthlyValue: rupees(p.monthlyValue),
      }))
      : [],
  };
}

/* Keep server ISO months intact; charts and CSV exports need different labels. */
export async function getFinanceSeries(months = 12) {
  const rows = await get('/admin/finance/series', { months });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    month: r.month,
    rent: rupees(r.rent),
    subscriptions: rupees(r.subscriptions),
    // Always zero, and carried rather than dropped — see `financeService.js`.
    services: rupees(r.services),
  }));
}

/** Empty filter values are omitted rather than sent blank. `?kind=` would reach the server as an empty string, which
 * is not one of the three values it accepts, so an unfiltered view would answer 400. */
export async function listFinanceTransactions({
  kind, status, q, page = 0, size = 20,
} = {}) {
  const query = { page, size };
  if (kind) query.kind = kind;
  if (status) query.status = status;
  if (q && q.trim()) query.q = q.trim();

  const res = await get('/admin/finance/transactions', query);
  const unwrapped = unwrapPage(res, { page, size });
  return {
    ...unwrapped,
    items: unwrapped.items.map((t) => ({
      id: t.id,
      date: t.date,
      party: t.party,
      kind: t.kind,
      amount: rupees(t.amount),
      status: t.status,
      // Absent on every source but rent, and absent rather than null on the wire. `undefined`
      // is what the column's own fallback already tests for.
      method: t.method,
    })),
  };
}
