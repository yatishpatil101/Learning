/**
 * Wire ⇄ mock shape translation for the property domain.
 *
 * The mock provider's object shape is the app's *de facto* view model: 21 files and every property
 * card, filter and detail panel read `p.type`, `p.bhkNum`, `p.image`, `p.owner`. Renaming those
 * across the UI to match the API would be a large, risky diff for no user-visible gain, and it would
 * make mock mode and http mode structurally different — which defeats the point of the seam.
 *
 * So the boundary translates instead. Everything below is a rename, a derivation, or an explicitly
 * documented gap; nothing is invented, and nothing the server owns is recomputed here.
 *
 * @see docs/system/frontend-data-seam.md
 */

/**
 * Possession vocabulary: wire ⇄ the UI's shorthand.
 *
 * The API uses self-describing values (`ready-to-move`) because it is a long-lived public contract
 * where `possession=new` would be ambiguous; the React catalogue has always used the shorthand
 * `ready|new|under` across filter chips, i18n keys and ~14 read sites. Translating in the two tables
 * below is a far smaller and safer diff than renaming the UI vocabulary, and it is precisely the
 * renaming job this mapper exists to do.
 *
 * A wire value that is absent (`null` = "not stated", e.g. a plot) maps to `undefined`, which is what
 * the mock also carries for a listing with no construction state — so the filter skips it in both
 * modes rather than pretending it is ready to move.
 */
const CONSTRUCTION_FROM_WIRE = {
  'ready-to-move': 'ready',
  'new-launch': 'new',
  'under-construction': 'under',
};

const CONSTRUCTION_TO_WIRE = Object.fromEntries(
  Object.entries(CONSTRUCTION_FROM_WIRE).map(([wire, ui]) => [ui, wire]),
);

/**
 * Translate through one of the tables above, treating an *unrecognised* value differently from an
 * absent one.
 *
 * Both degrade to `undefined` — which reads as "not stated" and, on the query side, as "don't
 * filter" — so drift never produces a rejected request or a crash. But a value the server sent that
 * we don't know about means the vocabulary has moved on without this client, and that deserves to be
 * audible: it is the same class of fault as the one this whole enum was introduced to fix, where a
 * filter quietly matched nothing and looked like an empty catalogue.
 */
function translateConstruction(table, value, direction) {
  if (value === undefined || value === null || value === '') return undefined;
  const mapped = table[value];
  if (!mapped) {
    console.warn(
      `[propertyMapper] unrecognised possession value "${value}" ${direction}; ` +
      'treating it as not stated. The contract vocabulary has probably changed — update ' +
      'CONSTRUCTION_FROM_WIRE.',
    );
  }
  return mapped;
}

/**
 * Possession for a create/update payload, from either of the two shapes a caller might hold.
 *
 * Unlike the read and filter paths this one is warned about only when *both* sources fail, because a
 * payload legitimately carries one or the other. Dropping a possession the user actually chose is
 * silent data loss on a write, so it must not pass unnoticed.
 */
function writePossession(listing) {
  const fromUi = CONSTRUCTION_TO_WIRE[listing.construction];
  if (fromUi) return fromUi;
  if (CONSTRUCTION_FROM_WIRE[listing.possession]) return listing.possession;
  if (listing.construction || listing.possession) {
    console.warn(
      `[propertyMapper] cannot map possession for write (construction="${listing.construction}", ` +
      `possession="${listing.possession}"); omitting it so the request is not rejected.`,
    );
  }
  return undefined;
}

/**
 * Wire → view model.
 *
 * Accepts either shape the API returns: `PropertySummary` (search/featured cards) or `Property`
 * (detail, which is a superset). Detail-only keys are simply absent on a summary, exactly as they
 * are on a mock card that was never opened.
 */
