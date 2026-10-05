/* Translates the page's filter axes into `ListingFacets` so the database answers, rather than narrowing a
   100-row page in the browser and reporting that as a fact about the catalogue. */
import { sectionVisible } from './filterRelevance.js';
import { RANGE } from './filterState.js';
import { areaBounds, areaProfileForTypes } from './areaUnits.js';

/** UI possession shorthand → the vocabulary the `construction` facet matches. Duplicated rather than imported from
 * the http mapper: this module is provider-agnostic. */
const CONSTRUCTION_TO_WIRE = Object.assign(Object.create(null), {
  ready: 'ready-to-move',
  new: 'new-launch',
  under: 'under-construction',
});

/* UI furnishing key → the vocabulary the `furnishings` facet matches; they differ on exactly one member.
   Duplicated from the http mapper because this module is provider-agnostic. */
const FURNISHING_TO_WIRE = Object.assign(Object.create(null), {
  unfurnished: 'unfurnished',
  semi: 'semi-furnished',
  furnished: 'furnished',
});

const list = (set) => (set && set.size ? [...set] : undefined);
const csv = (set) => (set && set.size ? [...set].join(',') : undefined);
const MIN_BATH_KEYS = new Set(['1', '2', '3', '4']);

/* The ceiling reads as "and above" and a range still at its defaults reads as unfiltered, returning
   `[undefined, undefined]` — which the query serialiser drops. */
function bounds(range, defaults) {
  if (!range) return [undefined, undefined];
  const [lo, hi] = range;
  const [dLo, dHi] = defaults;
  if (lo === dLo && hi === dHi) return [undefined, undefined];
  return [lo === dLo ? undefined : lo, hi === dHi ? undefined : hi];
}

/* `opts.dropLocalities` drives the "showing nearby instead" relaxation as a second request;
   `undefined` values are dropped downstream. */
export function toFacetQuery(df, opts = {}) {
  const { sort = 'relevance', q, dropLocalities = false } = opts;
  const rel = (section) => sectionVisible(section, df.types);
  const isBuy = df.deal === 'buy';

  // Price lives on the deal-specific slider, so only one of the two is ever meaningful.
  const [minPrice, maxPrice] = isBuy
    ? bounds(df.budget, RANGE.budget)
    : bounds(df.rent, RANGE.rent);
  const [minArea, maxArea] = rel('area') ? areaBounds(df.area, areaProfileForTypes(df.types, df.areaUnit)) : [undefined, undefined];
  // The deposit is a rent-side control; a sale has no deposit column to narrow on.
  const [minDeposit, maxDeposit] = isBuy
    ? [undefined, undefined]
    : bounds(df.deposit, RANGE.deposit);
  const [minAge, maxAge] = rel('age') ? bounds(df.age, RANGE.age) : [undefined, undefined];
  const [minFloor, maxFloor] = rel('floor') ? bounds(df.floor, RANGE.floor) : [undefined, undefined];

  // `flatmates` travels as an ordinary type key; the server resolves it against `share_type`
  // rather than `property_type_key`, so it selects the shares and every other key excludes them.
  const types = list(df.types);

  const verified = df.verified || {};
  const near = nearParams(df);

  return {
    deal: df.deal,
    q: q || undefined,
    rank: sort === 'newest' ? 'newest' : sort === 'price-psf' ? 'pricePerSqft' : sort === 'verified' ? 'verified' : 'relevance',
    // Only an explicit price order goes through `sort`; `relevance` and `newest` are rankings, not
    // column orders, and an explicit `sort` disables ranking server-side (`PropertySort`).
    sort: sort === 'price-low' ? 'price,asc' : sort === 'price-high' ? 'price,desc' : undefined,

    types: types && types.length ? types : undefined,
    // Only meaningful once the Commercial chip is on — that is what reveals the sub-filter.
    commercialUses: df.types?.has('commercial') ? list(df.commercialTypes) : undefined,
    bhks: rel('bhk') ? list(df.bhk) : undefined,
    furnishings: rel('furnishing') ? list(df.furnishing)?.map((f) => FURNISHING_TO_WIRE[f]).filter(Boolean) : undefined,
    facing: rel('facing') ? csv(df.facing) : undefined,
    minBaths: rel('baths') && MIN_BATH_KEYS.has(String(df.minBaths)) ? Number(df.minBaths) : undefined,
    localities: dropLocalities ? undefined : list(df.localities),
    societies: list(df.societies),
    amenities: rel('amenities') ? list(df.amenities) : undefined,
    landUse: rel('landUse') ? list(df.landUse) : undefined,
    shell: rel('shell') ? csv(df.shell) : undefined,
    preLeased: isBuy && rel('preLeased') && df.preLeased ? true : undefined,
    na: rel('na') ? csv(df.na) : undefined,
    room: !isBuy && rel('room') ? list(df.room) : undefined,
    tenants: !isBuy && rel('tenants') ? list(df.tenants) : undefined,
    construction: isBuy ? constructionFacet(df, rel) : undefined,
    availableFrom: !isBuy && rel('availFrom') ? df.availFrom || undefined : undefined,
    // Only ever sent as `true`: "pets not allowed" is not a thing anyone searches for, and sending
    // `false` would narrow to listings that explicitly forbid them.
    pets: !isBuy && df.pets && rel('amenities') ? true : undefined,
    food: !isBuy && df.food && rel('food') ? df.food : undefined,

    ownerVerified: verified.owner || undefined,
    ownershipVerified: verified.ownership || undefined,
    rera: verified.rera && rel('verifRera') ? true : undefined,
    societyVerified: verified.society && rel('verifSociety') ? true : undefined,
    conveyanceDone: verified.conveyance && rel('verifSociety') ? true : undefined,

    minPrice,
    maxPrice,
    minArea,
    maxArea,
    minAge,
    maxAge,
    minFloor,
    maxFloor,
    minDeposit,
    maxDeposit,
    ...near,
  };
}

/* Reserved no-match token: empty arrays are omitted and bind like absent lists in Spring. */
const UNMATCHABLE = Object.freeze(['no.such.possession']);

function constructionFacet(df, rel) {
  const fromChecks = df.constr?.size && rel('construction') ? [...df.constr] : null;
  if (!fromChecks) return undefined;
  const wire = fromChecks.map((k) => CONSTRUCTION_TO_WIRE[k]).filter(Boolean);
  return wire.length ? wire : UNMATCHABLE;
}

/* A centre and a radius are one question, so all three params travel together or none do. 0.4 km per minute
   is the same conversion the browser used, kept here so both modes draw the same circle. */
function nearParams(df) {
  if (!df.near) return {};
  const [lat, lng] = String(df.near).split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  const radiusKm = df.nearMode === 'min' ? df.nearRadius * 0.4 : df.nearRadius;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return {};
  return { nearLat: lat, nearLng: lng, nearRadiusKm: radiusKm };
}
