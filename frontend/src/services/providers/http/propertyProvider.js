/**
 * HTTP property provider. Shape translation lives in `propertyMapper.js`; what the server does not
 * yet cover is named at each call site rather than silently no-oped.
 */
import { del, get, patch, post } from '../../http.js';
import {
  toEditForm,
  toListingCreate,
  toListingUpdate,
  toModerationQuery,
  toQuery,
  toViewModel,
  toViewModelList,
  unsupportedFilters,
} from './propertyMapper.js';

/**
 * **100 because that is the server's ceiling** (`spring.data.web.pageable.max-page-size`). Anything
 * larger here mutes `warnIfTruncated`, which is the guard that makes the ceiling audible.
 */
const PAGE_SIZE = 100;

/**
 * Public, anonymous search, floored to approved + non-archived server-side. Admin widenings warn
 * here rather than apply — those belong to {@link listForModeration}, a different authorization.
 */
export async function listProperties(filters = {}, sort = 'newest') {
  warnUnsupported(filters);
  const page = await get('/properties', { ...toQuery(filters, sort), size: PAGE_SIZE }, { auth: false });
  warnIfTruncated(page);
  return toViewModelList(page);
}

/**
 * One real page plus `total`/`verifiedTotal`, which cannot be derived from `items.length`. Separate
 * from {@link listProperties} on purpose; `signal` cancels superseded reads (`http.isAbort`).
 */
export async function searchListings(query = {}, { page = 1, size = 24, signal } = {}) {
  const res = await get(
    '/properties',
    { ...query, page: Math.max(0, page - 1), size },
    { auth: false, signal },
  );
  return {
    items: toViewModelList(res),
    total: res?.totalElements ?? 0,
    verifiedTotal: res?.verifiedElements ?? 0,
    pageCount: res?.totalPages ?? 0,
  };
}

/**
 * `GET /admin/properties` — a separate operation, never a flag on {@link listProperties}: routing
 * must not be inferred from filters, or a consumer page's widening 403s (docs/flows/consumer/search-listings.md).
 */
export async function listForModeration(filters = {}, sort = 'newest') {
  const page = await get('/admin/properties', { ...toModerationQuery(filters, sort), size: PAGE_SIZE });
  warnIfTruncated(page);
  return toViewModelList(page);
}

/**
 * The paged twin of {@link listForModeration}. `q` is forwarded to the server, never applied to the
 * fetched page, so a moderator is never told "no listings match" about a listing that exists.
 */
export async function searchForModeration(filters = {}, sort = 'newest', { page = 1, size = PAGE_SIZE } = {}) {
  const res = await get('/admin/properties', {
    ...toModerationQuery(filters, sort),
    page: Math.max(0, page - 1),
    size,
  });
  return {
    items: toViewModelList(res),
    total: res?.totalElements ?? 0,
    pageCount: res?.totalPages ?? 0,
  };
}

/**
 * `GET /admin/properties/summary` — unfiltered by design: a KPI strip that followed the search box
 * would be a second copy of the table's row count, and counting the page paints confident zeroes.
 */
export async function moderationSummary() {
  return get('/admin/properties/summary');
}

