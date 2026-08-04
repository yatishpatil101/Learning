import { fnvHash as hashId } from '../../../lib/hash.js';
import { matchTypeKey, matchCommercialKey, PG_SHARING } from '../../../data/propertyTypes.js';

export const emiOf = (price) => {
  const loan = price * 0.8;
  const r = 8.5 / 1200;
  const n = 240;
  const e = (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return '₹' + Math.round(e / 1000) + 'k/mo';
};

/* Buy-tab type matching — delegates to the canonical taxonomy so a listing's
   stored `type` string always resolves to the same filter keys used everywhere. */
export const typeMatch = (key, t) => matchTypeKey(key, t);

/* Buy-tab type matching — share-aware so a PG / Hostel building listed for sale
   (carrying shareType 'pg') resolves to the PG filter, while every other type
   falls back to the canonical stored-`type` string matching. */
export const matchBuyType = (key, p) => {
  if (key === 'pg') return p.shareType === 'pg';
  if (p.shareType === 'pg') return false;
  return matchTypeKey(key, p.type);
};

/* Commercial sub-type matching — resolves a listing's stored `type` string
   (e.g. "Office Space") to the same subtype keys used in "Post a property". */
export const commercialTypeMatch = (key, t) => matchCommercialKey(key, t);

/* Rent type matching is share-aware: a unit re-tagged as PG/flatmates only matches
   that key, otherwise the canonical type matching applies. */
export const matchRentType = (key, p) => {
  if (key === 'pg') return p.shareType === 'pg';
  if (key === 'flatmates') return p.shareType === 'flatmates';
  if (p.shareType) return false;
  return matchTypeKey(key, p.type);
};

/* A PG's `sharing` may be a single key (legacy / synthetic stock) or an array of
   the occupancy types it offers (authored via Post a property / admin). Normalise
   both and match when the listing offers ANY of the selected sharing types. */
export const offersSharing = (p, selectedSet) => {
  const list = Array.isArray(p.sharing) ? p.sharing : (p.sharing ? [p.sharing] : []);
  return list.some((s) => selectedSet.has(s));
};

export const bhkMatch = (key, n) => {
  if (key === '3plus') return n >= 3;
  if (key === '5') return n >= 5;
  if (key === '0') return n === 0;
  return n === Number(key);
};

export const tenantLabel = (t) => {
  if (!t || !t.length) return '';
  const fam = t.includes('family');
  const bach = t.some((x) => x.startsWith('bachelor'));
  if (fam && bach) return 'Family / Bachelors';
  if (fam) return 'Family';
  if (t.includes('company')) return 'Company';
  return 'Bachelors';
};

/* Deep-link from the Flatmates filter into the dedicated Flatmates finder,
   carrying locality + gender preference (mirrors buildFlatmatesUrl in the HTML). */
export function flatmatesUrl(f, locName) {
  const params = new URLSearchParams({ view: 'move-in' });
  const slug = [...f.localities][0];
  if (slug && locName[slug]) params.set('loc', locName[slug]);
  const hasF = f.tenants.has('bachelor-female');
  const hasM = f.tenants.has('bachelor-male');
  if (hasF && !hasM) params.set('g', 'female');
  else if (hasM && !hasF) params.set('g', 'male');
  return '/flatmates?' + params.toString();
}

/* Deterministic per-listing rental attributes (tenants / availability / pets /
   PG-flatmate share type). Keyed off the id so a listing always reads the same. */
const TENANT_SETS = [
  ['family'],
  ['bachelor-male'],
  ['bachelor-female'],
  ['family', 'bachelor-male', 'bachelor-female'],
  ['bachelor-male', 'bachelor-female'],
  ['company'],
  ['family', 'company'],
];
export function enrichRent(p) {
  const h = hashId(p.id);
  const ageYears = (h >> 16) % 26;
  const floor = (h >> 20) % 41;
  const landUse = isLandListing(p) ? landUseOf(p) : undefined;
  if (p.deal !== 'rent') {
    return { ...p, ageYears, floor, ...(landUse && { landUse }) };
  }
  const tenants = TENANT_SETS[h % TENANT_SETS.length];
  const availableFrom = ['now', '15', '30'][(h >> 4) % 3];
  const pets = (h >> 8) % 3 === 0;
  // Authored PG/flatmate listings already carry their share signals (set by the
  // "Post a property" + admin flows); preserve them instead of re-deriving, so a
  // real PG can never be silently re-tagged as a flatmate share (or vice versa).
  if (p.shareType) {
    return { ...p, tenants, availableFrom, pets, ageYears, floor, ...(landUse && { landUse }) };
  }
  let shareType = null;
  let room = null;
  let sharing = null;
  // Only residential rentals can be offered as PG / flatmate shares — commercial
  // and land listings (bhkNum 0) must never be re-tagged as a room share.
  const nonResidential = matchTypeKey('commercial', p.type) || matchTypeKey('plot', p.type) || matchTypeKey('farmland', p.type);
  const small = !nonResidential && (p.type === 'Studio' || (p.bhkNum != null && p.bhkNum <= 1));
  if (small) {
    // Small rentals are always a PG or flatmate share so the filter has stock.
    shareType = h % 2 === 0 ? 'flatmates' : 'pg';
    room = shareType === 'pg' ? 'shared' : ((h >> 13) % 2 === 0 ? 'single' : 'shared');
    // PG stock also carries a deterministic occupancy so the Sharing filter is stocked.
    // Unsigned shift: fnvHash returns a uint32, so a signed `>>` would go negative for
    // hashes >= 2^31 and index PG_SHARING out of bounds (undefined[0] crash).
    if (shareType === 'pg') sharing = PG_SHARING[(h >>> 24) % PG_SHARING.length][0];
  } else if (!nonResidential && p.bhkNum === 2 && h % 3 === 0) {
    // A few 2 BHKs are offered as flatmate units too.
    shareType = 'flatmates';
    room = 'shared';
  }
  return { ...p, tenants, availableFrom, pets, ageYears, floor, shareType, room, sharing, ...(landUse && { landUse }) };
}

export function toggleSet(set, v) {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/* ---------- land-use / zone ----------
   A land listing's zone drives the "Land Use" filter. Real owner-posted land
   carries the declared zone in `form.plotZone`; seed/legacy land has none, so we
   derive a stable zone from the id hash (farm land is agricultural by definition;
   open plots spread across the buildable zones). Keys mirror listings LAND_USE. */
const LANDUSE_ZONES = ['residential', 'commercial', 'industrial', 'mixed'];
const ZONE_LABEL_TO_KEY = { residential: 'residential', commercial: 'commercial', industrial: 'industrial', agricultural: 'agricultural', 'mixed-use': 'mixed' };

export function landUseOf(p) {
  const declared = p.form?.plotZone;
  if (declared) return ZONE_LABEL_TO_KEY[declared.toLowerCase()] || 'residential';
  if (matchTypeKey('farmland', p.type)) return 'agricultural';
  return LANDUSE_ZONES[hashId(p.id) % LANDUSE_ZONES.length];
}

export const isLandListing = (p) => matchTypeKey('plot', p.type) || matchTypeKey('farmland', p.type);
