/**
 * Demand Service — what people looked for, as opposed to what owners listed.
 *
 * `POST /demand-signals` (public), and the admin aggregate `GET /admin/supply-gap`.
 *
 * ## What this replaces
 *
 * Three call sites used to append to localStorage arrays (`searchIntents`, `demandAlerts`,
 * `propertyViews`) and the admin Supply Gap tab read them back out again. Nothing was seeded, so
 * the report described the searches performed by whichever administrator was reading it, in that
 * browser, since storage was last cleared. Demand is the one figure that means nothing unless it
 * aggregates across everybody, and it was the figure that could least afford to be per-browser.
 *
 * ## Fire-and-forget, and that is the whole contract
 *
 * `recordSignal` never rejects. A search page, a property page and a "notify me" card each call it
 * as a side effect of something the visitor actually asked for, and none of them can offer a
 * sensible recovery: there is nothing to retry into, nothing to show, and no state that depends on
 * it. An analytics write that can break a search is worse than an analytics write that is lost.
 *
 * So the promise resolves to `true` or `false` rather than throwing, and every caller may ignore
 * the result. The boolean exists for tests, not for branching in a page.
 *
 * ## Anonymous by design
 *
 * The endpoint takes no token and the platform wants it that way — most of the people whose demand
 * is worth measuring have not opened an account, because they have not found anything yet. When a
 * session does exist the server attaches the user id from the token; the client neither knows nor
 * needs to know whether that happened.
 *
 * No contact detail is sent. The mock used to attach a mobile number to every alert signal; the
 * server has no column for it, deliberately, because the only reader is a count.
 */
import { createProvider } from './config.js';

const provider = createProvider('demand');

/**
 * Record one moment of interest. **Never rejects.**
 *
 * @param {{kind: 'search'|'alert'|'view', localitySlug?: string, deal?: 'buy'|'rent',
 *   bhk?: string, propertyId?: string}} signal
 * @returns {Promise<boolean>} whether the write reached the server. Safe to ignore.
 */
export const recordSignal = async (signal) => {
  try {
    return await (await provider()).recordSignal(signal);
  } catch {
    // Swallowed on purpose. See the module docblock: the caller is a search or a property page,
    // and neither has a recovery to offer. Not logged either -- a visitor on a flaky connection
    // would otherwise fill their console with failures for a feature they cannot see.
    return false;
  }
};

/**
 * The supply-gap report: live approved listings against weighted demand, per locality.
 *
 * Staff and admin only. Unlike `recordSignal` this **does** reject — it backs a page whose entire
 * purpose is the figures, so failing quietly would render an empty table that reads as "no demand
 * anywhere", which is a far more expensive lie than an error message.
 *
 * @param {{days?: number}} [opts] rolling window, 1-365, default 30 server-side
 * @returns {Promise<{localitySlug: (string|null), localityName: (string|null), supply: number,
 *   searches: number, alerts: number, views: number, demand: number, gap: number}[]>}
 */
export const supplyGap = async (opts) => (await provider()).supplyGap(opts);
