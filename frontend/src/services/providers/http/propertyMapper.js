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
 * Furnishing, the same job as the possession tables above and for the same reason.
 *
 * Two of the three levels are spelled identically on both sides, which is exactly what made this
 * hard to see: `unfurnished` and `furnished` round-tripped untouched, so the field looked mapped.
 * Only the middle value differs — the contract says `semi-furnished` (`Furnishing.SEMI_FURNISHED`,
 * the V3 CHECK constraint) and the React catalogue says `semi` across filter chips, i18n keys and
 * ~14 read sites.
 *
 * Untranslated, that one value broke three things at once, all silently apart from the first:
 * posting a semi-furnished home was a **422 the owner could not act on** (the wizard's own default
 * for a rental, and the most common answer in this market); a `furnishing=semi` search matched
 * nothing server-side and read as an empty catalogue; and a semi-furnished listing coming back from
 * the server rendered as `—` on the detail page, because `useProperty` only knows the UI keys.
 */
const FURNISHING_FROM_WIRE = {
  unfurnished: 'unfurnished',
  'semi-furnished': 'semi',
  furnished: 'furnished',
};

const FURNISHING_TO_WIRE = Object.fromEntries(
  Object.entries(FURNISHING_FROM_WIRE).map(([wire, ui]) => [ui, wire]),
);

/**
 * Translate one furnishing value in either direction.
 *
 * Absent stays absent: `null` means "not stated", which the server treats as genuinely different
 * from `unfurnished` (an owner who skipped the field has not claimed the flat is empty). An
 * unrecognised value degrades to `undefined` and says so, so vocabulary drift is audible rather
 * than turning into a rejected write.
 *
 * A filter may hold a Set or an array — the chips are multi-select — so each member is translated
 * and the shape is preserved.
 */
