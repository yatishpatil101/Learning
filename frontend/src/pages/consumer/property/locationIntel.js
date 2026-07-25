// Pure, deterministic helpers for the property Location tab. No backend.
import { LOC, IT_HUBS } from '../../../data/localityIntel.js';
import { getCommute } from '../../../lib/commuteCache.js';

// Internal helper for locality name normalization
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Resolve a listing's locality (slug or name) to the rich LOC entry, if we have one.
export function localityFor(p) {
  if (!p) return null;
  const want = slugify(p.localitySlug || p.locality);
  if (!want) return null;
  for (const name of Object.keys(LOC)) {
    if (slugify(name) === want) return { name, ...LOC[name] };
  }
  return null;
}

// Typical Pune 2BHK carpet area — used only to convert the curated locality
// 2BHK rent benchmark (rent2) into a per-sq.ft figure so rent value-ratings
// compare like with like.
const TYPICAL_2BHK_SQFT = 950;

/* Honest fair-value benchmark for the Price / Rent Insights tabs.
   Compares this listing's ₹/sq.ft against the CURATED locality average
   (buy: LOC.price, rent: LOC.rent2 → per-sq.ft), instead of a number pinned a
   fixed % above the listing (which always flattered it as a "good deal").
   Only residential listings in a known locality get a benchmark — a residential
   ₹/sq.ft is not a fair yardstick for a plot or an office, and we never
   fabricate an average we don't have. `hasData` tells the UI whether to show
   the comparison or a neutral "benchmark unavailable" state. */
export function valueBenchmark(p) {
  const isRent = p?.deal === 'rent';
  const perSqft = (p?.area > 0) ? Math.round((p.price || 0) / p.area) : 0;
  const loc = localityFor(p);
  const kind = String(p?.type || '').toLowerCase();
  const isResidential = !/plot|land|farm|office|shop|showroom|retail|mall|warehouse|godown|industrial|factory|co-?work|commercial/.test(kind);
  const localityAvg = loc
    ? (isRent ? Math.round((loc.rent2 || 0) / TYPICAL_2BHK_SQFT) : (loc.price || 0))
    : 0;
  const hasData = !!(loc && localityAvg && isResidential && perSqft);
  if (!hasData) {
    return { perSqft, localityAvg: 0, diffPct: 0, rating: '', tone: 'fair', arrow: 'minus', pct: 60, hasData: false, yoy: loc?.yoy || 0 };
  }
  const diffPct = localityAvg ? Math.round(((perSqft - localityAvg) / localityAvg) * 100) : 0;
  let rating; let tone; let arrow;
  if (diffPct <= -4) { rating = isRent ? 'Below market rent' : 'Good deal'; tone = 'good'; arrow = 'arrow-down'; }
  else if (diffPct >= 5) { rating = isRent ? 'Above market rent' : 'Above average'; tone = 'high'; arrow = 'arrow-up'; }
  else { rating = isRent ? 'Fair rent' : 'At market'; tone = 'fair'; arrow = 'minus'; }
  // Bar fill proportional to property vs locality, clamped for display.
  const pct = Math.min(95, Math.max(20, Math.round((perSqft / localityAvg) * 55)));
  return { perSqft, localityAvg, diffPct, rating, tone, arrow, pct, hasData: true, yoy: loc.yoy || 0 };
}

const toRad = (d) => (d * Math.PI) / 180;
export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Free-flow by-road estimate (fallback): road factor 1.35 over crow-flight;
// ~24 km/h effective city speed. Used only when the live cache has no coords.
function commuteEstimate(lat, lng) {
  return IT_HUBS.map((h) => {
    const km = haversineKm(lat, lng, h.lat, h.lng);
    const roadKm = km * 1.35;
    return { name: h.name, km: +roadKm.toFixed(1), min: Math.max(4, Math.round((roadKm / 24) * 60)) };
  }).sort((a, b) => a.min - b.min);
}

// Commute to Pune's major employment hubs. Prefers the cache-at-write "live"
// (traffic-aware) commute the backend would provide; falls back to the free-flow
// estimate. Returns { legs:[{name,min,km}], source:'live'|'estimate'|'none', fetchedAt }.
export function commuteInfo(lat, lng) {
  if (lat == null || lng == null) return { legs: [], source: 'none', fetchedAt: 0 };
  const cached = getCommute(lat, lng);
  if (cached && cached.hubs && cached.hubs.length) {
    return { legs: cached.hubs, source: 'live', fetchedAt: cached.fetchedAt };
  }
  return { legs: commuteEstimate(lat, lng), source: 'estimate', fetchedAt: 0 };
}

// Back-compat: existing callers that only need the legs array.
export function commuteToHubs(lat, lng) { return commuteInfo(lat, lng).legs; }

// Category label + accent for a landmark, keyed by its lucide icon name.
const CAT = {
  cpu: 'IT & Work', 'train-front': 'Transit', plane: 'Transit', milestone: 'Connectivity',
  'shopping-bag': 'Shopping', 'graduation-cap': 'Education', building: 'Landmark', 'building-2': 'Landmark',
  trees: 'Leisure', waves: 'Leisure', dumbbell: 'Leisure', 'map-pin': 'Nearby',
};

// Nearby landmarks (real Pune places) with icon, distance and a category tag.
export function connectivityFor(p) {
  const loc = localityFor(p);
  if (!loc || !loc.conn) return [];
  return loc.conn.map(([name, icon, dist]) => ({ name, icon, dist, cat: CAT[icon] || 'Nearby' }));
}

const LABEL = (v) => (v >= 8.5 ? 'Excellent' : v >= 8 ? 'Very Good' : v >= 7.5 ? 'Good' : 'Average');

// Livability breakdown + overall score for the property's locality.
export function livabilityFor(p) {
  const loc = localityFor(p);
  if (!loc || !loc.subs) return null;
  const bars = Object.keys(loc.subs).map((k) => ({ label: k, value: loc.subs[k] }));
  const score = +(bars.reduce((s, b) => s + b.value, 0) / bars.length).toFixed(1);
  return { name: loc.name, bars, score, scoreLabel: LABEL(score), demand: loc.demand };
}
