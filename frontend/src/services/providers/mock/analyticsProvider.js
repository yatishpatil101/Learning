/**
 * Mock analytics provider — the localStorage counterpart to `providers/http/analyticsProvider.js`.
 *
 * Computes the same two reports over the seeded database, using the same rules as the server.
 *
 * ## This one genuinely computes, rather than generating
 *
 * The generator it replaces (`lib/data/analytics/pricing.js`, `.../sla.js`) invented its figures
 * from `rng(314159)`. This derives them from the mock listings the rest of the mock app reads and
 * writes, so approving a listing in the mock admin console moves these numbers — which is the whole
 * point of a mock, and was not true before.
 *
 * ## Two honest gaps, reported as gaps
 *
 * **A locality with no approved buy listings reports `avgActualRatePerSqft: null`.** Same rule as
 * the server. The browser version returned the curated market rate here, which made an empty
 * locality render as perfectly priced.
 *
 * **Review turnaround is null in the mock, always.** The server measures it from `audit_log`, which
 * records who changed a listing's status and when. The mock has no audit log and its listings carry
 * no decision timestamp, so the elapsed time between submission and decision is not merely missing —
 * it was never recorded. Returning a plausible number here is exactly the fabrication being retired,
 * and returning `0` would claim instantaneous review. So `avgHoursToReview`, `medianHoursToReview`
 * and `slaRatePct` are null against mocks and the tab renders them as "not recorded".
 *
 * The backlog figures are *not* null: `pendingCount`, `pendingBreachingCount` and `worstPending`
 * come from `createdAt` on listings that are still pending, which the mock does hold. Those are as
 * real here as they are live, so they are reported.
 */
import { rawLoad, delay } from '../../../lib/mockApi/core.js';

/** Matches the server's `targetHours`. Kept in one place so the two do not drift apart silently. */
const REVIEW_TARGET_HOURS = 24;

/** How many waiting listings the server names. Mirrored so the tab renders the same length list. */
const WORST_PENDING_LIMIT = 10;

const rows = (db, key) => (Array.isArray(db?.[key]) ? db[key] : []);

/** Mean of a list, or null when there is nothing to average — never 0. */
const mean = (values) =>
  (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);

/**
 * Approved listings for one locality, matched by slug and falling back to the display name.
 *
 * The seed carries both `localitySlug` and `locality`, and a listing created through the mock admin
 * console sets only one of them depending on which form wrote it. Matching on a single field drops
 * listings that exist, which shows up as a locality that looks empty rather than as an error.
 */
const listingsFor = (listings, loc) =>
  listings.filter(
    (l) =>
      l?.status === 'approved'
      && (l?.localitySlug === loc.slug || l?.locality === loc.name),
  );

export async function localityPricing() {
  await delay();
  const db = rawLoad();
  const listings = rows(db, 'listings');

  return rows(db, 'localities')
    // The server filters `active = true`; so does this, because the report is about localities the
    // platform is actually operating in.
    .filter((loc) => loc?.active !== false)
    .map((loc) => {
      const mine = listingsFor(listings, loc);
      const buys = mine.filter((l) => l?.deal === 'buy');
      const rents = mine.filter((l) => l?.deal === 'rent');

      // Only rows with a usable area can contribute a per-sq-ft figure. Excluded from the average
      // but still counted as supply below, exactly as the server does.
      const priced = (list) =>
        list
          .filter((l) => Number(l?.area) > 0 && Number(l?.price) > 0)
          .map((l) => Number(l.price) / Number(l.area));

      const avgActual = mean(priced(buys));
      const avgRentPsf = mean(priced(rents));
      const marketRate = loc?.ratePerSqft == null ? null : Number(loc.ratePerSqft);

      // Null unless both halves exist. A yield of 0.0 would read as a locality that earns nothing,
      // which is a different claim from "we cannot work this out".
      const rentalYield =
        avgRentPsf != null && marketRate ? ((avgRentPsf * 12) / marketRate) * 100 : null;

      return {
        slug: String(loc?.slug || ''),
        name: String(loc?.name || ''),
        marketRatePerSqft: marketRate,
        avgActualRatePerSqft: avgActual == null ? null : Math.round(avgActual),
        avgRent: loc?.avgRent == null ? null : Number(loc.avgRent),
        rentalYieldPct: rentalYield == null ? null : Math.round(rentalYield * 10) / 10,
        buyCount: buys.length,
        rentCount: rents.length,
        totalListings: mine.length,
        demand: loc?.demand == null ? null : Number(loc.demand),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function reviewSla() {
  await delay();
  const db = rawLoad();
  const listings = rows(db, 'listings');
  const now = Date.now();

  const waiting = listings
    .filter((l) => l?.status === 'pending')
    .map((l) => ({
      id: String(l?.id || ''),
      title: String(l?.title || ''),
      hoursWaiting: Math.round(((now - new Date(l?.createdAt).getTime()) / 3600000) * 10) / 10,
    }))
    // A listing with an unparseable createdAt would sort as NaN and render as NaN. Dropped rather
    // than defaulted, because a default here is a wait time nobody measured.
    .filter((p) => Number.isFinite(p.hoursWaiting))
    .sort((a, b) => b.hoursWaiting - a.hoursWaiting);

  return {
    targetHours: REVIEW_TARGET_HOURS,
    // Counted, because the mock does know which listings were decided...
    reviewedCount: listings.filter((l) => l?.status === 'approved' || l?.status === 'rejected').length,
    // ...but not when, so every figure derived from elapsed time is null. See the module docblock.
    avgHoursToReview: null,
    medianHoursToReview: null,
    // Null, not 0. A breach is "took longer than the target", which needs the same timestamps the
    // averages above are missing — so "how many were late" is unknowable here, and 0 would answer it
    // with the most flattering number available.
    breachedCount: null,
    slaRatePct: null,
    pendingCount: waiting.length,
    pendingBreachingCount: waiting.filter((p) => p.hoursWaiting > REVIEW_TARGET_HOURS).length,
    worstPending: waiting.slice(0, WORST_PENDING_LIMIT),
  };
}