function translateFurnishing(table, value, direction) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Set || Array.isArray(value)) {
    const mapped = [...value].map((v) => translateFurnishing(table, v, direction)).filter(Boolean);
    return mapped.length ? mapped : undefined;
  }
  const mapped = table[value];
  if (!mapped) {
    console.warn(
      `[propertyMapper] unrecognised furnishing value "${value}" ${direction}; treating it as not ` +
      'stated. The contract vocabulary has probably changed — update FURNISHING_FROM_WIRE.',
    );
  }
  return mapped;
}

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
    /* …and the number too, because the boolean is a one-way door. The edit form has to put back
       every field `ListingUpdate` accepts — a key it cannot restore is a key it sends empty, and an
       empty `reraId` is not "unchanged", it is "erased". Carried under the wire's own name so the
       two never drift: `rera` answers "is it registered", this answers "with what". */
    reraId: p.reraId ?? '',
    /* The remaining `ListingUpdate` fields, mapped for the same reason rather than because a card
       renders them. Everything the edit form can send, it must be able to read back first. */
    deposit: p.deposit ?? 0,
    maintenance: p.maintenance ?? 0,
    negotiable: p.negotiable ?? false,
    // Owner/staff only, and absent on a summary — the composed line including the unit token.
    address: p.address ?? '',
    pincode: p.pincode ?? '',
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
    // `semi-furnished` on the wire is `semi` in the catalogue; see FURNISHING_FROM_WIRE. Left
    // untranslated the detail page rendered a dash for the commonest answer in the market.
    furnishing: translateFurnishing(FURNISHING_FROM_WIRE, p.furnishing, 'from the server') ?? null,
    locality: p.locality,
    localitySlug: p.localitySlug,
    // The society this home is actually in, by slug and not by id (D19). The slug is the key the
    // local catalogue, `/societies/{slug}` and the hub route all agree on; the server's `societyId`
    // is a UUID that matches nothing here, because the catalogue is still `data/societies.js` with
    // its synthetic `S01` ids. Absent when the owner never named one — and absent has to survive as
    // absent, because until D19 the property page filled the gap by hashing the listing id into a
    // society list and printing that building's builder, towers, units, year and occupancy.
    societySlug: p.societySlug,
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
    // The second funnel (D27/V92). `pipelineStage` is where the *desk* got to — contacted, info
    // collected, listed, docs submitted — and `handbackMilestone` is where the *owner* got to once
    // the desk handed the listing over. They were one column until V92, where the later write
    // silently erased the earlier one. Null is the honest answer for every listing whose hand-back
    // has not started, which is most of them and all owner-posted ones.
    handbackMilestone: p.adminPipeline?.handbackMilestone ?? null,
    claimLinkSent: p.adminPipeline?.claimLinkSent ?? false,
    photosUploaded: p.adminPipeline?.photosUploaded ?? false,
    aadhaarVerified: p.adminPipeline?.aadhaarVerified ?? false,
    reminderCount: p.adminPipeline?.reminderCount ?? 0,

    construction: translateConstruction(CONSTRUCTION_FROM_WIRE, p.possession, 'from the server'),

    // Permitted zoning for plots and farm land; null for buildings. V95 added the column with a
    // CHECK on the five legal zones under the comment "search facets the browser used to invent",
    // but only the server half was ever wired — this mapper dropped the field, so `landUseOf()`
    // in matchers.js fell through to `LANDUSE_ZONES[hashId(p.id) % 4]` and every live land listing
    // published a zone derived from a hash of its slug. p5124 is `residential` in Postgres and was
    // rendering as `mixed`. Zoning is a legal attribute of the plot, not a display detail, so a
    // fabricated one is a misstatement to the buyer rather than a cosmetic defect.
    landUse: p.landUse ?? null,

    /* The rest of the set `landUse` belonged to. Every one of these had a column and a SQL
       predicate since V95, and every one was dropped here and then invented in the browser from
       `fnvHash(p.id)` — age as `(h >> 16) % 26`, floor as `(h >> 20) % 41`, the society's
       verification status as a `(h >> 12) % 2` coin flip. Filtering is the server's now, but the
       card still prints every one of these, so a field this mapper omits is still a field the
       page must either guess at or leave blank.

       `?? null` rather than `?? <default>` throughout, deliberately. Null here means "the owner
       never stated it", which is a different fact from any particular value: a null age is not a
       new building and a null facing is not north. Downstream renders "Not specified" for null,
       and the server's predicates exclude null from a narrowed range rather than coercing it —
       the browser-side pipeline this replaced used `?? 0`, which turned every unstated age into
       "brand new" and quietly widened the result set.

       `tenants` and `sharing` are NOT NULL jsonb arrays server-side, so [] is the real value and
       means "no restriction stated". Array.isArray rather than `?? []` because a non-array
       truthy value reaching `tenantLabel` throws and takes the whole grid down. */
    ageYears: p.ageYears ?? null,
    floor: p.floor ?? null,
    totalFloors: p.totalFloors ?? null,
    facing: p.facing ?? null,
    /* V114. `bath` is the name the detail page and the cards already read; it used to be filled in
       by `Math.max(1, bhkNum - 1)` in five separate components, which printed an arithmetic guess
       in the same tile shape as the price. Null here has to survive as null all the way to the
       page — the fabrication is only gone if nothing downstream substitutes for it. */
    bath: p.bathrooms ?? null,
    parkingSpaces: p.parking ?? null,
    balconies: p.balconies ?? null,
    room: p.room ?? null,
    tenants: Array.isArray(p.tenants) ? p.tenants : [],
    availableFrom: p.availableFrom ?? null,
    pets: p.pets ?? false,
    sharing: Array.isArray(p.sharing) ? p.sharing : [],
    societyVerified: p.societyVerified ?? false,
    conveyanceDone: p.conveyanceDone ?? false,

    /* Not a server field: there is no `share_type` column and no ListingFacets facet for it.
       It is *derived*, but from stated facts rather than from a hash — a PG states its occupancy
       (`sharing`), a flatmate share states its room arrangement (`room`), and a listing that
       states neither is an ordinary rental. That distinction previously came from
       `h % 2 === 0 ? 'flatmates' : 'pg'`, which re-tagged any small rental as a PG on a coin
       flip, under a comment conceding the motive: "Small rentals are always a PG or flatmate
       share so the filter has stock". Stock is not a reason to relabel someone's home.

       Derivation is honest here in a way the hash was not, because it is falsifiable: if the
       owner states no occupancy and no room type, this is null and the listing does not appear
       under the PG or Flatmates chips at all. */
    shareType: (Array.isArray(p.sharing) && p.sharing.length) ? 'pg' : (p.room ? 'flatmates' : null),
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
    // The chips speak `semi`; the server only matches `semi-furnished`. Untranslated this filtered
    // to nothing and looked like a market with no semi-furnished homes in it.
    furnishing: translateFurnishing(FURNISHING_TO_WIRE, filters.furnishing, 'in a filter'),
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
/**
 * View model → the List Property wizard's `form` state, for the edit prefill (D237).
 *
 * The mock's `myListing` resolves a stored record which carries its own `form` snapshot, so the
 * wizard could always reopen it verbatim. A server row has no such snapshot — it has the contract's
 * field names — and the hook reads `listing.form || listing`, so without this the live editor
 * prefilled from keys that mostly do not exist: `type` where the form says `propertyType`, `desc`
 * where it says `description`, `bhk: "2 BHK"` where it wants `"2"`. Almost every box came up empty.
 *
 * **Empty is not cosmetic here, it is destructive.** `toListingUpdate` drops only `undefined`, and
 * the wizard's record builder turns an unfilled field into `''` or `0` — so a field this function
 * fails to restore is a field the next save *erases*. That is why the set below is pinned to
 * `ListingUpdate` rather than to what the form happens to show: every key the PATCH can carry has
 * to come back, and the ones the server never stores (bathrooms, balconies, lock-in, ownership
 * type, preferred tenants) are safe precisely because the contract has nowhere to put them.
 *
 * The address parts are the deliberate exception. The wire carries one composed line and the wizard
 * carries flat/tower/society/street, and splitting a line back into four is guesswork — so they are
 * left on their defaults, which makes `forTheWire` compose an empty address, which `toListingUpdate`
 * then drops. An address the owner did not touch stays exactly as the server has it.
 */
