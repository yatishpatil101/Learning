/**
 * Mock analytics provider — the localStorage counterpart to `providers/http/analyticsProvider.js`.
 *
 * Computes the same reports over the seeded database, using the same rules as the server — and
 * reports an empty window for the three that read page views, which mock mode does not store.
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
 * **Turnaround is null in the mock, always — for listings, tickets and the concierge pipeline.** The
 * server measures it from `audit_log`, which records who changed a listing's status or a ticket's
 * owner, and when. The mock has no audit log and its rows carry only a creation date, so the elapsed
 * time between arrival and decision is not merely missing — it was never recorded. Returning a
 * plausible number here is exactly the fabrication being retired, and returning `0` would claim
 * instantaneous service. So every average, median, breach count and compliance rate is null against
 * mocks and the tab renders them as "not recorded".
 *
 * The counts and the backlog figures are *not* null. `pendingCount`, `pendingBreachingCount`,
 * `worstPending` and each track's `outstandingCount` come from `createdAt` on work that is still
 * open, which the mock does hold. Those are as real here as they are live, so they are reported.
 */
import { rawLoad, delay } from '../../../lib/mockApi/core.js';

/** Matches the server's `targetHours`. Kept in one place so the two do not drift apart silently. */
const REVIEW_TARGET_HOURS = 24;

/**
 * The other three targets, mirroring `AdminSlaService`.
 *
 * Duplicated rather than fetched for the same reason `REVIEW_TARGET_HOURS` is: a mock that asked the
 * server for its policy would not be a mock. They are named together so a change on either side is
 * an obvious two-line diff instead of a silent disagreement between two consoles.
 */
const PICKUP_TARGET_HOURS = 4;
const DELIVERY_TARGET_HOURS = 72;
const CONCIERGE_TARGET_HOURS = 168;

/** How many waiting listings the server names. Mirrored so the tab renders the same length list. */
const WORST_PENDING_LIMIT = 10;

/** Mock ticket statuses that mean "still on somebody's desk". `cancelled` is finished, not open. */
const TICKET_UNRESOLVED = new Set(['new', 'in_progress']);

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
    ...ticketTracks(rows(db, 'tickets'), now),
    conciergeToLive: conciergeTrack(listings, now),
  };
}

/**
 * Hours between a seeded date and now, or null when the date will not parse.
 *
 * Null rather than 0, because a row with an unreadable timestamp has an unknown age and 0 would put
 * it at the fresh end of every backlog comparison — the end where nothing needs attention.
 */
const ageHours = (value, now) => {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? (now - t) / 3600000 : null;
};

/**
 * Ticket pickup and delivery, counted over the seeded tickets.
 *
 * **The counts are real and the turnarounds are null**, which is the same split the review fields
 * above make and for the same reason. A seeded ticket records who owns it and what state it is in,
 * so "picked up at some point" and "delivered" are both countable — but it records only one date,
 * `createdAt`, so *when* either happened was never written down. The server reads those instants
 * from `audit_log`; the mock has no audit log, so every average, median, breach count and compliance
 * rate here is null and the tab prints "not recorded". A `0` would report a desk that answers every
 * request the instant it arrives and never misses.
 *
 * `outstandingBreachingCount` is the exception that survives, because a backlog item's age is
 * measured from `createdAt` forwards and that is the one timestamp the mock does hold.
 */
