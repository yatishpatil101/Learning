/**
 * Finance Service — the back-office finance console (ledger item 20 / D235).
 *
 * `GET /admin/finance` · `GET /admin/finance/series` · `GET /admin/finance/transactions`,
 * all three `x-roles: [admin]`.
 *
 * ## Why this domain exists
 *
 * Because the console was drawing a business that did not exist. The revenue curve came from a
 * seeded pseudo-random function, ledger rows took their status by rotating a hardcoded array of ten
 * strings, and partner payouts were a flat 65% of an invented services figure.
 *
 * None of that was a missing port. `GET /admin/finance` had existed, admin-gated, since the metrics
 * slice, and had never had a caller. What was missing was everything around it: the server answered
 * "where is the money" in four numbers and the screen asked eight further questions.
 *
 * ## What the server can and cannot answer, and why the difference is visible
 *
 * Revenue is exactly three sources — rent convenience fees, subscriptions, boosts — and the
 * marketplace is deliberately **not** a fourth: no money moves through the gateway, so
 * `service_orders.amount` is a quote rather than a receipt. The console still draws a services band
 * and still shows a services tile, both reading a measured ₹0 under the existing "quoted, not
 * received" marker. That is a decision (ledger 20), not an oversight: the marketplace visibly takes
 * bookings, so a chart with no services in it reads as a rendering fault rather than as a statement
 * about the business.
 *
 * The same rule governs payouts and refunds. Neither path exists, both are structural zeros, and
 * `payoutsMeasured` / `refundsMeasured` travel beside the figures so the screen can mark them.
 * **A figure this seam cannot source is never invented here** — it is reported as zero and
 * disclosed, because the alternative is the failure the whole D63/D65 disclosure mechanism was
 * built to prevent.
 *
 * ## Whole rupees, everywhere
 *
 * Like every other money value the seam carries. No paise, no floats, no currency strings.
 */
import { createProvider } from './config.js';

const provider = createProvider('finance');

/**
 * The overview: revenue and liabilities, the models, and the disclosure flags.
 *
 * Everything on it is all-time except the five month-scoped figures (`monthRevenue`,
 * `payingUsers`, `gstCollected`, and the two that derive from them on screen). The window is cut
 * server-side on the Indian calendar, deliberately: a client that computed "this month" itself
 * would disagree with the chart beside it at every month boundary and in every time zone.
 *
 * @returns {Promise<{
 *   revenue: number, payoutsDue: number, payoutsCompleted: number, refunds: number,
 *   breakdown: Array<{ source: string, amount: number }>,
 *   payoutsMeasured: boolean, refundsMeasured: boolean, serviceOrdersCounted: boolean,
 *   mrr: number, monthRevenue: number, users: number, payingUsers: number,
 *   gstCollected: number, pendingSettlement: number,
 *   plans: Array<{ name: string, audience: string, billingCycle: string,
 *                  price: number, active: number, monthlyValue: number }>,
 * }>}
 */
export const getFinanceOverview = async () => (await provider()).getFinanceOverview();

/**
 * Revenue per month, split by source, oldest first and ending with the current partial month.
 *
 * Every month in the window comes back, including the ones in which nothing was sold. That is not
 * padding: a gap in a stacked bar chart is not a visible gap — the neighbouring bars simply move
 * up — so an omitted bucket reads as an unbroken run of trading months that did not happen.
 *
 * @param {number} [months=12] how many buckets, counting back from and including this month
 * @returns {Promise<Array<{ month: string, rent: number, subscriptions: number,
 *                           featured: number, services: number }>>}
 */
export const getFinanceSeries = async (months) => (await provider()).getFinanceSeries(months);

/**
 * One page of the settlement ledger, newest first.
 *
 * **`amount` is the platform's share, never the gross** — a rent row carries its convenience fee
 * and not the rent, which belongs to the landlord and is only passing through. This is the single
 * most likely misreading of the table, which is why the column is labelled as the platform's take
 * on screen as well.
 *
 * `status` is settlement (`paid` / `pending` / `failed`), derived server-side from three unrelated
 * source vocabularies. `refunded` is not among them and asking for it is a 400 rather than an empty
 * page — the platform has no refund path, and an accepted-but-unmatchable filter is
 * indistinguishable from a quarter in which nothing sold.
 *
 * @param {object} [opts]
 * @param {'rent_fee'|'subscription'|'featured'} [opts.kind]
 * @param {'paid'|'pending'|'failed'} [opts.status]
 * @param {string} [opts.q] counterparty-name substring
 * @param {number} [opts.page=0]
 * @param {number} [opts.size=20]
 * @returns {Promise<{ items: Array, page: number, size: number, total: number, totalPages: number }>}
 */
export const listFinanceTransactions = async (opts) =>
  (await provider()).listFinanceTransactions(opts);

