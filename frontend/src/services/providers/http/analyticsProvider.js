/**
 * HTTP analytics provider — the live counterpart to `providers/mock/analyticsProvider.js`.
 *
 * `GET /admin/analytics/pricing` and `GET /admin/analytics/sla`, both staff/admin.
 *
 * Verified against `admin/PricingInsightRow.java` and `admin/SlaSummary.java`.
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
