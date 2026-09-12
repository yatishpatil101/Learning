/**
 * HTTP analytics provider.
 *
 * `GET /admin/analytics/pricing`, `GET /admin/analytics/sla` and `GET /admin/dashboard`, all
 * staff/admin.
 *
 * Verified against `admin/PricingInsightRow.java`, `admin/SlaSummary.java` and `admin/AdminKpis.java`.
 *
 * ## Why almost nothing here coerces
 *
 * The sibling demand provider runs every field through `Number(v) || 0`, and it is right to: every
 * figure on a supply-gap row is a `count(*)`, so zero is a measurement and a missing key is a bug
 * worth flattening. Here the opposite holds. Most of these fields are averages over a set that can
 * legitimately be empty, and the server sends an explicit `null` to say so — `|| 0` would convert
 * "we could not measure this" into "we measured this and it was nothing", reinstating the fallback
 * the endpoints were built to remove.
 *
 * So `num` preserves null and only the genuine counts are coerced. The distinction is the contract.
 */
import { get } from '../../http.js';

/**
 * A nullable server number, kept nullable.
 *
 * `null` and `undefined` both become `null`; anything unparseable becomes `null` too, because a
 * `NaN` reaching a chart renders as a gap that looks identical to a deliberate one and is not.
 */
const num = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A count the server always sends, where 0 is a measurement rather than an absence. */
const count = (v) => Number(v) || 0;

const toPricingRow = (row) => ({
  slug: String(row?.slug || ''),
  name: String(row?.name || ''),
  // Curated reference data, not inferred from listings. Null for a locality nobody has priced yet,
  // which is a gap in curation and worth rendering as one.
  marketRatePerSqft: num(row?.marketRatePerSqft),
  // Null when the locality has no approved buy listings with a usable area. Never fall back to
  // marketRatePerSqft: that is the bug this endpoint exists to remove, and doing it here would put
  // it back one layer further from where anyone would look for it.
  avgActualRatePerSqft: num(row?.avgActualRatePerSqft),
  avgRent: num(row?.avgRent),
  rentalYieldPct: num(row?.rentalYieldPct),
  buyCount: count(row?.buyCount),
  rentCount: count(row?.rentCount),
  totalListings: count(row?.totalListings),
  demand: num(row?.demand),
});

/** Ordered by locality name by the server; the order is not re-derived here. */
export async function localityPricing() {
  const rows = await get('/admin/analytics/pricing');
  return (Array.isArray(rows) ? rows : []).map(toPricingRow);
}

/**
 * One turnaround track — ticket pickup, service delivery or the concierge pipeline.
 *
 * Returns null when the key is absent rather than an object of nulls, so a server that predates the
 * field renders no panel at all instead of a panel of dashes claiming to have measured nothing. The
 * tab keys on exactly that: `<Track track={null}>` renders nothing.
 *
 * Inside a track the same split as the review fields above applies. `targetHours` is policy and the
 * two counts are counts, but every figure derived from elapsed time — the averages, the breach
 * count, the rate — stays nullable, because a track with nothing completed has no average and no
 * compliance rate, and `|| 0` would render that as instantaneous service at 0%.
 */
const toTrack = (t) => (t == null ? null : {
  targetHours: num(t.targetHours),
  completedCount: count(t.completedCount),
  avgHours: num(t.avgHours),
  medianHours: num(t.medianHours),
  breachedCount: num(t.breachedCount),
  slaRatePct: num(t.slaRatePct),
  outstandingCount: count(t.outstandingCount),
  // Nullable, unlike the count beside it: a backlog item's age is known, so this is normally a
  // number — but a provider that cannot date its work (the mock) must be able to say "how many are
  // late is unknowable" rather than answer 0, which is the most flattering figure available.
  outstandingBreachingCount: num(t.outstandingBreachingCount),
});

