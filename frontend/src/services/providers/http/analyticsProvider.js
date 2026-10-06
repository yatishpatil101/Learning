/* Analytics distinguishes "not measurable" from zero; averages/rates preserve null while genuine
   counts coerce to 0. */
import { PAGE_LOAD_TTL, get } from '../../http.js';

/* Unparseable values become null so charts show a deliberate gap instead of a misleading NaN gap. */
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
  // Null for unpriced localities so curation gaps render as gaps, not zeroes.
  marketRatePerSqft: num(row?.marketRatePerSqft),
  // Do not fall back to marketRatePerSqft; this endpoint exists to expose that gap.
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

/* Missing tracks render no panel; elapsed-time figures stay nullable because an empty track has no
   average or compliance rate. */
const toTrack = (t) => (t == null ? null : {
  targetHours: num(t.targetHours),
  completedCount: count(t.completedCount),
  avgHours: num(t.avgHours),
  medianHours: num(t.medianHours),
  breachedCount: num(t.breachedCount),
  slaRatePct: num(t.slaRatePct),
  outstandingCount: count(t.outstandingCount),
  // Nullable because an undated backlog cannot honestly answer how many items are late.
  outstandingBreachingCount: num(t.outstandingBreachingCount),
});

export async function reviewSla(opts = {}) {
  const s = await get('/admin/analytics/sla', opts?.days ? { days: opts.days } : undefined);
  return {
    // Server-owned policy; null suppresses the comparison instead of inventing a 0h SLA.
    targetHours: num(s?.targetHours),
    reviewedCount: count(s?.reviewedCount),
    // Null on an empty queue, and it stays null. See the module docblock.
    avgHoursToReview: num(s?.avgHoursToReview),
    medianHoursToReview: num(s?.medianHoursToReview),
    // Breaches depend on elapsed time, so missing turnaround data is unknowable rather than zero.
    breachedCount: num(s?.breachedCount),
    slaRatePct: num(s?.slaRatePct),
    // Present tense and deliberately unwindowed, so these are counts and coerce like counts.
    pendingCount: count(s?.pendingCount),
    pendingBreachingCount: count(s?.pendingBreachingCount),
    // A row whose wait did not parse is dropped, not defaulted. `|| 0` here would render a listing
    // as "0h, on track" at the top of a queue sorted by longest wait.
    worstPending: (Array.isArray(s?.worstPending) ? s.worstPending : [])
      .map((p) => ({
        id: String(p?.id || ''),
        title: String(p?.title || ''),
        hoursWaiting: num(p?.hoursWaiting),
      }))
      .filter((p) => p.hoursWaiting != null),
    // The three turnaround tracks. See `toTrack`.
    ticketPickup: toTrack(s?.ticketPickup),
    ticketDelivery: toTrack(s?.ticketDelivery),
    conciergeToLive: toTrack(s?.conciergeToLive),
  };
}

/* The dashboard is one read; a section the caller may not see stays absent and its tiles hidden, and `revenue30d` stays nullable so redacted revenue is not shown as zero. */
export async function adminDashboard() {
  const d = (await get('/admin/dashboard')) || {};
  const k = d.kpis;
  return {
    ...d,
    kpis: k && {
      totalListings: count(k.totalListings),
      activeListings: count(k.activeListings),
      pendingModeration: count(k.pendingModeration),
      openReports: count(k.openReports),
      totalUsers: count(k.totalUsers),
      newUsers7d: count(k.newUsers7d),
      dealsClosed30d: count(k.dealsClosed30d),
      revenue30d: num(k.revenue30d),
    },
    tickets: d.tickets && { ...d.tickets, latest: (d.tickets.latest || []).map((t) => ({ ...t, desk: t.team })) },
  };
}

/* Totals and five slim rows per queue the caller may read; a section the caller may not read is absent. */
export async function adminBell() {
  const b = (await get('/admin/bell', undefined, { ttl: PAGE_LOAD_TTL })) || {};
  return {
    ...b,
    openTickets: b.openTickets && { ...b.openTickets, items: (b.openTickets.items || []).map((t) => ({ ...t, desk: t.team })) },
  };
}
// Traffic reports are mostly rates, so empty-window percentages/averages stay null while sessions,
// views, signups and exits are counts.

/** Only send `days` when the caller asked for one; the server owns the default. */
const window_ = (opts) => (opts?.days ? { days: opts.days } : undefined);

const toDay = (d) => ({
  date: String(d?.date || ''),
  // Zero-filled server-side: no traffic on a day is a measured zero, not missing data.
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
      // An empty week has no session length or bounce rate; null leaves a chart gap instead of
      // inventing two improvements.
      avgSessionMinutes: num(w?.avgSessionMinutes),
      bounceRatePct: num(w?.bounceRatePct),
    })),
    topPages: (Array.isArray(e?.topPages) ? e.topPages : []).map(toPage),
  };
}

export async function funnel(opts = {}) {
  const f = await get('/admin/analytics/funnel', window_(opts));
  return {
    days: count(f?.days),
    from: String(f?.from || ''),
    to: String(f?.to || ''),
    weeks: (Array.isArray(f?.weeks) ? f.weeks : []).map((w) => ({
      week: String(w?.week || ''),
      posted: count(w?.posted),
      approved: count(w?.approved),
      contacts: count(w?.contacts),
      visits: count(w?.visits),
      deals: count(w?.deals),
    })),
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
    // Numbers, not `.toFixed()` strings. The KPI tiles beside these call
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
