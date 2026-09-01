/**
 * HTTP property provider — the live counterpart to `providers/mock/propertyProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock provider exactly, because
 * `services/propertyService.js` is the only contract between them and no page may care which one is
 * active. Shape translation lives in `propertyMapper.js`, kept separate so the mapping is testable
 * and reviewable on its own.
 *
 * **Not everything the mock does has a server counterpart yet.** The catalogue slice shipped public
 * search/detail plus the owner write path; the moderation slice added the queue and the four
 * decisions. What remains mock-only is named at each call site rather than silently no-oped — a
 * write that lands in a different store than the reads come from produces a UI that contradicts
 * itself on the next refresh, which is far harder to diagnose than a thrown error.
 */
import { del, get, patch, post } from '../../http.js';
import {
  toListingCreate,
  toListingUpdate,
  toModerationQuery,
  toQuery,
  toViewModel,
  toViewModelList,
  unsupportedFilters,
} from './propertyMapper.js';

/**
 * The mock returns every matching row; the API pages. Callers like Compare, Societies and the admin
 * tables aggregate over the whole result set client-side, so a silent cap would show subtly wrong
 * numbers rather than an obvious failure.
 *
 * **100 because that is the server's actual ceiling** — `spring.data.web.pageable.max-page-size=100`
 * clamps anything larger. This constant read 500 before the moderation slice, which meant every
 * request silently returned at most 100 rows while `warnIfTruncated` compared against 500 and stayed
 * quiet for everything between the two. The guard that existed to make the ceiling audible was
 * itself muted by the ceiling it was guarding.
 */
const PAGE_SIZE = 100;

/**
 * Public search, or the moderation queue when the caller asks for rows the public floor cannot
 * return.
 *
 * The two are one method because `propertyService.listProperties` is one method and no page may care
 * which endpoint answered. The branch is on the *filters*, not on the session: `/admin/properties`
 * needs a staff token, a consumer page never sets these flags, and an ops page always does.
 */
/**
 * Public, anonymous search. Always floored to approved + non-archived server-side.
 *
 * The admin widenings are **not** honoured here and warn instead — see {@link listForModeration},
 * which is a different endpoint behind a different authorization.
 */
export async function listProperties(filters = {}, sort = 'newest') {
  warnUnsupported(filters);
  const page = await get('/properties', { ...toQuery(filters, sort), size: PAGE_SIZE }, { auth: false });
  warnIfTruncated(page);
  return toViewModelList(page);
}

/**
 * `GET /admin/properties` — every listing at every status, including archived. Staff/admin only.
 *
 * **A separate operation rather than a flag on {@link listProperties}, and the distinction is
 * load-bearing.** The first cut of this slice inferred the routing from the filters — if a caller
 * passed `includeAllStatuses` or `includeArchived`, the request went to the moderation queue — on
 * the reasoning that "a consumer page never sets those". That was simply false:
 * `useDashboardData.js` passes `includeAllStatuses: true` to fetch a catalogue to resolve visit
 * titles against, and every owner opening their dashboard was sent to a staff-only endpoint and got
 * a 403.
 *
 * It is the same rule the server applies one layer down, where `PropertySpecs.adminSearch` is a
 * separate method rather than a boolean on `publicSearch`: an authorization-relevant routing
 * decision must be *named by the caller*, never inferred from an ambiguous flag. Reaching the queue
 * now requires asking for it, and every caller can be found by grep.
 */
