/**
 * Analytics Service — the measured half of the admin Analytics page, plus the dashboard scorecard.
 *
 * `GET /admin/analytics/{pricing,sla,traffic,engagement,surfers}` and `GET /admin/dashboard`, all
 * staff/admin.
 *
 * ## What this replaces, and what it deliberately does not
 *
 * Seven of the eight Analytics tabs were computed in the browser by `lib/data/analytics-extra.js`
 * from a seeded LCG. Four of them were describing things Postgres already knew, or could be made to
 * know, and got wrong in ways an operator could not see:
 *
 * - **Pricing** fell back to the locality's curated market rate whenever it had no listings to
 *   average, so the deviation it printed was exactly zero. A locality PuneNest has never listed a
 *   single home in rendered as the best-priced place in Pune, indistinguishable from one that is
 *   genuinely well served — which is the one distinction the report exists to draw.
 * - **SLA** drew every turnaround from `rng(314159)`. The "average approval time" on the screen was
 *   a constant: it did not move when the moderation team got faster, and it did not move when they
 *   stopped reviewing altogether. The same generator drew ticket pickup, service delivery and the
 *   concierge pipeline; all three are served from `audit_log` now, alongside listing review.
 * - **Traffic, Engagement and Anonymous surfers** were not merely wrong, they were unanswerable:
 *   the platform recorded no page views at all. They are measured now because `POST /page-views`
 *   collects them and an hourly rollup aggregates them — see `services/pageViewService.js`.
 *
 * **This module is only ever the measured data**, and as of the SLA tracks it is now the whole of
 * both tabs. The cards that had no server source are deleted rather than kept behind a `Sample`
 * chip: six-month price trends and per-listing price position needed history and per-listing market
 * estimates that nothing records, the weekly SLA compliance line needed weekly snapshots nothing
 * writes, and the Seasonal tab needed one to three years of demand history that collection started
 * far too recently to have. A chip was not enough — the figures sat in the same grid, in the same
 * typeface, beside measurements, and they never moved. Mixing a measurement and an invention behind
 * one function is how the old page became untrustworthy in the first place, so where the data ends
 * the card ends too.
 *
 * ## Every function rejects rather than resolving empty
 *
 * Each backs a screen whose entire purpose is its figures. Resolving to zeroes on an outage would
 * render a page claiming no listings are mispriced, no review has ever breached and nobody visited
 * the site, which is a far more expensive lie than an empty tab. The page catches per tab, so one
 * failure does not blank the other seven.
 *
 * ## Rates are null when nothing was measured; counts are not
 *
 * A bounce rate of 0% claims every visitor read on, and a 0% anonymous share claims every visitor
 * signed in. Both are assertions about a week nobody visited. So every `*Pct` and every average
 * arrives nullable and must render as "—", while every count arrives as a number because zero
 * sessions is a measurement. This is the same rule `localityPricing` follows one report over.
 */
import { createProvider } from './config.js';

const provider = createProvider('analytics');

/**
 * Asking prices against curated market rates, one row per active locality.
 *
 * **Every derived figure is nullable and null means "not measurable", never zero.** A locality with
 * no approved buy listings reports `avgActualRatePerSqft: null`; render it as "no data" and do not
 * fall back to `marketRatePerSqft`, which is the exact bug this replaced.
 *
 * `buyCount` and `rentCount` count all approved listings including those whose area is missing and
 * which therefore contributed nothing to the averages. Supply and the sample an average was drawn
 * from are different questions and are not conflated.
 *
 * @returns {Promise<{slug: string, name: string, marketRatePerSqft: (number|null),
 *   avgActualRatePerSqft: (number|null), avgRent: (number|null), rentalYieldPct: (number|null),
 *   buyCount: number, rentCount: number, totalListings: number, demand: (number|null)}[]>}
 */
export const localityPricing = async () => (await provider()).localityPricing();
/**
 * The dashboard's catalogue-wide counters (`AdminKpis`).
 *
 * Here rather than in a service of its own because it is the third read on the same controller as
 * `reviewSla` above. It is the one function in this module whose failure is *not* fatal to its
 * screen: the dashboard's queue tiles come from the collections beside it and stay meaningful
 * without the totals, so `AdminDashboard` catches this one and hides the affected tiles.
 *
 * `revenue30d` is null for a staff caller by design — read it as "not disclosed", never as zero.
 */
export const dashboardKpis = async () => (await provider()).dashboardKpis();