export function toViewModel(p) {
  if (!p) return null;
  return {
    // ── identity ────────────────────────────────────────────────────────────────────────────
    // The UI treats `id` as a URL token (`/property/:id`) and the API's detail path resolves
    // slug-or-id, so the slug is both prettier and valid. Fall back to the UUID for listings that
    // have no slug yet (owner-created; slugs are assigned during curation).
    id: p.slug || p.id,
    // Kept so a caller that must address the row itself (rather than route to it) doesn't have to
    // re-derive it. Not part of the mock shape, so nothing reads it by accident.
    uuid: p.id,

    // ── straight renames ───────────────────────────────────────────────────────────────────
    type: p.propertyType,
    image: p.coverImage,
    gallery: p.images ?? [],
    desc: p.description,

    // ── derivations ────────────────────────────────────────────────────────────────────────
    // The mock carries both a numeric `bhkNum` (filtering/sorting) and a display `bhk` ("3 BHK",
    // "Studio", ""). The API carries only the number, so the label is rebuilt here. `0` is the
    // catalogue's "not a bedroom count" marker (open plots, studios) and must render blank, not
    // "0 BHK" — hence the truthiness check rather than a null check.
    bhkNum: p.bhk ?? 0,
    bhk: p.bhk ? `${p.bhk} BHK` : '',
    // Mock: a boolean "has RERA". Wire: the registration number itself (absent when unregistered).
    rera: Boolean(p.reraId),
    // Mock dates are plain `YYYY-MM-DD` and are compared and rendered as such; the wire sends a full
    // ISO instant. Truncating keeps `createdMs`/freshness logic behaving identically in both modes.
    createdAt: p.createdAt ? String(p.createdAt).slice(0, 10) : undefined,
    // NON_NULL on the wire, but the UI renders it unconditionally.
    flagReason: p.flagReason ?? '',

    // ── owner: object → the mock's three flat fields ────────────────────────────────────────
    // `mobile` is masked (98XXXXX210) until the contact gate is passed — that masking is a server
    // decision (ADR-019) and is deliberately passed through untouched.
    owner: p.owner?.name,
    ownerId: p.owner?.id,
    ownerMobile: p.owner?.mobile,

    // ── same name, same meaning ─────────────────────────────────────────────────────────────
    slug: p.slug,
    title: p.title,
    deal: p.deal,
    price: p.price,
    priceUnit: p.priceUnit,
    area: p.area,
    areaUnit: p.areaUnit,
    furnishing: p.furnishing,
    locality: p.locality,
    localitySlug: p.localitySlug,
    city: p.city,
    lat: p.lat,
    lng: p.lng,
    status: p.status,
    featured: p.featured ?? false,
    verified: p.verified ?? false,
    ownerVerified: p.ownerVerified ?? false,
    ownershipVerified: p.ownershipVerified ?? false,
    views: p.views ?? 0,
    enquiries: p.enquiries ?? 0,
    docsCount: p.docsCount ?? 0,
    amenities: p.amenities ?? [],

    // ── gaps: present in the mock shape, absent from the contract ───────────────────────────
    // Soft-delete flag. Always `false` on public reads (archived rows are excluded server-side) and
    // meaningful only on the two status-complete lists, `/me/listings` and `/admin/properties`.
    // Defaulted rather than assumed: it was hard-coded `false` here until the moderation queue
    // shipped, which made every archived row in an ops list look live.
    archived: p.archived ?? false,
    construction: translateConstruction(CONSTRUCTION_FROM_WIRE, p.possession, 'from the server'),
  };
}

/** Wire page/array → the plain array the mock returns. */
export const toViewModelList = (payload) =>
  (Array.isArray(payload) ? payload : payload?.content ?? []).map(toViewModel);

/**
 * Mock filter object → API query params.
 *
 * Only the facets the server implements are forwarded; the rest are handled by
 * {@link unsupportedFilters}, which the provider reports rather than silently dropping — a filter
 * that quietly stops applying looks like a data bug, not a missing feature.
 */
export function toQuery(filters = {}, sort = 'newest') {
  return {
    deal: filters.deal,
    type: filters.type,
    // Already a slug on both sides: the mock matches `p.localitySlug === f.locality`, and the API's
    // `locality` param matches `locality_slug`. Passing the display name here silently returns zero
    // results, which is why the server emits `localitySlug` at all.
    locality: filters.locality,
    bhk: filters.bhk,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    furnishing: filters.furnishing,
    // The UI's `ready|new|under` shorthand translated back to the contract vocabulary. An unknown
    // value yields `undefined`, which `buildQuery` drops — so the request is unfiltered rather than
    // one the server would reject with a 422.
    possession: translateConstruction(CONSTRUCTION_TO_WIRE, filters.construction, 'in a filter'),
    q: filters.q,
    status: filters.status,
    sort: SORTS[sort] ?? SORTS.newest,
  };
}

