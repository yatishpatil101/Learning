/** Shape translation lives in `propertyMapper.js`; what the server does not yet cover is named at each call site
 * rather than silently no-oped. */
import { PAGE_LOAD_TTL, del, get, patch, post } from '../../http.js';
import {
  toEditForm,
  toListingCreate,
  toListingUpdate,
  toModerationQuery,
  toQuery,
  toViewModel,
  toViewModelList,
  toWriteResult,
  unsupportedFilters,
} from './propertyMapper.js';
import { bootstrapSection } from './bootstrap.js';

/** **100 because that is the server's ceiling** (`spring.data.web.pageable.max-page-size`). Anything larger here
 * mutes `warnIfTruncated`, which is the guard that makes the ceiling audible. */
const PAGE_SIZE = 100;

/** Admin widenings warn here rather than apply — those belong to {@link listForModeration}, a different
 * authorization. */
export async function listProperties(filters = {}, sort = 'newest') {
  warnUnsupported(filters);
  const page = await get('/properties', { ...toQuery(filters, sort), size: PAGE_SIZE }, { auth: false });
  warnIfTruncated(page);
  return toViewModelList(page);
}

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
    unstatedTotal: res?.unstatedElements ?? 0,
    pageCount: res?.totalPages ?? 0,
  };
}

export async function listForModeration(filters = {}, sort = 'newest', { capDisclosed = false } = {}) {
  const page = await get('/admin/properties', { ...toModerationQuery(filters, sort), size: PAGE_SIZE });
  if (!capDisclosed) warnIfTruncated(page);
  return toViewModelList(page);
}

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

/** The command palette's property hits: six fields each, linked by slug when there is one. */
export async function lookupForModeration(q, { size = 6 } = {}) {
  const res = await get('/admin/properties/lookup', { q, page: 0, size });
  return {
    items: (res?.content ?? []).map((l) => ({ id: l.slug || l.id, title: l.title, locality: l.locality, owner: l.owner, status: l.status })),
    total: res?.totalElements ?? 0,
  };
}
/** `GET /admin/properties/summary` — unfiltered by design: a KPI strip that followed the search box would be a second
 * copy of the table's row count, and counting the page paints confident zeroes. */
export async function moderationSummary() {
  return get('/admin/properties/summary');
}