export async function reviewSla(opts = {}) {
  const s = await get('/admin/analytics/sla', opts?.days ? { days: opts.days } : undefined);
  return {
    // Served rather than hardcoded so "breached" means the same thing on the server that computed
    // it and on the screen that colours it red. Not coerced with `|| 0`: `get` answers null for a
    // 204 and for a malformed payload, and a targetHours of 0 is not a policy anyone could set — it
    // would render "Within 0h target" and stamp every pending listing overdue. Null is the honest
    // reading and the tab suppresses the comparison rather than losing one.
    targetHours: num(s?.targetHours),
    reviewedCount: count(s?.reviewedCount),
    // Null on an empty queue, and it stays null. See the module docblock.
    avgHoursToReview: num(s?.avgHoursToReview),
    medianHoursToReview: num(s?.medianHoursToReview),
    // A breach is itself derived from elapsed time. Where no turnaround was recorded the number
    // that exceeded the target is unknowable, not zero, so this coerces like the averages beside it
    // rather than like the counts below it.
    breachedCount: num(s?.breachedCount),
    slaRatePct: num(s?.slaRatePct),
    // Present tense and deliberately unwindowed, so these are counts and coerce like counts.
    pendingCount: count(s?.pendingCount),
    pendingBreachingCount: count(s?.pendingBreachingCount),
    // A row whose wait did not parse is dropped, not defaulted — mirroring the mock provider. `|| 0`
    // here would render a listing as "0h, on track" at the top of a queue sorted by longest wait.
    worstPending: (Array.isArray(s?.worstPending) ? s.worstPending : [])
      .map((p) => ({
        id: String(p?.id || ''),
        title: String(p?.title || ''),
        hoursWaiting: num(p?.hoursWaiting),
      }))
      .filter((p) => p.hoursWaiting != null),
    // The three tracks the seeded generator used to draw. See `toTrack`.
    ticketPickup: toTrack(s?.ticketPickup),
    ticketDelivery: toTrack(s?.ticketDelivery),
    conciergeToLive: toTrack(s?.conciergeToLive),
  };
}

/**
 * The ops scorecard — `GET /admin/dashboard`, contract schema `AdminKpis`.
 *
 * It lives in the analytics domain rather than one of its own because it is the third read on
 * `AdminMetricsController`, beside the two above; a domain per route would split one controller
 * across two seams and buy nothing.
 *
 * ## Why this exists at all, when the dashboard already fetches collections
 *
 * Every field here is a `count(*)` over the whole catalogue. The screen's tiles used to be derived
 * in the browser from lists it had fetched for other reasons, and those lists are **paged** — the
 * enquiry board caps at 100 (`unwrapFullPage`), `/users` and `/tickets` at 20. So "Total Users"
 * counted a page while reading as a fact about the platform. That is the same defect the listings
 * console fixed by having the server send `total` alongside `items`, and it is fixed the same way.
 *
 * ## The one field that is not a count
 *
 * **`revenue30d` must stay nullable.** The server withholds revenue from a `staff` caller by sending
 * `null` (`AdminKpis` javadoc, spec fix S61). Running it through `count` would render "₹0" to that
 * caller — not a redaction but a false figure, and one the finance console would contradict the
 * moment an admin opened it. Null is the caller's signal to omit the tile, which is what it does.
 *
 * That javadoc explains the nullability by saying "the dashboard is staff-visible but
 * `/admin/finance` is admin-only". The first half is **not true of the console today**: the admin
 * shell refuses `staff` accounts outright (`e2e/tests/admin/live-rbac.spec.js` — "an operations
 * account cannot open the admin console at all"), so no staffer can reach the screen that calls
 * this. The route genuinely does answer a staff token — `@PreAuthorize` is `STAFF_OR_ADMIN` — so
 * the nullability is real and worth honouring; it is simply defence in depth rather than a case a
 * user can currently reach. Keep it: the day a read-only ops console exists, the tile must already
 * be absent rather than reading zero.
 */
export async function dashboardKpis() {
  const k = await get('/admin/dashboard');
  return {
    totalListings: count(k?.totalListings),
    activeListings: count(k?.activeListings),
    pendingModeration: count(k?.pendingModeration),
    openReports: count(k?.openReports),
    totalUsers: count(k?.totalUsers),
    newUsers7d: count(k?.newUsers7d),
    dealsClosed30d: count(k?.dealsClosed30d),
    revenue30d: num(k?.revenue30d),
  };
}