export function toEditForm(vm = {}) {
  const isRent = vm.deal === 'rent';
  const price = vm.price == null ? '' : String(vm.price);
  return {
    deal: vm.deal || 'buy',
    propertyType: vm.type || '',
    // The form holds the bedroom count as a string ("2"); `0` is the catalogue's "not a bedroom
    // count" marker for plots and studios and must read as blank rather than as "0".
    bhk: vm.bhkNum ? String(vm.bhkNum) : '',
    carpetArea: vm.area == null ? '' : String(vm.area),
    areaUnit: vm.areaUnit || 'sqft',
    furnishing: vm.furnishing || 'unfurnished',
    locality: vm.locality || '',
    // One column, two form fields: which one is authoritative is the deal type, exactly as the
    // record builder decides it on the way out.
    ...(isRent ? { monthlyRent: price, price: '' } : { price, monthlyRent: '' }),
    deposit: vm.deposit ? String(vm.deposit) : '',
    // Maintenance splits by deal on the way out too (`rentMaintenance` when a renter pays it on
    // top, `monthlyMaintenance` otherwise), so a non-zero figure on a rent listing implies the
    // 'extra' mode — 'included' would send it straight back as nothing.
    ...(isRent
      ? { rentMaintenance: vm.maintenance ? String(vm.maintenance) : '', rentMaintMode: vm.maintenance ? 'extra' : 'included' }
      : { monthlyMaintenance: vm.maintenance ? String(vm.maintenance) : '' }),
    priceNegotiable: !!vm.negotiable,
    reraId: vm.reraId || '',
    description: vm.desc || '',
    amenities: vm.amenities || [],
    floor: vm.floor == null ? '' : String(vm.floor),
    totalFloors: vm.totalFloors == null ? '' : String(vm.totalFloors),
    facing: vm.facing || '',
    /* Possession travels out through `writePossession`, which reads the form's `age` first via the
       record's `construction`. Leaving `age` blank makes the record say `ready`, so an
       under-construction listing would be quietly re-declared ready-to-move by an edit that had
       nothing to do with possession — a misstatement to the buyer rather than a lost field.

       The map is the exact inverse of the record builder's, which is narrower than the contract:
       `construction: form.age === 'under-construction' ? 'new' : 'ready'` collapses everything that
       is not under construction onto ready, and sends under-construction out as `new-launch`. That
       mismatch is the wizard's, not this function's, and reproducing it is the point — an inverse
       that were more correct than the forward map would make an untouched edit change the listing. */
    age: (vm.construction === 'new' || vm.construction === 'under')
      ? 'under-construction'
      : yearsToAgeBand(vm.ageYears),
    /* Restored because they are now writable (D244). Until V114 these were safe to omit for the
       reason the docstring above gives — the contract had nowhere to put them, so a blank in the
       form could not blank anything on the server. That is no longer true: `toListingUpdate` sends
       whatever the form holds, so an unrestored field would go back as an erase on the first edit
       the owner made for an unrelated reason. Anything added to the write contract has to be added
       here in the same change. */
    bathrooms: vm.bath == null ? '' : String(vm.bath),
    parkingSpaces: vm.parkingSpaces == null ? '' : String(vm.parkingSpaces),
    balconies: vm.balconies == null ? '' : String(vm.balconies),
    electricityConsumerNo: vm.electricityConsumerNo || '',
    pincode: vm.pincode || '',
    // A saved listing has real coordinates; the hook reads these to mark the pin as placed.
    ...(vm.lat != null && vm.lng != null ? { propLat: vm.lat, propLng: vm.lng } : {}),
  };
}