/**
 * Mock sort keys → the API's `field,direction`. The server whitelists `createdAt|price|area|bhk`
 * (`PropertySort`) and silently falls back to newest-first for anything else, so an unmapped key
 * would degrade quietly — mapping them explicitly keeps the two modes ordering identically.
 */
const SORTS = {
  newest: 'createdAt,desc',
  'price-asc': 'price,asc',
  'price-desc': 'price,desc',
  'area-desc': 'area,desc',
};

/**
 * Filter keys the mock honours that the API has no equivalent for. The provider warns on these so
 * the difference is visible in the console instead of surfacing as "the admin list is missing rows".
 *
 * - `includeArchived` / `includeAllStatuses`: admin-only widenings. The public search is hard-floored
 *   to approved + non-archived server-side and cannot be widened by a query param — by design, not
 *   an oversight. A caller that genuinely needs those rows wants `listForModeration`, which is a
 *   different endpoint behind a different authorization, not a flag on this one.
 * - `real`: marks genuine user posts, which the mock uses to hide "dormant" listings from buyers.
 *   Freshness/dormancy is not modelled server-side yet.
 */
const UNSUPPORTED = ['includeArchived', 'includeAllStatuses', 'real'];

export const unsupportedFilters = (filters = {}) =>
  UNSUPPORTED.filter((k) => filters[k] !== undefined && filters[k] !== false);

/**
 * Filters → the `GET /admin/properties` query string.
 *
 * Same facets as {@link toQuery} plus the two axes only the moderation queue has — and **the default
 * is no filtering on either**. An unfiltered moderation read means every listing at every status,
 * including archived, because that is what a queue is; anything narrower has to be asked for.
 *
 * That default is the opposite of {@link toQuery}'s and the inversion is deliberate. While this was
 * reached by inferring `includeAllStatuses`/`includeArchived` from the caller's filters, re-imposing
 * the public floor when a flag was absent was the safe reading. Now that the caller names the
 * operation, carrying those flags forward would mean `listForModeration({})` returned exactly the
 * approved rows the public search already returns — an admin queue showing 16 of 38 listings and no
 * error to explain the other 22.
 *
 * `status` and `archived` still narrow it when supplied, which is what the tab filters use.
 */
export function toModerationQuery(filters = {}, sort = 'newest') {
  const q = toQuery(filters, sort);
  if (filters.archived !== undefined) q.archived = filters.archived;
  return q;
}

/**
 * View model → `ListingCreate` for `POST /me/listings`.
 *
 * Trust-critical fields are deliberately *not* sent: `status`, `owner`, `postedByType` and
 * `priceUnit` are all server-set (a listing cannot be born approved or attributed to someone else),
 * and `localitySlug` is resolved server-side from the display name by `LocalityResolver`. Sending
 * them would at best be ignored and at worst imply the client is trusted with them.
 */
export function toListingCreate(listing = {}) {
  return {
    title: listing.title,
    deal: listing.deal,
    propertyType: listing.type ?? listing.propertyType,
    price: listing.price,
    locality: listing.locality,
    city: listing.city ?? 'Pune',
    bhk: listing.bhkNum ?? undefined,
    area: listing.area,
    areaUnit: listing.areaUnit,
    furnishing: listing.furnishing,
    deposit: listing.deposit,
    maintenance: listing.maintenance,
    negotiable: listing.negotiable,
    lat: listing.lat,
    lng: listing.lng,
    reraId: listing.reraId,
    // The listing form carries the UI shorthand in `construction`; the contract validates the
    // hyphenated vocabulary and 422s anything else, so translate rather than forward. Accepts an
    // already-wire value too, for a caller that built the payload from an API response.
    possession: writePossession(listing),
    amenities: listing.amenities,
    images: listing.gallery ?? listing.images,
    description: listing.desc ?? listing.description,
  };
}

/** View-model patch → `ListingUpdate` for `PATCH /me/listings/{id}`; undefined keys are omitted. */
export function toListingUpdate(patch = {}) {
  const out = toListingCreate(patch);
  // A PATCH must not resend `city: 'Pune'` just because the caller omitted it — that would be an
  // unrequested write, and on a foundation field it would be an unrequested re-moderation.
  if (patch.city === undefined) delete out.city;
  for (const [k, v] of Object.entries(out)) {
    if (v === undefined) delete out[k];
  }
  return out;
}
