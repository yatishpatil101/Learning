/**
 * HTTP finance provider.
 *
 * `GET /admin/finance` · `GET /admin/finance/series` · `GET /admin/finance/transactions`.
 *
 * Verified against `backend/src/main/resources/static/openapi/draazy-api.yaml`
 * (`adminFinance`, `adminFinanceSeries`, `adminFinanceTransactions`, and the schemas
 * `AdminFinance`, `AdminFinanceSeriesPoint`, `AdminFinanceTransaction`) and against
 * `admin/AdminMetricsController.java`.
 *
 * ## Nothing is defaulted into existence
 *
 * A field the server did not send comes back as `0` or `[]` here, and that is the *only*
 * normalisation this file does. It does not compute, split, project or rescale anything — the whole
 * reason this domain exists is that the screen used to derive its numbers locally and was
 * confidently wrong for months. A figure that has to be worked out belongs on the server, where one
 * definition of it can be tested; a figure that has to be *formatted* belongs in the component.
 *
 * The one apparent exception is `unwrapPage` on the ledger, which is a shape adapter and not a
 * calculation: it turns the contract's page envelope into the `{ items, total, … }` the rest of the
 * seam speaks, and it is the same helper every other paged domain uses.
 */
import { get, unwrapPage } from '../../http.js';

/** Coerce to a whole-rupee number. An absent figure is zero, never `NaN` and never a string. */
const rupees = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * The same, for a cardinality.
 *
 * A separate coercer because `users` and `payingUsers` are counts of people, not money: they end up
 * as the `{{count}}` in a tile's caption and as the divisor of ARPU, and a fractional value would
 * read as "across all 81.5 accounts". Rounded rather than trusted.
 */
const count = (value) => Math.max(0, Math.round(rupees(value)));

/**
 * The overview.
 *
 * The three disclosure booleans are read with `=== true`, so anything other than an explicit true
 * reads as "not measured". The default has to be today's truth: a disclosure that defaults to
 * *measured* is an affirmative claim that a figure means something, made by a client that cannot
 * know, and it is exactly what a renamed field would produce silently.
 */
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

/**
 * The monthly series.
 *
 * `month` is passed through as the server's ISO date (`2026-08-01`) rather than being formatted
 * here. The chart wants a short label and the CSV export wants something sortable, and those are
 * two different strings — deriving either at the seam would force the other to un-derive it.
 */
export async function getFinanceSeries(months = 12) {
  const rows = await get('/admin/finance/series', { months });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    month: r.month,
    rent: rupees(r.rent),
    subscriptions: rupees(r.subscriptions),
    featured: rupees(r.featured),
    // Always zero, and carried rather than dropped — see `financeService.js`.
    services: rupees(r.services),
  }));
}

/**
 * One page of the ledger.
 *
 * Empty filter values are omitted rather than sent blank. `?kind=` would reach the server as an
 * empty string, which is not one of the three values it accepts, so an unfiltered view would answer
 * 400 — the console's "All types" option is the absence of the parameter, not a value of it.
 */
export async function listFinanceTransactions({
  kind, status, q, page = 0, size = 20,
} = {}) {
  const query = { page, size };
  if (kind) query.kind = kind;
  if (status) query.status = status;
  if (q && q.trim()) query.q = q.trim();

  const res = await get('/admin/finance/transactions', query);
  warnIfTruncated(res);
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

/**
 * Say so when the ledger is longer than the page every filter is computed over.
 *
 * `AdminFinance.jsx` is the only caller, and it asks for one bounded page of 100 and then does the
 * search, the type filter and the status filter itself in a `useMemo`, pages the result fifteen at a
 * time, and exports it as `draazy-transactions.csv`. All four of those read the window rather than
 * the ledger — so past the hundredth transaction "Failed" quietly comes to mean "failed, among the
 * most recent hundred", in the one console where answering about a subset is a money question.
 *
 * The server already has the filters and validates them — `?kind=`, `?status=`, `?q=`, and it
 * answers 400 for a status it does not speak, which `live-admin-finance.spec.js` pins. The screen
 * simply does not use them. Until it does, this warning is the only thing between a partial answer
 * and a confident one.
 *
 * The same warning already ships for `property`, `reports`, `reviews`, `conversation` and
 * `notification`; finance was the omission. See `unwrapFullPage` in `http.js` for why a ceiling
 * nobody is told about is how a list quietly starts lying, and why this warns rather than throws.
 */
function warnIfTruncated(res) {
  const returned = Array.isArray(res?.content) ? res.content.length : 0;
  const total = res?.totalElements ?? returned;
  if (total > returned) {
    console.warn(
      `[finance] ${total} transactions exist but only ${returned} were fetched. The ledger's search, `
        + 'its type and status filters, its pager and its CSV export all read that page rather than '
        + 'the ledger, so every one of them is now answering about a subset. Paging or server-side '
        + 'filters are needed here.',
    );
  }
}

