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
    // How many photos exist, which is not the same question as which ones. The card projection
    // carries the count and not the array, so on a list row `gallery` is empty and `photoCount` is
    // the truth; on a detail row both are present and agree. A caller deciding *whether* a listing
    // has enough photos must read this — reading `gallery.length` off a list row is how the reels
    // feed came to be permanently empty.
    photoCount: p.imageCount ?? (p.images?.length ?? 0),
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
    // Owner/staff only — the public response omits it, so on a search card this is simply absent
    // (D218). Mapped back to the wizard's field name so an owner reopening the edit form sees the
    // number they typed rather than an empty box that would silently clear it on save.
    electricityConsumerNo: p.electricityMeterNo ?? undefined,
    // Mock dates are plain `YYYY-MM-DD` and are compared and rendered as such; the wire sends a full
    // ISO instant. Truncating keeps `createdMs`/freshness logic behaving identically in both modes.
    createdAt: p.createdAt ? String(p.createdAt).slice(0, 10) : undefined,
    // The freshness model's input (V86). Named `freshenedAt` on this side because that is what
    // `lib/freshness.js` and every badge downstream already read; the wire name is the honest one
    // and the view-model name is the historical one, and renaming twelve call sites to close that
    // gap would be a bigger diff than the feature.
    //
    // Left undefined when the server has never been told — `daysSinceFresh` then falls back to
    // `createdAt`, which is the same fallback the server documents. Coercing null to the posting
    // date here would work identically today and lose the distinction the column exists to keep.
    freshenedAt: p.lastConfirmedAt ? String(p.lastConfirmedAt).slice(0, 10) : undefined,
    // NON_NULL on the wire, but the UI renders it unconditionally.
    flagReason: p.flagReason ?? '',

    // ── the stays-live re-check queue (Q14) ────────────────────────────────────────────────
    // A price/furnishing/possession edit on an approved listing keeps it approved and in search
    // and files a moderator work item instead. Carried through because `status` cannot express
    // it — that is the entire point of the outcome — so an admin screen reading only `status`
    // sees a perfectly ordinary live listing and the queue is invisible.
    //
    // `recheckRequestedAt` is the one that matters most and is the easiest to leave behind: the
    // boolean says a re-check is owed, only the timestamp says it has been owed for eleven days,
    // and without it an undrained queue renders identically to an empty one.
    recheckPending: p.recheckPending ?? false,
    recheckReason: p.recheckReason ?? '',
    recheckRequestedAt: p.recheckRequestedAt ?? '',

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
    // Deal outcome mirrored onto the listing (D110): active|reserved|closed on both cards and
    // detail. A terminal `status` (sold/rented) always rides with `dealStatus: 'closed'`; the field
    // carries the one state `status` cannot — `reserved`, an under-offer listing still shown as
    // approved. Read by the buyer's DealPanel and by card badges.
    dealStatus: p.dealStatus ?? 'active',
    featured: p.featured ?? false,
    // Paid placement (D59). `featured` above is an editorial pick made by staff; this one is bought,
    // and the two are not interchangeable — a promoted card must say so, which is why it is carried
    // as its own field rather than folded into `featured`. The server computes it from the live
    // window at request time, so it is never stale and needs no client-side expiry check.
    boosted: p.boosted ?? false,
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

    // Back-office concierge pipeline (D216). The server nests these seven under `adminPipeline` and
    // omits the key entirely for anyone who may not see it — `PropertyController` passes
    // `BackOfficeVisibility.HIDDEN`, and `@JsonInclude(NON_NULL)` then removes it rather than
    // publishing an empty object, so its absence is the access rule doing its job and not a gap.
    // The mock carried the same seven flat, and every reader still reads them flat, so they are
    // flattened here rather than changing six call sites to reach through a nullable object.
    //
    // Defaults are the "no concierge involvement" answer, which is the truth for the overwhelming
    // majority of listings and for every consumer read. That matters most for `postedByAdmin`:
    // undefined is falsy in the `&&` guards that gate the chase button, so the button simply does
    // not draw — but `reminderCount` reaching a badge as `undefined` would have rendered the string
    // "undefined" next to a listing, which is why each one is defaulted rather than spread.
    //
    // `reminderCount` counts only concierge chasers. `OwnerOutreachService.countsFor` filters on
    // `isPostedByAdmin` before counting, so a chaser written against an owner-posted listing is
    // recorded in the ledger and audited but never reaches this number. Anything wanting to say
    // "chased N times" in general must read `GET /properties/{id}/outreach` instead of this field.
    postedByAdmin: p.adminPipeline?.postedByAdmin ?? false,
    postedByStaff: p.adminPipeline?.postedByStaff ?? null,
    pipelineStage: p.adminPipeline?.pipelineStage ?? null,
    claimLinkSent: p.adminPipeline?.claimLinkSent ?? false,
    photosUploaded: p.adminPipeline?.photosUploaded ?? false,
    aadhaarVerified: p.adminPipeline?.aadhaarVerified ?? false,
    reminderCount: p.adminPipeline?.reminderCount ?? 0,

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
 *
 * `recheck` is the third axis and the one a caller must ask for by name: it is the stays-live
 * queue (Q14), and because those listings are `approved` and un-archived, neither of the other two
 * can express it. It was declared server-side and tested there while nothing on this side ever
 * sent it — so the queue existed, was correct, and was unreachable.
 */