/* A whole number, or nothing. Never `null`: the contract reads an explicit null as "clear this
   field", so a value we failed to parse must be omitted rather than sent — otherwise a stray 'N/A'
   or an empty select does not fail the write, it erases whatever the listing already had. */
const int = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : undefined);

/* The same, but treating 0 as unstated rather than as an answer.
   ---------------------------------------------------------------
   Only for fields where zero is not a thing the world contains. `submit.js` builds its flat spec
   fields as `parseInt(x, 10) || 0`, so a question the wizard never asked arrives here as 0 rather
   than as blank — and a building with zero floors in it is not a listing with an unusual answer,
   it is a listing that was never asked. The contract says so too (`@Min(1)` on totalFloors), so
   forwarding the sentinel is a 422 on a field the owner never saw, which surfaces as a submit
   button that does nothing.

   Deliberately NOT used for bathrooms, parking or balconies: a studio with a shared bathroom and
   no parking slot is real, the CHECK on those columns is `>= 0`, and collapsing their zero would
   silently rewrite an owner's answer into silence. */
const posInt = (v) => (int(v) || undefined);

/* The wizard asks for an age band; the column stores whole years. The lower bound is a lossless
   encoding here because the bands are contiguous with distinct floors, so the band is recoverable
   from the integer and a round-trip through the API does not move the answer.

   `under-construction` maps to nothing on purpose. It is not an age — the building does not have
   one yet — it is a possession state, and `possession` already carries it. Sending 0 would claim
   the property is newly completed, which is a different and more attractive thing than not built. */
const AGE_BAND_TO_YEARS = {
  new: 0, '1-5': 1, '5-10': 5, '10-15': 10, '15+': 15,
};
const ageToYears = (band) => (band === 'under-construction' ? undefined : AGE_BAND_TO_YEARS[band]);

/** The inverse, for `toEditForm`: the band whose floor the stored year falls into. */
export function yearsToAgeBand(years) {
  if (!Number.isFinite(Number(years))) return '';
  const y = Number(years);
  if (y >= 15) return '15+';
  if (y >= 10) return '10-15';
  if (y >= 5) return '5-10';
  if (y >= 1) return '1-5';
  return 'new';
}

export function toListingCreate(listing = {}) {
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
    // The wizard's own value, in the contract's spelling. `semi` is rejected with a 422 whose field
    // message the owner cannot act on, so the rename has to happen here rather than at the form.
    furnishing: translateFurnishing(FURNISHING_TO_WIRE, listing.furnishing, 'for write'),
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
    // The five duplicate-detection inputs (D218, D245). The wizard has always collected these —
    // they fed a browser-side dedup check that could only ever see the listings on this one
    // machine. They go to the server now, where the same question is asked against everybody's
    // listings.
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
    /* Perceptual hashes of the photographs, computed in the browser (D245). The fifth signal, and
       the only one the wizard already computed and then dropped on the floor here: `hashPhotos`
       has been running on every submission since the feature shipped, the result reached
       `forTheWire` on the record, and this function did not pick the key — so against the live API
       the photo arm had never once fired for anybody. It matched only against the listings this
       browser happened to hold, which for a real owner is the seeded demo catalogue.

       Hashes rather than the images because hashing pixels needs a canvas, and at this point in the
       wizard nothing has been uploaded yet — the server has never seen these files. The value is
       the same 16-hex aHash the client already compares with (`imageHash.js`), so client and server
       are reading the same 64 bits.

       Omitted rather than sent empty when nothing decoded, because on a PATCH an empty array is a
       statement — it clears the stored hashes — and a rent edit that happened to carry no photos
       must not blank the evidence. */
    photoHashes: Array.isArray(listing.photoHashes) && listing.photoHashes.length
      ? listing.photoHashes
      : undefined,
    /* The five detail answers the wizard collects and this function used to throw away (D244).
       There was no bug report for this because there is no symptom to report: the POST succeeds,
       the listing appears, and the Facing / Age / Floors / Bathrooms tiles on its own detail page
       are simply empty forever. The owner has no way to tell that the value they typed stopped
       here rather than at the server.

       `int()` rather than a bare `Number()` for the same reason `floor` above is guarded: NaN
       serialises to `null`, and the contract reads null as "clear this field", so a stray 'N/A'
       would not fail — it would erase. Omit when we do not know. */
    bathrooms: int(listing.bathrooms),
    parking: int(listing.parkingSpaces),
    balconies: int(listing.balconies),
    facing: listing.facing || undefined,
    totalFloors: posInt(listing.totalFloors),
    ageYears: ageToYears(listing.age),
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
