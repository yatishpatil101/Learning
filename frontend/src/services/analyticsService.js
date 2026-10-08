/** Measured data only: a card with no server source is absent, not sampled, and functions reject on outage
 * rather than resolve empty. Rates are null when nothing was measured (render "—"); counts are real zeros. */
import { createProvider } from './config.js';

const provider = createProvider('analytics');

/** Measured asking prices per locality. Every derived figure is nullable and null means "not measurable", never zero; render it as "no data". */
export const localityPricing = async () => (await provider()).localityPricing();
/** Everything `/admin` shows (`GET /admin/dashboard`); a section is absent when the caller lacks its permission, never zero, and an outage rejects. */
export const adminDashboard = async () => (await provider()).adminDashboard();

/** The topbar bell (`GET /admin/bell`): slim queues, present only for a caller who may read them. */
export const adminBell = async () => (await provider()).adminBell();
/** Moderation turnaround against the review SLA, from each listing's earliest `property.status` audit row. Nulls mean the queue has not been worked and must not render as 0 or 100%;
 * `pendingCount` and `pendingBreachingCount` ignore `days` because a backlog is a present-tense fact. */
export const reviewSla = async (opts) => (await provider()).reviewSla(opts);

/** Sessions, page views and signups per day, plus source, device and identity splits. `series` is zero-filled so charts do not interpolate across no-data days;
 * `sources` are channels (no paid channel: `utm_source` is stripped), `identity` is signed-in vs anonymous, and sources and devices count sessions, not views. */
export const traffic = async (opts) => (await provider()).traffic(opts);

/** Weekly session length and bounce rate (null, not 0, for an empty week; bounce computed server-side) plus top pages by real view counts. */
export const engagement = async (opts) => (await provider()).engagement(opts);

/** Listings posted, approved, contacted, visited and closed per ISO week, zero-filled; each stage counts events in the week they happened. */
export const funnel = async (opts) => (await provider()).funnel(opts);

/** How much of the audience browses without an account, and where it leaves. `anonSharePct` and `conversionRatePct` are null with no sessions and stay numbers for `toLocaleString`;
 * `dropOff[].sharePct` is a share of the exits shown (the list is capped), and `pages[]` has no per-page signup rate. */
export const surfers = async (opts) => (await provider()).surfers(opts);