// ─── Page-view reports ───────────────────────────────────────────────────────────────────────────
//
// Verified against `admin/AdminAnalyticsTraffic.java`, `AdminAnalyticsEngagement.java` and
// `AdminAnalyticsSurfers.java`. The same split applies as above and matters more here, because
// these three reports are almost entirely rates: every `*Pct`, every average and every share is
// null on an empty window, and every session, view, signup and exit is a count.

/** Only send `days` when the caller asked for one; the server owns the default. */
const window_ = (opts) => (opts?.days ? { days: opts.days } : undefined);

const toDay = (d) => ({
  date: String(d?.date || ''),
  // Zero-filled server-side, so these are always present and always counts. A day with no traffic
  // is a measurement of nothing, not an absence of measurement — the distinction the nullable
  // fields elsewhere in this file exist to preserve, landing on the other side of the line.
  sessions: count(d?.sessions),
  pageviews: count(d?.pageviews),
  signups: count(d?.signups),
});

const toPage = (p) => ({
  path: String(p?.path || ''),
  views: count(p?.views),
  anonViews: count(p?.anonViews),
});

export async function traffic(opts = {}) {
  const t = await get('/admin/analytics/traffic', window_(opts));
  return {
    days: count(t?.days),
    from: String(t?.from || ''),
    to: String(t?.to || ''),
    series: (Array.isArray(t?.series) ? t.series : []).map(toDay),
    sources: (Array.isArray(t?.sources) ? t.sources : []).map((s) => ({
      channel: String(s?.channel || ''),
      sessions: count(s?.sessions),
      // Null when the window had no sessions at all. Not 0: a doughnut of five 0% slices renders as
      // an empty ring identical to a failed load, and the tab distinguishes those two states.
      sharePct: num(s?.sharePct),
    })),
    devices: {
      mobile: count(t?.devices?.mobile),
      tablet: count(t?.devices?.tablet),
      desktop: count(t?.devices?.desktop),
    },
    identity: (Array.isArray(t?.identity) ? t.identity : []).map((w) => ({
      week: String(w?.week || ''),
      anonymous: count(w?.anonymous),
      signedIn: count(w?.signedIn),
    })),
  };
}

export async function engagement(opts = {}) {
  const e = await get('/admin/analytics/engagement', window_(opts));
  return {
    days: count(e?.days),
    from: String(e?.from || ''),
    to: String(e?.to || ''),
    weeks: (Array.isArray(e?.weeks) ? e.weeks : []).map((w) => ({
      week: String(w?.week || ''),
      sessions: count(w?.sessions),
      // A week nobody visited has no session length and no bounce rate. `|| 0` would draw both
      // lines down to the axis, which reads as "sessions got shorter and everybody stayed" — two
      // improvements invented out of an empty week. Chart.js renders null as a gap, correctly.
      avgSessionMinutes: num(w?.avgSessionMinutes),
      bounceRatePct: num(w?.bounceRatePct),
    })),
    topPages: (Array.isArray(e?.topPages) ? e.topPages : []).map(toPage),
  };
}

export async function surfers(opts = {}) {
  const s = await get('/admin/analytics/surfers', window_(opts));
  return {
    days: count(s?.days),
    from: String(s?.from || ''),
    to: String(s?.to || ''),
    totalSessions: count(s?.totalSessions),
    anonSessions: count(s?.anonSessions),
    signedInSessions: count(s?.signedInSessions),
    signups: count(s?.signups),
    // Numbers, not the `.toFixed()` strings the generator returned. The KPI tiles beside these call
    // `.toLocaleString('en-IN')` on their values, which a string does not have.
    anonSharePct: num(s?.anonSharePct),
    conversionRatePct: num(s?.conversionRatePct),
    weeks: (Array.isArray(s?.weeks) ? s.weeks : []).map((w) => ({
      week: String(w?.week || ''),
      anonymous: count(w?.anonymous),
      signedIn: count(w?.signedIn),
    })),
    pages: (Array.isArray(s?.pages) ? s.pages : []).map(toPage),
    dropOff: (Array.isArray(s?.dropOff) ? s.dropOff : []).map((d) => ({
      path: String(d?.path || ''),
      exits: count(d?.exits),
      // Share of the exits *shown*, not of all exits — the list is capped server-side.
      sharePct: num(d?.sharePct),
    })),
  };
}