function ticketTracks(tickets, now) {
  const open = tickets.filter((t) => TICKET_UNRESOLVED.has(t?.status));
  const unassigned = open.filter((t) => !t?.assignedTo);
  const breaching = (list, target) =>
    list.filter((t) => {
      const age = ageHours(t?.createdAt, now);
      return age != null && age > target;
    }).length;

  return {
    ticketPickup: {
      targetHours: PICKUP_TARGET_HOURS,
      // Assigned at all, whatever its state — an owner is the evidence somebody picked it up, and a
      // cancelled ticket that was worked before it was dropped was still answered.
      completedCount: tickets.filter((t) => t?.assignedTo).length,
      avgHours: null,
      medianHours: null,
      breachedCount: null,
      slaRatePct: null,
      outstandingCount: unassigned.length,
      outstandingBreachingCount: breaching(unassigned, PICKUP_TARGET_HOURS),
    },
    ticketDelivery: {
      targetHours: DELIVERY_TARGET_HOURS,
      // `done` only. A cancelled request was not delivered, and counting it would let a desk clear
      // its SLA by closing tickets rather than by doing them.
      completedCount: tickets.filter((t) => t?.status === 'done').length,
      avgHours: null,
      medianHours: null,
      breachedCount: null,
      slaRatePct: null,
      outstandingCount: open.length,
      outstandingBreachingCount: breaching(open, DELIVERY_TARGET_HOURS),
    },
  };
}

/**
 * The concierge pipeline — staff-posted listings on their way to live.
 *
 * Same shape as the ticket tracks and the same honest gap: the mock knows which listings were posted
 * on an owner's behalf and which of those are approved, but not when either happened, so the counts
 * are real and the turnarounds are null.
 *
 * Outstanding is `pending` alone, not "anything not approved", so a correctly rejected concierge
 * listing does not sit in the backlog for ever. That mirrors the server, and it matters: the reading
 * it prevents is a pipeline whose queue grows every time the desk does its job.
 */
function conciergeTrack(listings, now) {
  const concierge = listings.filter((l) => l?.postedByAdmin);
  const pending = concierge.filter((l) => l?.status === 'pending');
  return {
    targetHours: CONCIERGE_TARGET_HOURS,
    completedCount: concierge.filter((l) => l?.status === 'approved').length,
    avgHours: null,
    medianHours: null,
    breachedCount: null,
    slaRatePct: null,
    outstandingCount: pending.length,
    outstandingBreachingCount: pending.filter((l) => {
      const age = ageHours(l?.createdAt, now);
      return age != null && age > CONCIERGE_TARGET_HOURS;
    }).length,
  };
}

/**
 * The ops scorecard — the counterpart to the server's `GET /admin/dashboard` (`AdminKpis`).
 *
 * Every figure is counted over the seeded database, so approving a listing or closing a deal in the
 * mock console moves the tile, exactly as it would live. Nothing here is generated: this is the
 * function `lib/mockApi/staff.js`'s deleted `getAdminKpis()` should have been, in the one place a
 * mock belongs.
 *
 * ## Where the two shapes do not line up
 *
 * `staff.js` records that the browser's nine counters and the server's eight overlap only partly,
 * and that the mismatch is why the port was a decision rather than a swap. Three fields needed a
 * ruling here:
 *
 * **`newUsers7d` and `dealsClosed30d` are windowed against the real clock**, while the seed's
 * `joinedAt` and `at` are fixed calendar dates written when the fixture was authored. Both will
 * therefore usually read 0, and that is the honest answer — nobody *did* sign up in the last seven
 * days of a database that has not moved. Widening the window to make the demo livelier would be
 * inventing activity, which is the thing this provider exists to stop.
 *
 * **`revenue30d` is served, not nulled.** The seed carries `analytics.revenue` as monthly buckets,
 * so the most recent bucket is a real sum over real rows — unlike SLA turnaround above, which is
 * null because the elapsed time was never recorded anywhere. The approximation is the window, not
 * the number: a calendar month standing in for a rolling 30 days. That is close enough to be
 * useful and far from a fabrication.
 *
 * The access control has no counterpart here. Live, `revenue30d` is null for staff; mock mode has no
 * server to withhold it, so the tile shows for whoever is signed in. The rule being demonstrated is
 * the server's, and it is tested against the server.
 */