export async function listForModeration(filters = {}, sort = 'newest') {
  const page = await get('/admin/properties', { ...toModerationQuery(filters, sort), size: PAGE_SIZE });
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
 * The three trust numbers, counted by the database over the whole live catalogue.
 *
 * No client-side arithmetic and no fallback: an unknown locality answers zeroes rather than 404, so
 * there is no not-found case to translate, and a genuine failure should surface rather than be
 * papered over with a plausible-looking number.
 */
export async function trustStats(localitySlug) {
  return get('/properties/trust-stats', localitySlug ? { locality: localitySlug } : null, { auth: false });
}

/**
 * The public seller card. `null` for an unknown, malformed or archived owner, matching `getProperty`
 * — the page already renders a not-found state off a falsy result, and all three are the same fact
 * from the visitor's side.
 *
 * The response is deliberately narrow: id, name, masked mobile, verified, city, member-since year
 * and a live listing count. The mock handed the page the entire user row; anything the page reads
 * beyond these seven fields is something that used to arrive by accident.
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
 * One owner's live stock, as cards.
 *
 * A facet on the ordinary public search rather than a route of its own, which is what makes the
 * approved-and-unarchived floor, the paging and the card shape the same ones every other surface
 * gets. The mock returned `db.listings.filter(ownerId)` with no status filter at all, so an owner's
 * page could show their own rejected and archived rows to a stranger.
 */
export async function ownerListings(id) {
  const page = await get('/properties', { owner: id, size: PAGE_SIZE }, { auth: false });
  warnIfTruncated(page);
  return toViewModelList(page);
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
 * `POST /admin/properties` — a listing taken over the phone, owned by the person on the phone.
 *
 * Not `addListing` with a couple of extra fields, and the difference is the whole point.
 * `/me/listings` attributes what it creates to the **caller**, so posting a concierge listing
 * through it against this API produced a listing owned by the staff member who typed it: the owner
 * could not see it in their own dashboard, could not claim it, and the "awaiting owner" queue was
 * waiting on somebody who had never been given anything. `postedByAdmin: true` and
 * `postedByStaff: <name>` travelled in that body and were dropped on the floor, because a client
 * does not get to say who owns a record or who acted.
 *
 * This route takes the owner's **mobile** as the identity — the operator is on a call with somebody
 * who has never signed in, so the number they are calling from is the only handle that exists — and
 * the server provisions or finds the account behind it. `ownerName` is used only if the account has
 * to be created; for one that already exists it is ignored, so an operator's transcription of a
 * name heard over a phone call cannot overwrite what the owner typed themselves.
 *
 * `postedByStaff` comes back as the caller's user **id**, set server-side. Nothing sends it.
 *
 * Guarded by `postOnBehalf:write` rather than `properties:write`: this is the one route where the
 * caller names somebody else as the owner of what they create.
 */
export async function createListingOnBehalf(ownerMobile, ownerName, listing) {
  return toViewModel(await post('/admin/properties', {
    ownerMobile,
    ownerName: ownerName || undefined,
    listing: toListingCreate(listing),
  }));
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
 * The owner answers the freshness nudge (V86).
 *
 * Its own endpoint rather than a field on the edit above, because an edit can revert a listing to
 * `pending` and confirming availability must never do that — an owner answering the nudge would
 * otherwise take their own listing out of search to do it. No body: the path says the only thing
 * this call can say, and the date it records is the server's.
 */
export async function confirmListingFresh(id) {
  return toViewModel(await post(`/me/listings/${encodeURIComponent(id)}/confirm-available`, {}));
}

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

// ─── Admin moderation ──────────────────────────────────────────────────────────────────────────

/**
 * All four decisions resolve with **no value**, and that is the contract's design rather than a gap
 * in this provider: `setPropertyStatus`, `toggleFeatured`, `flagProperty` and `clearFlag` each
 * declare a bare `200`/`204` with no schema, on the reasoning that a moderator can predict the
 * effect of the request they sent and the UI re-reads the queue afterwards anyway.
 *
 * Echoing the row back would mean a second round trip per action, and the obvious one —
 * `GET /properties/{id}` — is unusable here: it enforces the public floor, so it 404s for pending,
 * rejected, flagged and archived listings, i.e. for the result of every action on this list. The
 * moderation queue has no by-id route, so the only faithful re-read is the list refresh the caller
 * already performs.
 *
 * **The mock returns the updated record.** Nothing may depend on that: a caller which reads the
 * resolved value works on mocks and silently reads `undefined` against the API, which is precisely
 * the class of bug the seam exists to prevent. `propertyService` documents these four as
 * "resolves when applied, throws on failure" for both providers.
 */
export async function setListingStatus(id, status, reason) {
  // `reason` is recorded on the audit row and is what makes a rejection reviewable afterwards.
  // The server accepts only `pending | approved | rejected` and answers 400 otherwise: `flagged`
  // belongs to `flagListing` (which also records why) and `archived` to `archiveListing`
  // (owner-or-staff, a different authorization). Routing either through here would be a second,
  // reason-less way to do something the API already models properly.
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
 * Clear a flag. **Sets status to `approved` unconditionally** — it does not restore the status the
 * listing held before it was flagged, so a `pending` listing that is flagged and then cleared
 * reaches `approved` without ever passing the verification queue. That is the server's documented
 * behaviour, and the mock's "clear flag & publish" happens to match it, so the seam passes it
 * through rather than simulating a restore the API cannot perform.
 */
export async function clearFlag(id) {
  await del(`/properties/${encodeURIComponent(id)}/flag`);
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
 * Make the page ceiling audible. Compares against what actually came back rather than against
 * {@link PAGE_SIZE}: the server clamps the requested size to its own maximum, so a constant that
 * drifts above that maximum silences this warning for every result set between the two — which is
 * exactly what happened while `PAGE_SIZE` was 500 and the server's ceiling was 100.
 */
function warnIfTruncated(page) {
  const returned = page?.content?.length ?? 0;
  if ((page?.totalElements ?? 0) > returned) {
    console.warn(
      `[property] ${page.totalElements} listings matched but only ${returned} were fetched. ` +
        'Client-side aggregates (Societies, Locality, Compare, LocationInsights) and the admin ' +
        'tables are now reading a partial catalogue and need server-side aggregates or paging.',
    );
  }
}
