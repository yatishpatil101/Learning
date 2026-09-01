/**
 * Analytics Service — the measured half of the admin Analytics page.
 *
 * `GET /admin/analytics/pricing` and `GET /admin/analytics/sla`, both staff/admin.
 *
 * ## What this replaces, and what it deliberately does not
 *
 * Seven of the eight Analytics tabs were computed in the browser by `lib/data/analytics-extra.js`
 * from a seeded LCG. Two of them were describing things Postgres already knew and got wrong in
 * ways an operator could not see:
 *
 * - **Pricing** fell back to the locality's curated market rate whenever it had no listings to
 *   average, so the deviation it printed was exactly zero. A locality PuneNest has never listed a
 *   single home in rendered as the best-priced place in Pune, indistinguishable from one that is
 *   genuinely well served — which is the one distinction the report exists to draw.
 * - **SLA** drew every turnaround from `rng(314159)`. The "average approval time" on the screen was
 *   a constant: it did not move when the moderation team got faster, and it did not move when they
 *   stopped reviewing altogether.
 *
 * **This module is only ever the measured data.** The tabs still render cards this service does not
 * feed — six-month price trends, the weekly SLA compliance line, ticket pickup and concierge
 * turnaround — because the platform stores nothing that could answer them: there are no price
 * history snapshots, and the ticket SLAs belong to a different domain. Those cards keep their
 * generated figures and carry a `Sample` chip, the same as the Traffic tab's neighbours always did.
 * Mixing a measurement and an invention behind one function is how the old page became untrustworthy
 * in the first place, so the seam is drawn where the data ends rather than where the tab ends.
 *
 * ## Both functions reject rather than resolving empty
 *
 * Each backs a screen whose entire purpose is its figures. Resolving to zeroes on an outage would
 * render a page claiming no listings are mispriced and no review has ever breached, which is a far
 * more expensive lie than an empty tab. The page catches per tab, so one failure does not blank the
 * other seven.
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