export async function dashboardKpis() {
  const db = rawLoad();
  const listings = rows(db, 'listings');
  const users = rows(db, 'users');
  const deals = rows(db, 'deals');
  const reports = rows(db, 'reports');

  const now = Date.now();
  const within = (value, days) => {
    const t = new Date(value).getTime();
    return Number.isFinite(t) && now - t <= days * 24 * 60 * 60 * 1000;
  };

  const revenue = rows(db?.analytics, 'revenue');
  const latest = revenue[revenue.length - 1];

  return delay({
    totalListings: listings.length,
    activeListings: listings.filter((l) => l.status === 'approved').length,
    pendingModeration: listings.filter((l) => l.status === 'pending').length,
    // `open` and `reviewing` both count as awaiting a decision — the server's rule, mirrored so the
    // queue tile means the same thing on both sides of the seam.
    openReports: reports.filter((r) => r.status === 'open' || r.status === 'reviewing').length,
    // Staff and admin accounts are not platform users; the directory tile counts the public.
    totalUsers: users.filter((u) => u.role === 'buyer' || u.role === 'owner').length,
    newUsers7d: users.filter((u) => within(u.joinedAt, 7)).length,
    dealsClosed30d: deals.filter((d) => d.status === 'closed' && within(d.at, 30)).length,
    revenue30d: latest
      ? (Number(latest.subscriptions) || 0) + (Number(latest.services) || 0) + (Number(latest.featured) || 0)
      : null,
  });
}

// ─── Page-view reports ───────────────────────────────────────────────────────────────────────────
//
// ## All three report an empty window, always, and that is the correct answer
//
// These read the server's daily rollup of `page_views`. Mock mode has no such table and never will:
// `providers/mock/pageViewProvider.js` accepts each flush and drops it on purpose, because a
// per-session log of every page one person visited is the most identifying artefact this feature
// produces, and mock mode is the mode that runs on demo laptops and in the e2e suite.
//
// So the honest report is an empty one. This is the same call `reviewSla` above makes about
// turnaround — the mock has no audit log, so the elapsed time is null rather than plausible — one
// report further along. Generating figures here would put back exactly what the live endpoints were
// written to remove, in the one environment where nobody would think to check.
//
// The tabs render an empty window as "No page views recorded in this window", a sentence that is
// true in both modes: in mock mode nothing is collected, and live, an empty window means nobody
// visited. One state, one message, no mode-specific branch in the UI and no discriminator field
// leaking into the contract to carry one.
//
// The beacon still runs identically in mock mode, which is what keeps the *collection* path
// exercised rather than dead everywhere that is not production.

/** Mirrors the server's default so the tab's "Last N days" label is right before any picker moves. */
const DEFAULT_DAYS = 90;

/**
 * The window the server would have chosen, as ISO dates.
 *
 * Half-open `[from, to)` like the server's, so `to` is tomorrow and today is included — a report
 * that excluded the current day would show a blank right edge for the whole of every day.
 */
const emptyWindow = (opts) => {
  const days = Number(opts?.days) > 0 ? Math.floor(Number(opts.days)) : DEFAULT_DAYS;
  const to = new Date();
  to.setDate(to.getDate() + 1);
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { days, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

export async function traffic(opts = {}) {
  await delay();
  return {
    ...emptyWindow(opts),
    // Empty rather than zero-filled. A zero-filled series draws a flat line along the axis, which
    // says "measured, and nobody came" — a measurement mock mode did not take. Empty draws nothing
    // and the tab says so in words.
    series: [],
    sources: [],
    devices: { mobile: 0, tablet: 0, desktop: 0 },
    identity: [],
  };
}

export async function engagement(opts = {}) {
  await delay();
  return { ...emptyWindow(opts), weeks: [], topPages: [] };
}

export async function surfers(opts = {}) {
  await delay();
  return {
    ...emptyWindow(opts),
    totalSessions: 0,
    anonSessions: 0,
    signedInSessions: 0,
    signups: 0,
    // Null, not 0, and for the same reason `slaRatePct` above is. 0% anonymous would claim every
    // visitor signed in and 0% conversion would report a failure that never happened; both are
    // assertions about an audience nobody counted.
    anonSharePct: null,
    conversionRatePct: null,
    weeks: [],
    pages: [],
    dropOff: [],
  };
}
