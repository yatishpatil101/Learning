/* Translates the page's filter axes into `ListingFacets` so the database answers, rather than narrowing a
   100-row page in the browser and reporting that as a fact about the catalogue. */
import { sectionVisible } from './filterRelevance.js';
import { RANGE } from './filterState.js';

/* UI possession shorthand → the vocabulary the `construction` facet matches. Duplicated rather than imported
   from the http mapper: this module is provider-agnostic.

   Prototype-less, as are the two tables below, because each is indexed with a key read straight out of the
   URL: on a plain object `?constr=toString` would resolve to `Object.prototype`'s member and survive the
   `filter(Boolean)` meant to drop unknown keys. */
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

/* "Availability" is a coarser cut of the same column as "Construction Status": `uc` is the other two
   statuses together. Expressed as a set so the two controls can be intersected below. */
const AVAIL_TO_CONSTRUCTION = Object.assign(Object.create(null), {
  ready: ['ready'],
  uc: ['new', 'under'],
});

const list = (set) => (set && set.size ? [...set] : undefined);

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
  const [minArea, maxArea] = bounds(df.area, RANGE.area);
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
    rank: sort === 'newest' ? 'newest' : 'relevance',
    // Only an explicit price order goes through `sort`; `relevance` and `newest` are rankings, not
    // column orders, and an explicit `sort` disables ranking server-side (`PropertySort`).
    sort: sort === 'price-low' ? 'price,asc' : sort === 'price-high' ? 'price,desc' : undefined,

    types: types && types.length ? types : undefined,
    // Only meaningful once the Commercial chip is on — that is what reveals the sub-filter.
    commercialUses: df.types?.has('commercial') ? list(df.commercialTypes) : undefined,
    bhks: rel('bhk') ? list(df.bhk)?.map((bhk) => isBuy && bhk === '4' ? '4plus' : bhk) : undefined,
    furnishings: rel('furnishing') ? list(df.furnishing)?.map((f) => FURNISHING_TO_WIRE[f]).filter(Boolean) : undefined,
    localities: dropLocalities ? undefined : list(df.localities),
    societies: list(df.societies),
    amenities: rel('amenities') ? list(df.amenities) : undefined,
    landUse: rel('landUse') ? list(df.landUse) : undefined,
    room: !isBuy && rel('room') ? list(df.room) : undefined,
    tenants: !isBuy && rel('tenants') ? list(df.tenants) : undefined,
    construction: isBuy ? constructionFacet(df, rel) : undefined,
    availableFrom: !isBuy && rel('availFrom') ? df.availFrom || undefined : undefined,
    // Only ever sent as `true`: "pets not allowed" is not a thing anyone searches for, and sending
    // `false` would narrow to listings that explicitly forbid them.
    pets: !isBuy && df.pets && rel('amenities') ? true : undefined,

    ownerVerified: verified.owner || undefined,
    ownershipVerified: verified.ownership || undefined,
    rera: verified.rera && rel('verifRera') ? true : undefined,
    societyVerified: verified.society && rel('verifSociety') ? true : undefined,
    conveyanceDone: verified.conveyance && rel('verifSociety') ? true : undefined,
    // Never sent as `false`: that would narrow to listings a broker posted, which is the one
    // search nobody comes here to run.
    postedByOwner: df.ownerOnly || undefined,

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

/* The wire spelling of "this facet was used and nothing can satisfy it". A reserved token rather than `[]`,
   because `buildQuery` omits an empty array and Spring binds an absent list param to an empty list too — so
   present-but-empty would answer an impossible filter with the entire catalogue. Frozen: handed out by
   reference, unlike every other array here. */
const UNMATCHABLE = Object.freeze(['no.such.possession']);

/* Both controls narrow the same column, so both set means their intersection — which can be empty when
   they contradict, and that is a genuinely empty result, not an absent filter. */
function constructionFacet(df, rel) {
  const fromAvail = df.avail && rel('availability') ? AVAIL_TO_CONSTRUCTION[df.avail] : null;
  const fromChecks = df.constr?.size && rel('construction') ? [...df.constr] : null;
  if (!fromAvail && !fromChecks) return undefined;
  const chosen = fromAvail && fromChecks
    ? fromAvail.filter((k) => fromChecks.includes(k))
    : fromAvail || fromChecks;
  const wire = chosen.map((k) => CONSTRUCTION_TO_WIRE[k]).filter(Boolean);
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