export async function getProperty(id) {
  try {
    return toViewModel(await get(`/properties/${encodeURIComponent(id)}`, null, { auth: false }));
  } catch (err) {
    // A 404 is the same fact as the `null` callers render their "not found" state off, so translate
    // it here rather than making every caller catch.
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function featuredProperties(limit = 6) {
  // The contract endpoint takes no limit — the strip is server-curated — so the cap is applied here
  // to keep the mock's signature meaningful.
  const list = await get('/properties/featured', null, { auth: false });
  return toViewModelList(list).slice(0, limit);
}

/**
 * The three trust numbers, counted by the database over the whole live catalogue. No client-side
 * arithmetic and no fallback: a genuine failure should surface, not be papered over with a number.
 */
export async function trustStats(localitySlug) {
  return get('/properties/trust-stats', localitySlug ? { locality: localitySlug } : null, { auth: false });
}

/**
 * The public seller card — `null` for an unknown, malformed or archived owner, which are one fact
 * from the visitor's side. Deliberately narrow: seven fields, nothing that arrives by accident.
 */
export async function ownerProfile(id) {
  try {
    return await get(`/owners/${encodeURIComponent(id)}`, null, { auth: false });
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * A facet on the ordinary public search, not a route of its own — which is what keeps the
 * approved-and-unarchived floor; without it an owner's page shows a stranger their rejected rows.
 */
export async function ownerListings(id) {
  const page = await get('/properties', { owner: id, size: PAGE_SIZE }, { auth: false });
  warnIfTruncated(page);
  return toViewModelList(page);
}

/**
 * Exact match count at any catalogue size: read `totalElements` off the smallest legal page.
 * `size=1` rather than `size=0` because Spring rejects a zero page size; the body is discarded.
 */
export async function countProperties(filters = {}) {
  warnUnsupported(filters);
  const page = await get('/properties', { ...toQuery(filters), size: 1 }, { auth: false });
  return page?.totalElements ?? 0;
}

/**
 * N parallel detail reads: N is bounded by what one user saved, the catalogue is not. Missing ids
 * drop out, because a saved listing can legitimately be archived and must not blank the page.
 */
export async function getPropertiesByIds(ids = []) {
  const found = await Promise.all(ids.map((id) => getProperty(id)));
  return found.filter(Boolean);
}

/**
 * `GET /me/listings` — owner-scoped and status-complete, which public search deliberately is not.
 * The `user` argument is ignored: ownership is the access token's, never the caller's to name.
 */
export async function myListings() {
  const page = await get('/me/listings', { size: PAGE_SIZE });
  warnIfTruncated(page);
  return toViewModelList(page);
}

/**
 * `GET /me/listings/{id}` — owner-scoped, so the edit form prefills from the server and a non-owner
 * gets a 404 by design. Resolves `null` rather than throwing: docs/flows/consumer/search-listings.md
 */
export async function myListing(id) {
  if (!id) return null;
  try {
    const vm = toViewModel(await get(`/me/listings/${encodeURIComponent(id)}`));
    /* Synthesise the `form` snapshot the caller reads: a server row carries the contract's field
       names, so the wizard's `listing.form || listing` fallback would prefill from keys that do not exist. */
    return vm && { ...vm, form: toEditForm(vm) };
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function addListing(listing) {
  return toViewModel(await post('/me/listings', toListingCreate(listing)));
}

/**
 * "Have I already listed this?", answered over the caller's real listings. The address is composed
 * by the **same** expression `toListingCreate` uses, and `POST` on a read carries the meter number.
 */
export async function checkOwnDuplicate({ fields } = {}) {
  const f = fields || {};
  const address = [f.flatNumber, f.tower, f.society, f.street]
    .map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');
  const verdict = await post('/me/listings/duplicate-check', {
    address: address || undefined,
    locality: f.locality || undefined,
    city: f.city || 'Pune',
    lat: f.propLat ?? undefined,
    lng: f.propLng ?? undefined,
    electricityMeterNo: f.electricityConsumerNo || undefined,
  });
  return { found: !!verdict?.found, existingId: verdict?.existingId ?? null };
}

/**
 * `POST /admin/properties` — the one route where the caller names somebody else as owner, keyed on
 * the owner's mobile and guarded by `postOnBehalf:write`: docs/flows/consumer/search-listings.md
 */
export async function createListingOnBehalf(ownerMobile, ownerName, listing) {
  return toViewModel(await post('/admin/properties', {
    ownerMobile,
    ownerName: ownerName || undefined,
    listing: toListingCreate(listing),
  }));
}

/**
 * How much of their ceiling this owner is using — counts only, no plan name or price, so the desk
 * sees an upgrade conversation exists without reading anybody's subscription off a phone number.
 */
export async function ownerListingStanding(mobile) {
  return get(`/admin/properties/owner-standing?mobile=${encodeURIComponent(mobile)}`);
}

/**
 * Enumerated, not sampled: both vocabularies say "address" and "image", so a missing member would
 * look mapped until a cluster matched on both arms and the badge rendered `undefined`.
 */
const DUPLICATE_REASON_FROM_WIRE = {
  address: 'same address / electricity meter',
  image: 'matching photos',
  'address+image': 'same address and matching photos',
};

/**
 * Unpaged — a cluster is only meaningful whole. `truncated` is passed straight through because a
 * truncated *clustering* looks clean, not short: docs/flows/consumer/search-listings.md
 */
export async function listDuplicateClusters() {
  const res = await get('/admin/properties/duplicates');
  return {
    clusters: (res?.clusters ?? []).map((c) => ({
      id: c.id,
      reason: c.reason,
      reasonLabel: duplicateReasonLabel(c.reason),
      sameOwner: !!c.sameOwner,
      listings: toViewModelList(c.listings ?? []),
    })),
    scanned: res?.scanned ?? 0,
    truncated: !!res?.truncated,
  };
}

/**
 * An unrecognised value returns `undefined` and warns, so "the server grew a reason the console has
 * never heard of" is visible — which it would not be if this quietly returned the input.
 */
function duplicateReasonLabel(reason) {
  if (!reason) return undefined;
  const label = DUPLICATE_REASON_FROM_WIRE[reason];
  if (!label) {
    console.warn(
      `[propertyProvider] unknown duplicate reason "${reason}" — add it to DUPLICATE_REASON_FROM_WIRE`,
    );
    return undefined;
  }
  return label;
}

/**
 * The losers are named explicitly, never derived server-side: a listing that joined the cluster
 * after the operator's screen was drawn would otherwise be archived on their behalf.
 */
export async function mergeDuplicateCluster(keepId, dropIds) {
  await post('/admin/properties/duplicates/merge', { keepId, dropIds });
}

/**
 * Sends member ids, never a signature: the server derives it, so there is exactly one definition of
 * "what identifies this cluster". A cluster that later gains a member is a different set.
 */
export async function dismissDuplicateCluster(ids) {
  await post('/admin/properties/duplicates/dismiss', { ids });
}

/**
 * Owner-scoped edit; a non-owner gets a 404 by design. Editing a foundation field reverts the
 * listing to `pending`. Staff correcting somebody else's want {@link updateListingAsModerator}.
 */
export async function updateListingFields(id, patchBody) {
  return toViewModel(await patch(`/me/listings/${encodeURIComponent(id)}`, toListingUpdate(patchBody)));
}

/**
 * The owner's own take-down, not `archiveListing` — the moderator's route takes a reason, and an
 * owner withdrawing their own listing owes nobody one. Soft server-side; returns the archived row.
 */
export async function takeListingDown(id) {
  return toViewModel(await del(`/me/listings/${encodeURIComponent(id)}`));
}

/**
 * Cross-owner and audited, and deliberately *not* a re-moderation trigger: the person making the
 * change is the person who would have to re-approve it. Returns the row with contacts revealed.
 */
export async function updateListingAsModerator(id, patchBody) {
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/admin`, toListingUpdate(patchBody)));
}

/** Soft-delete. The mock's `deleteListing` is also non-destructive, so the semantics already match. */
export const deleteListing = (id) => archiveListing(id);

/**
 * Its own endpoint rather than a field on the edit, because an edit can revert a listing to
 * `pending` — an owner answering the freshness nudge must not take their listing out of search.
 */
export async function confirmListingFresh(id) {
  return toViewModel(await post(`/me/listings/${encodeURIComponent(id)}/confirm-available`, {}));
}

/**
 * Soft-delete with an optional reason (owner or staff/admin server-side). The reason is sent only
 * when present, which keeps the request readable in the network tab where this gets debugged.
 */
export async function archiveListing(id, reason) {
  const body = reason ? { reason } : {};
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/archive`, body));
}

/** Un-archive. The server resets status to `pending` for re-moderation, as the mock does. */
export async function restoreListing(id) {
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/restore`, {}));
}

// ─── Admin moderation ──────────────────────────────────────────────────────────────────────────

/**
 * All four decisions resolve with **no value** — the contract declares a bare 200/204 and the UI
 * re-reads the queue. Nothing may depend on a resolved row: docs/flows/consumer/search-listings.md
 */
export async function setListingStatus(id, status, reason) {
  // `reason` is recorded on the audit row and is what makes a rejection reviewable afterwards. Only
  // `pending | approved | rejected` are accepted; `flagged` and `archived` have their own routes.
  const body = reason ? { status, reason } : { status };
  await patch(`/properties/${encodeURIComponent(id)}/status`, body);
}

/**
 * Toggle homepage merchandising. No precondition server-side — a pending or archived listing can be
 * marked featured; it simply will not surface, because the featured strip re-filters on approved.
 */
export async function toggleFeatured(id) {
  await post(`/properties/${encodeURIComponent(id)}/toggle-featured`, {});
}

/**
 * Raise a moderation flag. Sets status to `flagged` server-side, taking the listing off the public
 * site, and persists the reason to `flag_reason` (defaulted to "Flagged" when blank).
 */
export async function flagListing(id, reason) {
  await post(`/properties/${encodeURIComponent(id)}/flag`, { reason });
}

/**
 * Clear a flag. **Sets status to `approved` unconditionally** — a `pending` listing flagged then
 * cleared reaches `approved` without passing the verification queue. That is the server's behaviour.
 */
export async function clearFlag(id) {
  await del(`/properties/${encodeURIComponent(id)}/flag`);
}

/**
 * Move a staff-posted listing along a concierge funnel. The server sorts the value onto the right
 * column; anything outside the eight is a 400, including `under_review` and `live` (those are status).
 */
export async function setPipelineStage(id, stage) {
  await post(`/properties/${encodeURIComponent(id)}/pipeline`, { stage });
}

// ─── Internals ────────────────────────────────────────────────────────────────────────────────

function warnUnsupported(filters) {
  const dropped = unsupportedFilters(filters);
  if (dropped.length) {
    console.warn(
      `[property] Filter(s) ${dropped.join(', ')} have no server-side equivalent and were not ` +
        'applied. Freshness/dormancy is not modelled server-side yet.',
    );
  }
}

/**
 * Make the page ceiling audible, comparing against what came back rather than {@link PAGE_SIZE}.
 * **`console.error`, not `warn`** — `e2e/helpers/console.js` drops anything that is not an error.
 */
function warnIfTruncated(page) {
  const returned = page?.content?.length ?? 0;
  if ((page?.totalElements ?? 0) > returned) {
    console.error(
      `[property] ${page.totalElements} listings matched but only ${returned} were fetched. ` +
        'Every client-side aggregate over this result is now reading a partial catalogue and is ' +
        'silently wrong — counts, sums, "is X in the list" checks and any admin table that pages ' +
        'itself. See register item 33 in tasks/DECISIONS-NEEDED.md; the fix is server-side ' +
        'aggregates or real paging, not a larger page size.',
    );
  }
}