/** `GET /admin/properties/{id}` — the whole listing behind a queue row, by id or slug; `null` for an unknown one. */
export async function getModerationProperty(id) {
  try {
    return toViewModel(await get(`/admin/properties/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function getProperty(id) {
  try {
    // Deliberately NOT `auth: false`, unlike its siblings: the server answers an owner differently
    // (any status, raw contact number). Anonymous reads are unaffected — no token, nothing is sent.
    return toViewModel(await get(`/properties/${encodeURIComponent(id)}`));
  } catch (err) {
    // A 404 is the same fact as the `null` callers render their "not found" state off, so translate
    // it here rather than making every caller catch.
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function featuredProperties(limit = 6) {
  return toViewModelList(await get('/properties/featured', null, { auth: false })).slice(0, limit);
}

/** The three trust numbers, counted by the database over the whole live catalogue. No client-side arithmetic and no
 * fallback: a genuine failure should surface, not be papered over with a number. */
export async function trustStats() {
  return bootstrapSection('trustStats');
}

export async function propertyCounts() {
  return bootstrapSection('counts');
}

export async function ownerProfile(id) {
  try {
    return await get(`/owners/${encodeURIComponent(id)}`, null, { auth: false });
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/** A facet on the ordinary public search, not a route of its own, which keeps the approved-and-unarchived floor;
 * without it an owner's page would show a stranger their rejected rows. */
export async function ownerListings(id) {
  const page = await get('/properties', { owner: id, sort: 'createdAt,desc', size: 12 }, { auth: false });
  return toViewModelList(page);
}

/** `size=1` rather than `size=0` because Spring rejects a zero page size; the body is discarded. */
export async function countProperties(filters = {}) {
  warnUnsupported(filters);
  const page = await get('/properties', { ...toQuery(filters), size: 1 }, { auth: false });
  return page?.totalElements ?? 0;
}

/** Missing ids drop out, because a saved listing can legitimately be archived and must not blank the page. */
export async function getPropertiesByIds(ids = []) {
  const found = await Promise.all(ids.map((id) => getProperty(id)));
  return found.filter(Boolean);
}

function inAskedOrder(wanted, rows) {
  const byId = new Map(rows.flatMap((p) => [[p.id, p], [p.uuid, p]]));
  return wanted.map((id) => byId.get(id)).filter(Boolean);
}

/** Cards for up to 16 slugs or UUIDs in one read, in the order asked; ids not publicly live drop out. */
export async function listPropertiesByIds(ids = []) {
  const wanted = ids.slice(0, 16);
  if (!wanted.length) return [];
  return inAskedOrder(wanted, toViewModelList(await get('/properties/cards', { ids: wanted }, { auth: false })));
}

/** Compare-table rows for up to four slugs or UUIDs; ids not publicly live drop out. */
export async function compareProperties(ids = []) {
  const wanted = ids.slice(0, 4);
  if (!wanted.length) return [];
  return inAskedOrder(wanted, toViewModelList(await get('/properties/compare', { ids: wanted }, { auth: false })));
}

export const searchIndex = () => get('/properties/search-index', null, { auth: false });

export const propertyReels = (query) => get('/properties/reels', query, { auth: false });

export async function similarProperties(query) {
  const rows = await get('/properties/similar', query, { auth: false });
  return (rows || []).map((r) => ({ ...toViewModel(r), _km: r.distanceKm }));
}

/** The `user` argument is ignored: ownership is the access token's, never the caller's to name. */
export async function myListings() {
  const page = await get('/me/listings', { size: PAGE_SIZE }, { ttl: PAGE_LOAD_TTL });
  warnIfTruncated(page);
  return toViewModelList(page);
}

/** `GET /me/listings/{id}/card` — one My Listings row, the re-read after an action that moved it. */
export async function myListingCard(id) {
  return toViewModel(await get(`/me/listings/${encodeURIComponent(id)}/card`));
}

/** `GET /me/listings/{id}` — owner-scoped, so the edit form prefills from the server and a non-owner gets a 404 by
 * design. Resolves `null` rather than throwing: docs/flows/consumer/search-listings.md */
export async function myListing(id) {
  if (!id) return null;
  try {
    const vm = toViewModel(await get(`/me/listings/${encodeURIComponent(id)}`));
    if (!vm) return vm;
    const form = toEditForm(vm);
    if (vm.societyId && vm.societyName) form.society = vm.societyName;
    /* Synthesise the `form` snapshot the caller reads: a server row carries the contract's field
       names, so the wizard's `listing.form || listing` fallback would prefill from keys that do not exist. */
    return { ...vm, form };
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function addListing(listing) {
  return toWriteResult(await post('/me/listings', toListingCreate(listing)));
}

export const listingSlots = () => get('/me/listings/quota');

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

export async function createListingOnBehalf(ownerMobile, ownerName, listing) {
  return toViewModel(await post('/admin/properties', {
    ownerMobile,
    ownerName: ownerName || undefined,
    listing: toListingCreate(listing),
  }));
}

/** How much of their ceiling this owner is using — counts only, no plan name or price, so the desk sees an upgrade
 * conversation exists without reading anybody's subscription off a phone number. */
export async function ownerListingStanding(mobile) {
  return get(`/admin/properties/owner-standing?mobile=${encodeURIComponent(mobile)}`);
}

/** Enumerated, not sampled: both vocabularies say "address" and "image", so a missing member would look mapped until
 * a cluster matched on both arms and the badge rendered `undefined`. */
const DUPLICATE_REASON_FROM_WIRE = {
  address: 'same address / electricity meter',
  image: 'matching photos',
  'address+image': 'same address and matching photos',
};

/* Duplicate clusters are meaningful only whole; pass through truncation so it is visible. */
export async function listDuplicateClusters() {
  const res = await get('/admin/properties/duplicates');
  return {
    clusters: (res?.clusters ?? []).map((c) => ({
      id: c.id,
      reason: c.reason,
      reasonLabel: duplicateReasonLabel(c.reason),
      sameOwner: !!c.sameOwner,
      hints: (c.hints ?? []).map((h) => ({
        code: h?.code || '',
        severity: h?.severity === 'hard' ? 'hard' : 'soft',
        detail: h?.detail || '',
      })),
      listings: toViewModelList(c.listings ?? []),
    })),
    scanned: res?.scanned ?? 0,
    truncated: !!res?.truncated,
  };
}

/** An unrecognised value returns `undefined` and warns, so "the server grew a reason the console has never heard of"
 * is visible — which it would not be if this quietly returned the input. */
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

/** The losers are named explicitly, never derived server-side: a listing that joined the cluster after the operator's
 * screen was drawn would otherwise be archived on their behalf. */
export async function mergeDuplicateCluster(keepId, dropIds) {
  await post('/admin/properties/duplicates/merge', { keepId, dropIds });
}

export async function dismissDuplicateCluster(ids) {
  await post('/admin/properties/duplicates/dismiss', { ids });
}

export async function updateListingFields(id, patchBody) {
  return toWriteResult(await patch(`/me/listings/${encodeURIComponent(id)}`, toListingUpdate(patchBody)));
}

export async function takeListingDown(id) {
  return toWriteResult(await del(`/me/listings/${encodeURIComponent(id)}`));
}

export async function pauseListing(id) {
  return toViewModel(await post(`/me/listings/${encodeURIComponent(id)}/pause`, {}));
}

export async function resumeListing(id) {
  return toViewModel(await post(`/me/listings/${encodeURIComponent(id)}/resume`, {}));
}

/** Cross-owner and audited, and deliberately *not* a re-moderation trigger: the person making the change is the
 * person who would have to re-approve it. Returns the row with contacts revealed. */
export async function updateListingAsModerator(id, patchBody) {
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/admin`, toListingUpdate(patchBody)));
}

/** Soft-delete. Nothing is destroyed — "delete" is the owner's word for archiving. */
export const deleteListing = (id) => archiveListing(id);

/** Its own endpoint rather than a field on the edit, because an edit can revert a listing to `pending` — an owner
 * answering the freshness nudge must not take their listing out of search. */
export async function confirmListingFresh(id) {
  return toViewModel(await post(`/me/listings/${encodeURIComponent(id)}/confirm-available`, {}));
}

/** `POST /me/listings/{id}/opened` — the owner arrived through a claim link; the server keeps the first open. */
export async function recordClaimLinkOpened(id) {
  await post(`/me/listings/${encodeURIComponent(id)}/opened`, {});
}

/** `POST /me/listings/{id}/confirm` — the owner vouches for a staff-posted listing; publishing waits for it. */
export async function confirmOwnerListing(id) {
  await post(`/me/listings/${encodeURIComponent(id)}/confirm`, {});
}

/** The reason is sent only when present, which keeps the request readable in the network tab where this gets
 * debugged. */
export async function archiveListing(id, reason) {
  const body = reason ? { reason } : {};
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/archive`, body));
}

/** Un-archive. The server resets status to `pending` for re-moderation. */
export async function restoreListing(id) {
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/restore`, {}));
}

