/* One place that turns the live listings filter state into a persisted saved-search record and a
   set of display chips, so the alert card, the manual "Save search" action and the dashboard Alerts
   panel all capture and show the same set of filters.

   That set is a SUBSET of the panel, and deliberately so rather than by omission: the server's
   matcher (`SavedSearchService.countMatching`) reads only `deal`, `localities` and `bhk`, so a key
   added here is stored and displayed but does not narrow what the user is notified about. Before
   adding one — `ownerOnly` is the live candidate, since "no brokerage" is a promise rather than a
   preference — widen the matcher first, or the chip advertises a guarantee the alert cannot keep. */
import { fmtINR } from '../../../lib/format.js';
import { fmtRent } from './format.js';
import { BUY_TYPES, RENT_TYPES, COMMERCIAL_TYPES } from '../../../data/propertyTypes.js';
import { BHK_BUY, BHK_RENT, FURN_LBL, AMEN_LBL } from './constants.js';

const TYPE_LBL = Object.fromEntries([...BUY_TYPES, ...RENT_TYPES]);
const COMM_LBL = Object.fromEntries(COMMERCIAL_TYPES);

// Default range bounds (mirroring INITIAL() in Listings.jsx), so an "any price" range can be told
// apart from a real one and not shown as a noise chip.
const BUY_MAX = 50000000;
const RENT_MAX = 100000;

const asArr = (s) => (s instanceof Set ? [...s] : Array.isArray(s) ? s : []);
const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/-/g, ' ');

const bhkLabel = (deal, k) => {
  const arr = deal === 'rent' ? BHK_RENT : BHK_BUY;
  return (arr.find(([x]) => x === k) || [null, `${k} BHK`])[1];
};

const typeLabel = (k) => TYPE_LBL[k] || cap(k);

/* Human price-range chip text, or null when the range is the default "any". */
function priceChipText(deal, budget, rent) {
  if (deal === 'buy') {
    const [lo, hi] = Array.isArray(budget) ? budget : [0, BUY_MAX];
    if (lo <= 0 && hi >= BUY_MAX) return null;
    return `${fmtINR(lo)} – ${fmtINR(hi)}${hi >= BUY_MAX ? '+' : ''}`;
  }
  const [lo, hi] = Array.isArray(rent) ? rent : [0, RENT_MAX];
  if (lo <= 0 && hi >= RENT_MAX) return null;
  return `${fmtRent(lo)} – ${fmtRent(hi)}${hi >= RENT_MAX ? '+' : ''}/mo`;
}

/* Short human summary of the whole search (used as the alert label). */
export function alertLabel(rec, locNameBySlug = {}) {
  const types = asArr(rec.types);
  const bhk = asArr(rec.bhk);
  const localities = asArr(rec.localities);
  const parts = [];
  if (types.length) parts.push(types.map(typeLabel).join('/'));
  if (bhk.length) parts.push(bhk.map((k) => bhkLabel(rec.deal, k)).join('/'));
  parts.push(rec.deal === 'rent' ? 'Rent' : 'Buy');
  if (localities.length) parts.push(localities.map((s) => locNameBySlug[s] || cap(s)).join(', '));
  return parts.filter(Boolean).join(' · ') || `All ${rec.deal === 'rent' ? 'rentals' : 'homes'}`;
}

/* Convert live filter state (Sets) into a plain, persistable alert payload.
   Accepts either the live `f` (Sets) or an already-normalised record (arrays). */
export function buildAlertRecord(f, locNameBySlug = {}) {
  const rec = {
    deal: f.deal,
    types: asArr(f.types),
    commercialTypes: asArr(f.commercialTypes),
    bhk: asArr(f.bhk),
    furnishing: asArr(f.furnishing),
    amenities: asArr(f.amenities),
    localities: asArr(f.localities),
    budget: Array.isArray(f.budget) ? f.budget : undefined,
    rent: Array.isArray(f.rent) ? f.rent : undefined,
  };
  rec.label = alertLabel(rec, locNameBySlug);
  return rec;
}

/* Normalised list of display chips for an alert/saved-search record.
   Works on both the live `f` (Sets) and a stored record (arrays). */
export function criteriaChips(rec, locNameBySlug = {}) {
  const deal = rec.deal;
  const chips = [{ icon: deal === 'rent' ? 'key-round' : 'home', text: deal === 'rent' ? 'For Rent' : 'For Sale' }];

  asArr(rec.types).forEach((k) => chips.push({ icon: 'building-2', text: typeLabel(k) }));
  asArr(rec.commercialTypes).forEach((k) => chips.push({ icon: 'briefcase', text: COMM_LBL[k] || cap(k) }));
  asArr(rec.bhk).forEach((k) => chips.push({ icon: 'bed-double', text: bhkLabel(deal, k) }));

  const price = priceChipText(deal, rec.budget, rec.rent);
  if (price) chips.push({ icon: 'wallet', text: price });

  asArr(rec.localities).forEach((s) => chips.push({ icon: 'map-pin', text: locNameBySlug[s] || cap(s) }));
  asArr(rec.furnishing).forEach((k) => chips.push({ icon: 'sofa', text: FURN_LBL[k] || cap(k) }));
  asArr(rec.amenities).forEach((k) => chips.push({ icon: 'sparkles', text: AMEN_LBL[k] || cap(k) }));

  return chips;
}

/* Honest count of LIVE listings matching a record's core criteria. Fails safe to 0 on any mismatch
   — it never fabricates matches. Localities match against both a listing's slug and its display
   name, so a slug-keyed alert still finds a catalogue entry stored under the display spelling. */
export function countMatches(rec, props = []) {
  const locs = asArr(rec.localities).map((s) => String(s).toLowerCase());
  const bhks = asArr(rec.bhk).map(String);
  const wantsRent = rec.deal === 'rent';
  return props.filter((p) => {
    if (wantsRent ? p.deal !== 'rent' : p.deal === 'rent') return false;
    if (locs.length) {
      const slug = String(p.localitySlug || '').toLowerCase();
      const name = String(p.locality || '').toLowerCase();
      if (!locs.includes(slug) && !locs.includes(name)) return false;
    }
    if (bhks.length && !bhks.includes(String(p.bhkNum))) return false;
    return true;
  }).length;
}

/* Build the listings deep-link that reproduces a saved search's core intent
   (deal + first locality), so a retention nudge lands the user on the actual
   filtered results rather than a generic /listings page. */
export function searchHref(rec) {
  const params = new URLSearchParams();
  params.set('deal', rec.deal === 'rent' ? 'rent' : 'buy');
  const loc = asArr(rec.localities)[0];
  if (loc) params.set('q', String(loc).toLowerCase());
  return '/listings?' + params.toString();
}
