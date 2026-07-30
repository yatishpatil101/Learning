/**
 * HTTP property provider — the live counterpart to `providers/mock/propertyProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock provider exactly, because
 * `services/propertyService.js` is the only contract between them and no page may care which one is
 * active. Shape translation lives in `propertyMapper.js`, kept separate so the mapping is testable
 * and reviewable on its own.
 *
 * **Not everything the mock does has a server counterpart yet.** The catalogue slice shipped public
 * search/detail plus the owner write path; admin moderation (approve/reject, feature, flag) is the
 * unshipped admin slice. Those methods throw a named, actionable error rather than silently writing
 * to `localStorage` — a write that lands in a different store than the reads come from produces a UI
 * that contradicts itself on the next refresh, which is far harder to diagnose than a thrown error.
 * Same convention as `httpAuthProvider.staffLogin`.
 */
import { get, patch, post } from '../../http.js';
import {
  toListingCreate,
  toListingUpdate,
  toQuery,
  toViewModel,
  toViewModelList,
  unsupportedFilters,
} from './propertyMapper.js';

/**
 * The mock returns every matching row; the API pages with a server default of 20. Callers like
 * Compare, Societies and LocationInsights aggregate over the whole result set client-side, so a
 * silent 20-row cap would show subtly wrong numbers rather than an obvious failure.
 *
 * Asking for one large page keeps those callers correct on a Pune-sized catalogue while staying
 * inside the server's sort whitelist and page-size ceiling. It is explicitly a bridge, not an
 * architecture: `warnIfTruncated` makes the ceiling audible the moment it is reached, which is the
 * signal to move those aggregates to server-side endpoints.
 */
const PAGE_SIZE = 500;

export async function listProperties(filters = {}, sort = 'newest') {
  warnUnsupported(filters);
  const page = await get('/properties', { ...toQuery(filters, sort), size: PAGE_SIZE }, { auth: false });
  warnIfTruncated(page);
  return toViewModelList(page);
}

export async function getProperty(id) {
  try {
    return toViewModel(await get(`/properties/${encodeURIComponent(id)}`, null, { auth: false }));
  } catch (err) {
    // The mock resolves to `null` for an unknown id and callers render a "not found" state off that.
    // A 404 is the same fact, so translate it rather than making every caller catch.
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
 * Exact match count, at any catalogue size, with no new endpoint: ask for the smallest possible page
 * and read `totalElements`, which the server computes over the full result set rather than the page.
 *
 * `size=1` rather than `size=0` because Spring rejects a zero page size; one row is the cheapest
 * legal request and the body is discarded.
 */
export async function countProperties(filters = {}) {
  warnUnsupported(filters);
  const page = await get('/properties', { ...toQuery(filters), size: 1 }, { auth: false });
  return page?.totalElements ?? 0;
}

/**
 * Resolve a known set of ids — the shape Saved / Compare / Notifications need, having stored ids
 * locally and wanting the listings back.
 *
 * There is no batch-get in the contract, so this is N parallel detail reads. That is deliberately
 * better than the alternative it replaces (fetch the entire catalogue and filter client-side): N is
 * bounded by what one user saved, whereas the catalogue is not bounded at all. Missing ids resolve
 * to `null` via `getProperty` and are dropped, because a listing the user saved can legitimately be
 * archived later and that must not blank the whole page.
 */
export async function getPropertiesByIds(ids = []) {
  const found = await Promise.all(ids.map((id) => getProperty(id)));
  return found.filter(Boolean);
}

/**
 * `GET /me/listings` — owner-scoped and status-complete, which public search deliberately is not.
 *
 * The `user` argument is ignored: ownership is the access token's, and letting the caller name an
 * owner here would be an authorization decision made in the browser. It is accepted only so the
 * signature matches the mock provider, which has no session to read.
 */
export async function myListings() {
  const page = await get('/me/listings', { size: PAGE_SIZE });
  warnIfTruncated(page);
  return toViewModelList(page);
}

export async function addListing(listing) {
  return toViewModel(await post('/me/listings', toListingCreate(listing)));
}

/**
 * Owner-scoped edit. The mock's admin callers also route through this; against the API it is
 * `/me/listings/{id}`, so a non-owner gets a 404 by design (existence is never confirmed to a
 * stranger). Editing a foundation field (price/bhk/type/locality/deal) reverts the listing to
 * `pending` server-side — the same rule the mock implements in the UI.
 */
export async function updateListingFields(id, patchBody) {
  return toViewModel(await patch(`/me/listings/${encodeURIComponent(id)}`, toListingUpdate(patchBody)));
}

/** Soft-delete. The mock's `deleteListing` is also non-destructive, so the semantics already match. */
export const deleteListing = (id) => archiveListing(id);

/**
 * Soft-delete with an optional reason (owner or staff/admin server-side).
 *
 * The reason is sent only when present: the endpoint takes an optional body, and posting
 * `{reason: undefined}` would serialise to `{}` anyway — but being explicit keeps the request
 * readable in the network tab, which is where this gets debugged.
 */
export async function archiveListing(id, reason) {
  const body = reason ? { reason } : {};
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/archive`, body));
}

/** Un-archive. The server resets status to `pending` for re-moderation, as the mock does. */
export async function restoreListing(id) {
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/restore`, {}));
}

// ─── Admin moderation: no endpoint yet ─────────────────────────────────────────────────────────

const notShipped = (fn, endpoint) => () => {
  throw new Error(
    `[property] ${fn}() has no live endpoint yet (needs ${endpoint}, part of the unshipped admin ` +
      'slice). Run admin flows with the property domain on mocks — remove "property" from ' +
      'VITE_API_DOMAINS — until the admin slice ships.',
  );
};

export const setListingStatus = notShipped('setListingStatus', 'PATCH /admin/properties/{id}/status');
export const toggleFeatured = notShipped('toggleFeatured', 'PATCH /admin/properties/{id}/featured');
export const flagListing = notShipped('flagListing', 'POST /admin/properties/{id}/flag');
export const clearFlag = notShipped('clearFlag', 'DELETE /admin/properties/{id}/flag');

// ─── Internals ────────────────────────────────────────────────────────────────────────────────

function warnUnsupported(filters) {
  const dropped = unsupportedFilters(filters);
  if (dropped.length) {
    console.warn(
      `[property] Filter(s) ${dropped.join(', ')} have no server-side equivalent and were not ` +
        'applied. `/properties` is public search only — it is hard-floored to approved + ' +
          'non-archived server-side, so status/moderation filters cannot be expressed until the ' +
          'admin slice ships.',
    );
  }
}

function warnIfTruncated(page) {
  if (page?.totalElements > PAGE_SIZE) {
    console.warn(
      `[property] ${page.totalElements} listings matched but only ${PAGE_SIZE} were fetched. ` +
        'Client-side aggregates (Societies, Locality, Compare, LocationInsights) are now reading a ' +
        'partial catalogue and need server-side aggregate endpoints.',
    );
  }
}
