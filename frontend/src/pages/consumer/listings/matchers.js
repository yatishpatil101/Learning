import { matchTypeKey, matchCommercialKey } from '../../../data/propertyTypes.js';

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

/* Per-listing rental attributes, as stated by the server.
 *
 * This function used to *derive* every one of them from `fnvHash(p.id)`:
 *
 *     const ageYears      = (h >> 16) % 26;
 *     const floor         = (h >> 20) % 41;
 *     const tenants       = TENANT_SETS[h % TENANT_SETS.length];
 *     const availableFrom = ['now', '15', '30'][(h >> 4) % 3];
 *     const pets          = (h >> 8) % 3 === 0;
 *     shareType           = h % 2 === 0 ? 'flatmates' : 'pg';
 *
 * Each of those has had a column and a `ListingFacets` SQL predicate since V95; the values were
 * invented only because `propertyMapper.toViewModel` dropped them off the wire, so the grid had
 * nothing to filter on. The spread order made it unrecoverable: the fabricated keys came *last*
 * in `{ ...p, tenants, availableFrom, ... }`, so even once the mapper carried the real values
 * they would have been overwritten on arrival.
 *
 * Note what was being invented. `tenants` and `pets` are the owner's stated letting policy — who
 * they will rent to. `shareType` decided whether a listing appeared under the PG or Flatmates
 * chips at all, on a coin flip, under a comment that admitted the motive: "Small rentals are
 * always a PG or flatmate share so the filter has stock." A filter with no stock is a product
 * gap; re-labelling someone's home to fill it is a misstatement about their property.
 *
 * What remains is normalisation, not derivation. Every value is the server's, and null survives
 * as null — an unstated age is not a new building, and an unstated policy is not "no pets".
 * Filters must treat null as "unknown, exclude from a narrowed search" rather than coerce it,
 * which is why the `?? 0` fallbacks in listingsResultsPipeline went with the hash. */
export function enrichRent(p) {
  const landUse = isLandListing(p) ? landUseOf(p) : undefined;
  const base = {
    ...p,
    ageYears: p.ageYears ?? null,
    floor: p.floor ?? null,
    ...(landUse && { landUse }),
  };
  if (p.deal !== 'rent') return base;

  // One normalised occupancy list, used both as the value and as the shareType evidence, so the
  // two can never disagree about whether this listing states an occupancy.
  const sharing = Array.isArray(p.sharing) ? p.sharing : (p.sharing ? [p.sharing] : []);
  return {
    ...base,
    // Array.isArray, not `|| []`: `tenantLabel` calls `.some()` on this, and a truthy non-array
    // (a comma string, say) passes a `|| []` guard and then throws, taking down the whole grid.
    tenants: Array.isArray(p.tenants) ? p.tenants : [],
    // `sharing` is the one field with two legitimate authored shapes. Postgres stores a jsonb
    // array, but a PG authored through the older flows carries a single occupancy key as a bare
    // string, and `offersSharing` has always normalised both. Coercing a string to [] here would
    // silently drop a real PG out of its own Sharing filter before `offersSharing` ever saw it.
    sharing,
    availableFrom: p.availableFrom ?? null,
    pets: p.pets ?? false,
    room: p.room ?? null,
    // Derived, but from stated facts rather than from the id: a PG states its occupancy, a
    // flatmate share states its room arrangement, and a listing stating neither is an ordinary
    // rental that belongs under neither chip. Authored listings that already carry an explicit
    // shareType keep it — the http mapper sets it the same way, so this only matters for mocks.
    shareType: p.shareType ?? (sharing.length ? 'pg' : (p.room ? 'flatmates' : null)),
  };
}

export function toggleSet(set, v) {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/* ---------- land-use / zone ----------
   A land listing's zone drives the "Land Use" filter. The server is the authority:
   `properties.land_use` (V95) is CHECK-constrained to the five legal zones and reaches
   here via propertyMapper. Failing that, real owner-posted land carries the declared
   zone in `form.plotZone`, and farm land is agricultural by definition of its type.

   There is deliberately no fourth branch. This used to end in
   `LANDUSE_ZONES[hashId(p.id) % 4]`, described at the time as "a display convenience for
   mock/legacy stock" — but zoning decides whether a plot can lawfully be built on, so a
   stable-looking guess is still a statement about land the seller never made, and it read
   as authoritative because it was rendered identically to a stated one. Unstated zoning is
   now null: the Land Use filter excludes the listing rather than admitting it under an
   invented zone, and the detail page shows "Not specified".
   Keys mirror listings LAND_USE. */
const LANDUSE_ZONES = ['residential', 'commercial', 'industrial', 'mixed'];
const ZONE_LABEL_TO_KEY = { residential: 'residential', commercial: 'commercial', industrial: 'industrial', agricultural: 'agricultural', 'mixed-use': 'mixed' };

export function landUseOf(p) {
  // Server-stated zoning wins outright. The column is CHECK-constrained to exactly these
  // keys, so no label translation is needed; anything unrecognised falls through rather
  // than being coerced to 'residential', so a new zone added server-side shows up as a
  // gap here instead of being silently mislabelled as residential.
  if (p.landUse && (LANDUSE_ZONES.includes(p.landUse) || p.landUse === 'agricultural')) return p.landUse;
  const declared = p.form?.plotZone;
  if (declared) return ZONE_LABEL_TO_KEY[declared.toLowerCase()] || 'residential';
  if (matchTypeKey('farmland', p.type)) return 'agricultural';
  return null;
}

export const isLandListing = (p) => matchTypeKey('plot', p.type) || matchTypeKey('farmland', p.type);
