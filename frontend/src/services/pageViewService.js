/**
 * Page View Service — which pages were rendered, by how many sessions, for how long.
 *
 * `POST /page-views` (public).
 *
 * ## What this replaces
 *
 * The admin Traffic, Engagement and Anonymous-surfers tabs were drawn end to end from seeded random
 * generators — `trafficSeries(days)` from a fixed seed, and in Engagement's case eight numbers typed
 * straight into the JSX. They were labelled "Sample", so nobody was deceived, but the platform has
 * been live and has never once been able to answer how many people visited it. That is not a chart
 * being wrong; it is a measurement that has never existed, and every day without a collector is a
 * day of history that cannot be recovered later.
 *
 * ## Why the existing signals could not answer it
 *
 * `demand_signals` records that somebody wanted a home in a locality. It carries no session, so no
 * two rows can be shown to belong to one person's browsing — which makes session duration, bounce
 * rate and distinct-viewer counts underivable from it in principle rather than merely missing. It
 * also carries no page, so every surface that is not a search or a listing emits nothing at all: a
 * top-pages chart built on it would report two pages. And `properties.views` has been declared since
 * V3 with no writer anywhere in the backend, so it reads zero for every listing on the platform.
 *
 * ## Fire-and-forget, harder than usual
 *
 * `recordPageViews` never rejects **and resolves to nothing**. The caller is a beacon firing on a
 * route change; there is no retry, no state that depends on it, and nothing to show. Even a boolean
 * would suggest a caller might branch on it, and none should — this is deliberately weaker than
 * `demandService.recordSignal`, which returns a boolean for its tests, and the exact opposite of
 * `analyticsService`, which rejects rather than resolve empty because it backs whole tabs.
 *
 * ## What is never sent
 *
 * No URL, only a matched route pattern — see `lib/telemetry/routePatterns.js`. No full referrer,
 * only its host, because on a search engine the query is what the visitor typed. No User-Agent, only
 * a three-value viewport bucket. No back-office traffic at all: `/admin*` and `/ops*` are dropped in
 * the beacon before anything is queued, because collecting them would build a per-session record of
 * which moderator opened which queue and when — a staff activity log arriving by accident, in a
 * table designed with no access controls for one.
 *
 * The server re-applies the path and referrer rules rather than trusting these, because "the client
 * only ever sends X" stops being true the first time somebody adds a call site.
 */
import { createProvider } from './config.js';

const provider = createProvider('pageView');

/**
 * Send one flush of queued page views. **Never rejects, and resolves to nothing.**
 *
 * @param {{sessionId: string, events: Array<{path: string, referrerHost?: string,
 *   device: 'mobile'|'tablet'|'desktop', agoMs: number}>}} batch
 * @returns {Promise<void>}
 */
export const recordPageViews = async (batch) => {
  try {
    await (await provider()).recordPageViews(batch);
  } catch {
    // Swallowed on purpose, and not logged either. The caller is a route change with no recovery to
    // offer, and a visitor on a flaky connection would otherwise fill their console with failures
    // for a feature they cannot see and did not ask for.
  }
};