/* Moderation decisions return no row; the UI must re-read the queue after 200/204. */
export async function setListingStatus(id, status, reason) {
  const opts = typeof reason === 'object' && reason !== null ? reason : { reason };
  // `reason` is recorded on the audit row and is what makes a rejection reviewable afterwards. Only
  // `pending | approved | rejected` are accepted; `flagged` and `archived` have their own routes.
  const body = Object.fromEntries(Object.entries({
    status,
    reason: opts.reason,
    reasonCode: opts.reasonCode,
    expectedStatus: opts.expectedStatus,
  }).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  await patch(`/properties/${encodeURIComponent(id)}/status`, body);
}

export async function flagListing(id, reason) {
  await post(`/properties/${encodeURIComponent(id)}/flag`, { reason });
}

/** **Sets status to `approved` unconditionally** — a `pending` listing flagged then cleared reaches `approved`
 * without passing the verification queue. That is the server's behaviour. */
export async function clearFlag(id) {
  await del(`/properties/${encodeURIComponent(id)}/flag`);
}

function warnUnsupported(filters) {
  const dropped = unsupportedFilters(filters);
  if (dropped.length) {
    console.warn(
      `[property] Filter(s) ${dropped.join(', ')} have no server-side equivalent and were not ` +
        'applied. Freshness/dormancy is not modelled server-side yet.',
    );
  }
}

/* Use console.error for truncation because e2e console capture drops warnings. */
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
