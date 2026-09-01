/* ---------- listings filter state → server query ----------
   The other half of the seam that `listingsResultsPipeline.js` used to be the whole of. The page
   holds ~25 filter axes; until now it fetched the catalogue unfiltered and narrowed it in the
   browser, which is correct only while the whole catalogue fits in one response. It does not: the
   provider caps a page at 100 rows (the server's `spring.data.web.pageable.max-page-size`), so
   every filter was really "filter the first 100 listings" and every count was a statement about a
   page dressed up as a statement about the catalogue.

   This module translates the filter state into `ListingFacets` so the database answers the
   question instead. It is deliberately a pure function of the filter state — no fetching, no React
   — so the equivalence between it and the client matcher can be tested directly.

   Three rules govern every axis here, and each exists because breaking it produced a real defect:

   1. A hidden filter is never sent. `sectionVisible` decides which controls a given property-type
      selection makes meaningful; a control the user cannot see cannot have been chosen, and
      forwarding a stale value from a section that is now hidden narrows a search the user did not
      narrow. The client matcher gates on exactly the same predicate.

   2. A range thumb parked at its default ceiling means "and above", not "at most this". The
      slider renders it with a "+". Sending it as a concrete upper bound hides every listing above
      the ceiling — which for commercial rent is most of them.

   3. A value the owner never stated is excluded from a narrowed range, not coerced to zero. This
      is what SQL already does (`NULL` fails every comparison), so mirroring it is what keeps the
      two modes agreeing. */
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

/* The "Availability" radio is a coarser cut of the same column as the "Construction Status"
   checkboxes: `ready` is one status, `uc` ("Under Construction") is the other two together.
   Expressed as a set so the two controls can be intersected below rather than fighting. */
const AVAIL_TO_CONSTRUCTION = {
  ready: ['ready'],
  uc: ['new', 'under'],
};

/* PG and Shared Room are two different products, not two names for one — a PG rents a bed at a
   stated occupancy (single/double/.../dormitory), a shared room is one person's room in someone
   else's flat. The database says so too: V100 gives each its own `share_type`, and the type facet
   resolves these two keys against that column while every other chip resolves against
   `property_type_key` AND requires `share_type IS NULL`. So both narrow honestly here, against
   disjoint sets, and each brings its own sub-filter (PG occupancy, flatmate room type).

   What the page cannot claim is completeness for shared rooms: `/flatmates` also carries flatmate
   *requests*, which are people rather than listings and live nowhere near the properties table.
   That gap is disclosed by the cross-sell card in `ResultsArea`, not by silently widening or
   narrowing the search. */

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
 * Filter state → the query object for `GET /properties`.
 *
 * @param {object} df      the listings filter state (see `filterState.js`).
 * @param {object} [opts]
 * @param {string} [opts.sort]  the page's sort key: `relevance|newest|price-low|price-high`.
 * @param {string} [opts.q]     the free-text query from the URL.
 * @param {boolean} [opts.dropLocalities] drop the locality constraint — the "no exact matches,
 *     showing nearby instead" relaxation, which is a second request rather than a second pass over
 *     an already-fetched list.
 * @returns {object} query params; `undefined` values are dropped by the request builder.
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

  // `pg` and `flatmates` travel as ordinary type keys; the server resolves them against
  // `share_type` rather than `property_type_key` (V100), so they select the shares and every other
  // key excludes them.
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
    furnishings: rel('furnishing') ? list(df.furnishing) : undefined,
    localities: dropLocalities ? undefined : list(df.localities),
    societies: list(df.societies),
    amenities: rel('amenities') ? list(df.amenities) : undefined,
    landUse: rel('landUse') ? list(df.landUse) : undefined,
    // Sharing (PG occupancy) applies to both deals — a PG can be let per bed or its building
    // sold — so unlike room/tenants it is not confined to the rent branch.
    sharing: rel('sharing') ? list(df.sharing) : undefined,
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

/* The Availability radio and the Construction Status checkboxes narrow the same column, so when
   both are set the answer is their intersection — not two filters, and not the last one to be
   applied. Returns `undefined` when neither is set, and an empty list when they contradict (e.g.
   "Ready to Move" plus "New Launch"), which is a genuinely empty result rather than no filter.

   Unstated possession is excluded from "Under Construction", where the browser used to include it:
   `p.construction !== 'ready'` is true for a listing that never said. A plot with no possession
   state is not under construction, and SQL would not have counted it either. */
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