export function toModerationQuery(filters = {}, sort = 'newest') {
  const q = toQuery(filters, sort);
  if (filters.archived !== undefined) q.archived = filters.archived;
  if (filters.recheck !== undefined) q.recheck = filters.recheck;
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
  // The parts the wizard stores separately, assembled into the one line the contract takes. The
  // server normalises whatever arrives (AddressKey), so the exact assembly matters less than
  // including the unit token — that is what distinguishes one flat from its neighbour.
  //
  // `street` is in the list so this composition matches the one the owner wizard sends (D219). It
  // has to: AddressKey is deliberately exact rather than fuzzy, and `street` is not a filler token,
  // so a three-part line and a four-part line for the same flat normalise to two different keys.
  // The desk posting on behalf of a broker and the real owner posting for themselves is precisely
  // the pairing the detector exists to catch, and a silent disagreement here is the one way to make
  // that pair uncatchable while every test stays green. Fields the caller does not have drop out.
  const composed = [listing.flatNumber, listing.tower, listing.society, listing.street]
    .map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');
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
    // The four duplicate-detection inputs (D218). The wizard has always collected these — they fed
    // a browser-side dedup check that could only ever see the listings on this one machine. They go
    // to the server now, where the same question is asked against everybody's listings.
    address: listing.address || composed || undefined,
    // Number('N/A') is NaN and NaN serialises to `null`, which the contract reads as "cleared" —
    // so a non-numeric floor did not fail, it silently erased the one the listing already had.
    // AdminPostOnBehalf sends exactly that string for a ground/lobby unit. Omit instead: an
    // unparseable floor is a floor we do not know, and the signal is better off one arm short than
    // wrong. (The server treats a missing floor as no (society, floor, bhk) signal at all.)
    floor: Number.isFinite(Number(listing.floor)) && listing.floor !== '' && listing.floor != null
      ? Number(listing.floor)
      : undefined,
    // Only the resolved entity id, never the typed name: the whole value of the
    // (society, floor, bhk) signal is that `societyId` is a curated key that cannot be fudged by
    // spelling. An empty string here means the lister typed a name without picking one.
    societyId: listing.societyId || undefined,
    electricityMeterNo: listing.electricityConsumerNo || undefined,
  };
}

/** View-model patch → `ListingUpdate` for `PATCH /me/listings/{id}`; undefined keys are omitted. */
export function toListingUpdate(patch = {}) {
  const out = toListingCreate(patch);
  // A PATCH must not resend `city: 'Pune'` just because the caller omitted it — that would be an
  // unrequested write, and on a foundation field it would be an unrequested re-moderation.
  if (patch.city === undefined) delete out.city;
  // Same reasoning, sharper: `toListingCreate` composes an address out of flat/tower/society, which
  // is right when all three are in hand and wrong on a partial patch — a body carrying only
  // `society` would compose a *worse* address than the one already stored and overwrite it. On a
  // PATCH the address is only ever what the caller actually said it was.
  if (patch.address === undefined) delete out.address;
  for (const [k, v] of Object.entries(out)) {
    if (v === undefined) delete out[k];
  }
  return out;
}
