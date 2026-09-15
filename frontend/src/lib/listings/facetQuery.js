/* Translates the page's filter axes into `ListingFacets` so the database answers, rather than
   narrowing a 100-row page in the browser and reporting it as a fact about the catalogue. Three
   rules, each from a real defect: a hidden filter is never sent, a thumb at its default ceiling
   means "and above", and an unstated value is excluded from a range — which is what SQL does. */
import { sectionVisible } from './filterRelevance.js';
import { RANGE } from './filterState.js';

/* UI possession shorthand → the contract vocabulary the `construction` facet matches against.
   Duplicated deliberately rather than imported from the http mapper: this module is provider-
   agnostic, and the mapper's copy is about a single listing's stored value. */
const CONSTRUCTION_TO_WIRE = {
  ready: 'ready-to-move',
  new: 'new-launch',
  under: 'under-construction',
};

/* UI furnishing key → the contract vocabulary the `furnishings` facet matches. They differ on
   exactly one member, which is why the gap hid so long: two of three chips worked, so the axis
   looked wired while "Semi-Furnished" matched nothing and read as an empty catalogue. Duplicated
   from the http mapper because this module is provider-agnostic. */
const FURNISHING_TO_WIRE = {
  unfurnished: 'unfurnished',
  semi: 'semi-furnished',
  furnished: 'furnished',
};

/* The "Availability" radio is a coarser cut of the same column as the "Construction Status"
   checkboxes: `ready` is one status, `uc` ("Under Construction") is the other two together.
   Expressed as a set so the two controls can be intersected below rather than fighting. */
const AVAIL_TO_CONSTRUCTION = {
  ready: ['ready'],
  uc: ['new', 'under'],
};

/* The `flatmates` key resolves against `share_type` while every other chip requires
   `share_type IS NULL`, so the two narrow against disjoint sets. Completeness is not claimed for
   shared rooms — flatmate *requests* are people, not listings; the cross-sell card discloses that
   gap rather than the search silently widening. */
const list = (set) => (set && set.size ? [...set] : undefined);

/* A range as `[min, max]`, with the ceiling read as "and above" and a range still at its defaults
   read as "unfiltered". Returns `[undefined, undefined]` when the user has not touched it, which
   the query serialiser drops. */
function bounds(range, defaults) {
  if (!range) return [undefined, undefined];
  const [lo, hi] = range;
  const [dLo, dHi] = defaults;
  if (lo === dLo && hi === dHi) return [undefined, undefined];
  return [lo === dLo ? undefined : lo, hi === dHi ? undefined : hi];
}

/**
 * Filter state → the query object for `GET /properties`. `opts.dropLocalities` drives the "showing
 * nearby instead" relaxation as a second request; `undefined` values are dropped downstream.
 */
export function toFacetQuery(df, opts = {}) {
  const { sort = 'relevance', q, dropLocalities = false } = opts;
  const rel = (section) => sectionVisible(section, df.types);
  const isBuy = df.deal === 'buy';

  // Price lives on the deal-specific slider, so only one of the two is ever meaningful.
  const [minPrice, maxPrice] = isBuy
    ? bounds(df.budget, RANGE.budget)
    : bounds(df.rent, RANGE.rent);
  // Area is a buy-side control; a rent search has no area slider to have moved.
  const [minArea, maxArea] = isBuy ? bounds(df.area, RANGE.area) : [undefined, undefined];
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
    bhks: rel('bhk') ? list(df.bhk) : undefined,
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

    minPrice,
    maxPrice,
    minArea,
    maxArea,
    minAge,
    maxAge,
    minFloor,
    maxFloor,
    ...near,
  };
}

/* Availability and Construction Status narrow the same column, so both set means their
   intersection — `undefined` when neither is, an empty list when they contradict, which is a
   genuinely empty result rather than no filter. Unstated possession is excluded from "Under
   Construction": a plot that never said is not under construction, and SQL would not count it. */
function constructionFacet(df, rel) {
  const fromAvail = df.avail && rel('availability') ? AVAIL_TO_CONSTRUCTION[df.avail] : null;
  const fromChecks = df.constr?.size && rel('construction') ? [...df.constr] : null;
  if (!fromAvail && !fromChecks) return undefined;
  const chosen = fromAvail && fromChecks
    ? fromAvail.filter((k) => fromChecks.includes(k))
    : fromAvail || fromChecks;
  return chosen.map((k) => CONSTRUCTION_TO_WIRE[k]).filter(Boolean);
}

/* A centre and a radius are one question, so all three params travel together or none do — the
   server ignores any one of them alone rather than inventing a default.

   `nearMode: 'min'` is the walk/drive-time slider, whose value is minutes; 0.4 km per minute is the
   same conversion the browser used, kept here so the two modes draw the same circle. */
function nearParams(df) {
  if (!df.near) return {};
  const [lat, lng] = String(df.near).split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  const radiusKm = df.nearMode === 'min' ? df.nearRadius * 0.4 : df.nearRadius;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return {};
  return { nearLat: lat, nearLng: lng, nearRadiusKm: radiusKm };
}
