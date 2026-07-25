/* Unified entity search — the single typed-token resolver behind the homepage hero
   (and, later, the Listings top bar). Given a query it returns locality / society /
   landmark tokens, each tagged with a live-listing `count`. Societies and landmarks
   are GATED to count > 0 (using the exact same match math the Listings filters use:
   `societyForListing` and per-listing coords) so a suggestion can never dead-end.
   Localities always appear (registry-backed). Google's long-tail is layered on by the
   caller; this module is pure/synchronous and dependency-light so it's easy to test. */
import { allLocalities, localityBySlug, nearestLocality } from '../data/localities.js';
import { allSocieties, societyForListing } from '../data/societies.js';
import { LANDMARKS } from '../pages/consumer/listings/constants.js';
import { propLatLng } from '../pages/consumer/listings/geo.js';
import { nearToParams } from './nearParams.js';

// Default proximity for a landmark match — mirrors the Listings near-filter default.
export const LANDMARK_RADIUS_KM = 5;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Precompute live-listing counts per locality / society / landmark from the listing
// set the caller considers "in play" (typically approved stock for the current deal).
// Building this once and reusing it across keystrokes keeps typing cheap.
export function buildEntityIndex(listings) {
  const arr = Array.isArray(listings) ? listings : [];
  const locCount = new Map();
  const socCount = new Map();
  for (const p of arr) {
    if (p && p.localitySlug) locCount.set(p.localitySlug, (locCount.get(p.localitySlug) || 0) + 1);
    const soc = societyForListing(p);
    if (soc) socCount.set(soc.slug, (socCount.get(soc.slug) || 0) + 1);
  }
  const lmCount = new Map();
  for (const lm of LANDMARKS) {
    if (!lm.value) continue;
    const [la, lo] = lm.value.split(',').map(Number);
    let n = 0;
    for (const p of arr) {
      const [pa, po] = propLatLng(p);
      if (haversineKm(la, lo, pa, po) <= LANDMARK_RADIUS_KM) n += 1;
    }
    lmCount.set(lm.value, n);
  }
  return { locCount, socCount, lmCount, size: arr.length };
}

const socSublabel = (s) => {
  const loc = s.localitySlug ? localityBySlug(s.localitySlug) : null;
  return loc ? `Society · ${loc.name}` : 'Society';
};

// Resolve a typed query into ordered, typed tokens:
//   { kind: 'locality'|'society'|'landmark', id, label, sublabel, count, slug?/value? }
// Localities are always offered; societies/landmarks only when they have live stock.
export function searchEntities(query, index, { limit = 8, perKind = 4 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const locCount = index?.locCount;
  const socCount = index?.socCount;
  const lmCount = index?.lmCount;
  const byCount = (a, b) => b.count - a.count || a.label.localeCompare(b.label);

  const localities = allLocalities()
    .filter((l) => l.name.toLowerCase().includes(q))
    .map((l) => ({ kind: 'locality', id: l.slug, slug: l.slug, label: l.name, sublabel: 'Locality', count: locCount?.get(l.slug) || 0 }))
    .sort(byCount)
    .slice(0, perKind);

  const societies = allSocieties()
    .filter((s) => s.name.toLowerCase().includes(q) && (socCount?.get(s.slug) || 0) > 0)
    .map((s) => ({ kind: 'society', id: s.slug, slug: s.slug, label: s.name, sublabel: socSublabel(s), count: socCount.get(s.slug), loc: s.localitySlug || null }))
    .sort(byCount)
    .slice(0, perKind);

  const landmarks = LANDMARKS
    .filter((l) => l.value && l.label.toLowerCase().includes(q) && (lmCount?.get(l.value) || 0) > 0)
    .map((l) => {
      const [la, lo] = l.value.split(',').map(Number);
      // Attach the confident parent locality (tight radius) so a landmark pick also
      // scopes results to a real area — not just a proximity radius.
      const parent = nearestLocality(la, lo, 3);
      return { kind: 'landmark', id: l.value, value: l.value, label: l.label, sublabel: l.group || 'Landmark', count: lmCount.get(l.value), loc: parent ? parent.slug : null };
    })
    .sort(byCount)
    .slice(0, perKind);

  return [...localities, ...societies, ...landmarks].slice(0, limit);
}

// Fold chosen tokens into the Listings URL contract. Localities and societies are
// multi-valued (CSV); landmark/place proximity is single-valued (last pick wins),
// matching the Listings `near` filter which holds one point. A society ALSO
// contributes its verified parent locality (`t.loc`) to the locality CSV — a
// society genuinely sits inside its slug, so scoping to that slug is always correct
// and can never dead-end. Landmarks/places DELIBERATELY do NOT emit a locality:
// they are scoped by their proximity radius alone (same as the Listings Near-a-Place
// filter). Emitting a parent slug here ANDs with `near` and dead-ends a gated
// landmark whose slug holds no stock while nearby slugs do — the exact QA bug this
// fixes. This keeps the gate (proximity count) and the emission (proximity-only) in
// lockstep.
export function paramsFromTokens(tokens) {
  const loc = [];
  const soc = [];
  let near = '';
  let nearLabel = '';
  const addLoc = (slug) => { if (slug && !loc.includes(slug)) loc.push(slug); };
  for (const t of tokens || []) {
    if (t.kind === 'locality') addLoc(t.slug);
    else if (t.kind === 'society') { soc.push(t.slug); addLoc(t.loc); }
    else if (t.kind === 'landmark') { near = t.value; nearLabel = t.label || ''; }
    // A Google-resolved place that didn't snap to a known locality routes as a
    // proximity search (nearest listings) — single-valued, last pick wins. Like a
    // landmark, it is scoped by radius only, never by a parent slug.
    else if (t.kind === 'place' && t.near) { near = t.near; nearLabel = t.nearLabel || t.label || ''; }
  }
  const p = {};
  if (loc.length) p.loc = loc.join(',');
  if (soc.length) p.soc = soc.join(',');
  Object.assign(p, nearToParams({ near, nearLabel }));
  return p;
}

// Icon name per entity kind (lucide) — shared by the hero chips + suggestion rows.
export const KIND_ICON = { locality: 'map-pin', society: 'building-2', landmark: 'flag', place: 'map-pin' };