/**
 * Moderation turnaround against the review SLA.
 *
 * Measured from the earliest `property.status` audit row for each listing — earliest, because a
 * re-approval is a later re-check of the same listing rather than a second first decision.
 *
 * **Nulls mean the queue has not been worked, and must render as such.** `avgHoursToReview` of 0
 * would read as instantaneous review and `slaRatePct` of 100 as a perfect record, both claims about
 * a team that has decided nothing. The mock returned exactly those two figures, so a fresh
 * deployment reported flawless compliance.
 *
 * `pendingCount` and `pendingBreachingCount` ignore `days` on purpose: a backlog is a present-tense
 * fact, and windowing it would drop the oldest rows, which are the ones worth surfacing.
 *
 * @param {{days?: number}} [opts] optional window, 1-365, applied to the decision instant
 * @returns {Promise<{targetHours: (number|null), reviewedCount: number,
 *   avgHoursToReview: (number|null), medianHoursToReview: (number|null),
 *   breachedCount: (number|null), slaRatePct: (number|null),
 *   pendingCount: number, pendingBreachingCount: number,
 *   worstPending: {id: string, title: string, hoursWaiting: number}[]}>}
 */
export const reviewSla = async (opts) => (await provider()).reviewSla(opts);

/**
 * Sessions, page views and signups per day, plus the traffic-source, device and identity splits.
 *
 * **`series` is zero-filled across the whole window.** The rollup writes no row for a day nobody
 * visited, and a sparse series lets a line chart join Monday to Friday with a straight segment —
 * inventing a smooth trend across exactly the days there is no data for. A present-but-zero day
 * draws the trough that actually happened.
 *
 * **`sources` are channels, not hosts.** Referrer hosts are folded into `Organic search`, `Social`,
 * `WhatsApp`, `Other referrals` and `Direct` server-side. There is no paid-advertising channel and
 * there cannot be one: identifying paid traffic needs `utm_source`, which lives in the query string,
 * which the collector strips before anything is sent. A slice that always read zero would be worse
 * than its absence.
 *
 * **`identity` is signed-in vs anonymous, not new vs returning.** The session id is minted per
 * browser tab in `sessionStorage` and dies with it, by design, so a returning visitor is
 * structurally underivable rather than merely unimplemented. Weeks are real ISO weeks anchored to
 * Monday and are zero-filled like the days.
 *
 * A source counts **sessions**, attributed to the session's first view, and so does the device
 * split. Counting views would weight an arrival by how much it went on to read, then present that
 * as reach.
 *
 * @param {{days?: number}} [opts] window in days, 1-400; defaults to 90 server-side
 * @returns {Promise<{days: number, from: string, to: string,
 *   series: {date: string, sessions: number, pageviews: number, signups: number}[],
 *   sources: {channel: string, sessions: number, sharePct: (number|null)}[],
 *   devices: {mobile: number, tablet: number, desktop: number},
 *   identity: {week: string, anonymous: number, signedIn: number}[]}>}
 */
export const traffic = async (opts) => (await provider()).traffic(opts);

/**
 * Session length and bounce rate by ISO week, and the most-viewed pages.
 *
 * **`avgSessionMinutes` and `bounceRatePct` are null for a week with no sessions**, never 0. Zero
 * would read as instant departures and a perfect read-through respectively, both claims about a
 * week that had no visitors to make claims about.
 *
 * **Bounce rate is the week's bounces over the week's sessions**, computed server-side — not the
 * mean of seven daily rates, which would weight a four-session Tuesday the same as a
 * four-thousand-session Saturday.
 *
 * `topPages[].views` are real counts. The card this replaced plotted a 0-100 index pinned at 100 for
 * the leader, so the top page looked equally dominant however far traffic fell.
 *
 * @param {{days?: number}} [opts] window in days, 1-400; defaults to 90 server-side
 * @returns {Promise<{days: number, from: string, to: string,
 *   weeks: {week: string, sessions: number, avgSessionMinutes: (number|null),
 *     bounceRatePct: (number|null)}[],
 *   topPages: {path: string, views: number, anonViews: number}[]}>}
 */
export const engagement = async (opts) => (await provider()).engagement(opts);

/**
 * How much of the audience browses without an account, and where it leaves.
 *
 * **`anonSharePct` and `conversionRatePct` are null when there were no sessions**, and both arrive
 * as numbers rather than pre-formatted strings — the version this replaces returned `.toFixed()`
 * output, which the KPI tiles beside it then called `.toLocaleString('en-IN')` on.
 *
 * `pages[]` reports anonymous views against total views per page. It carries **no per-page signup
 * rate**: attributing a signup to a page needs a landing page recorded against a new account, which
 * is precisely the traffic-to-identity join the collector is designed not to make.
 *
 * `dropOff[].sharePct` is a share of the exits **shown**, not of all exits, because the list is
 * capped. Reading it as "38% of everyone who left, left here" would be wrong by however long the
 * tail is.
 *
 * @param {{days?: number}} [opts] window in days, 1-400; defaults to 90 server-side
 * @returns {Promise<{days: number, from: string, to: string, totalSessions: number,
 *   anonSessions: number, signedInSessions: number, signups: number,
 *   anonSharePct: (number|null), conversionRatePct: (number|null),
 *   weeks: {week: string, anonymous: number, signedIn: number}[],
 *   pages: {path: string, views: number, anonViews: number}[],
 *   dropOff: {path: string, exits: number, sharePct: (number|null)}[]}>}
 */
export const surfers = async (opts) => (await provider()).surfers(opts);
