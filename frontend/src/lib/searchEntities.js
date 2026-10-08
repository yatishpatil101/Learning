/* Typed-token resolver behind the hero search: locality, society and landmark tokens each carry a live-listing `count` and are
   gated to count > 0 so a suggestion never dead-ends. Pure and synchronous; the caller layers Google's long tail on top. */
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

// Prefers the slug a listing already carries for this name; slugifies (as the server does) only when none is known, e.g. the editorial "popular" chips.
export const slugOfName = (name, index) => {
  const lower = String(name || '').trim().toLowerCase();
  for (const [slug, known] of index?.locNames || []) if (known.toLowerCase() === lower) return slug;
  return lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
};

// Precomputes live-listing counts per locality / society / landmark once per "in play" listing set, so keystrokes stay cheap.
export function buildEntityIndex(listings, societies = []) {
  const arr = Array.isArray(listings) ? listings : [];
  const locCount = new Map();
  const locNames = new Map();
  const socCount = new Map();
  for (const p of arr) {
    if (p && p.localitySlug) {
      locCount.set(p.localitySlug, (locCount.get(p.localitySlug) || 0) + 1);
      if (p.locality && !locNames.has(p.localitySlug)) locNames.set(p.localitySlug, p.locality);
    }
    if (p?.societySlug) socCount.set(p.societySlug, (socCount.get(p.societySlug) || 0) + 1);
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
  return { locCount, locNames, socCount, lmCount, societies, size: arr.length };
}

const socSublabel = (s, index) => {
  const name = s.localitySlug ? index?.locNames?.get(s.localitySlug) : null;
  return name ? `Society · ${name}` : 'Society';
};

// Resolves a query into ordered typed tokens (locality | society | landmark), each offered only with live stock.
export function searchEntities(query, index, { limit = 8, perKind = 4 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const locCount = index?.locCount;
  const socCount = index?.socCount;
  const lmCount = index?.lmCount;
  const byCount = (a, b) => b.count - a.count || a.label.localeCompare(b.label);

  const localities = [...(index?.locNames || [])]
    .filter(([, name]) => name.toLowerCase().includes(q))
    .map(([slug, name]) => ({ kind: 'locality', id: slug, slug, label: name, sublabel: 'Locality', count: locCount?.get(slug) || 0 }))
    .sort(byCount)
    .slice(0, perKind);

  const societies = (index?.societies || [])
    .filter((s) => s.name.toLowerCase().includes(q) && (socCount?.get(s.slug) || 0) > 0)
    .map((s) => ({ kind: 'society', id: s.slug, slug: s.slug, label: s.name, sublabel: socSublabel(s, index), count: socCount.get(s.slug), loc: s.localitySlug || null }))
    .sort(byCount)
    .slice(0, perKind);

  const landmarks = LANDMARKS
    .filter((l) => l.value && l.label.toLowerCase().includes(q) && (lmCount?.get(l.value) || 0) > 0)
    .map((l) => ({ kind: 'landmark', id: l.value, value: l.value, label: l.label, sublabel: l.group || 'Landmark', count: lmCount.get(l.value) }))
    .sort(byCount)
    .slice(0, perKind);

  return [...localities, ...societies, ...landmarks].slice(0, limit);
}

// Folds tokens into the Listings URL: localities and societies are CSV, landmark/place proximity is single-valued. A society also emits its parent locality;
// landmarks and places must not, because ANDing a parent slug with `near` dead-ends a gated landmark whose slug holds no stock.
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
    // A Google place that is not a locality routes as a proximity search: single-valued, last pick wins, scoped by radius only.
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
