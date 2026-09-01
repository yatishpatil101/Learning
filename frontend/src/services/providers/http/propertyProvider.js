/**
 * HTTP property provider.
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
 * `GET /properties` with the full listings facet set, one real page at a time.
 *
 * **A separate operation from {@link listProperties}, deliberately**, for the same reason
 * {@link listForModeration} is: `listProperties` has a dozen callers that want "the catalogue as an
 * array" and aggregate over it, and changing its return shape to a page envelope would change all
 * of them at once. This one answers a different question — "one page of a filtered search, and how
 * big is the whole match" — and only the listings page asks it.
 *
 * Returns the three facts the results header needs and cannot derive from a page:
 * `total` (the whole match, for the count and the pager) and `verifiedTotal` (the verified subset of
 * the whole match, counted by the database — see `PropertySearchResponse`), alongside the page's
 * own `items`. Reading either off `items.length` is the bug this endpoint shape exists to prevent.
 */
export async function searchListings(query = {}, { page = 1, size = 24 } = {}) {
  const res = await get(
    '/properties',
    { ...query, page: Math.max(0, page - 1), size },
    { auth: false },
  );
  return {
    items: toViewModelList(res),
    total: res?.totalElements ?? 0,
    verifiedTotal: res?.verifiedElements ?? 0,
    pageCount: res?.totalPages ?? 0,
  };
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

/**
 * `GET /admin/properties` as a page envelope — one real page, plus how big the whole match is.
 *
 * **Why this exists beside {@link listForModeration}.** It is the same split, for the same reason,
 * as {@link searchListings} beside {@link listProperties}: a dozen callers want "the queue as an
 * array", and the console needs "one page, and the size of the match". Reading the total off
 * `items.length` is the bug this shape exists to prevent — and on this endpoint it was not
 * hypothetical. The console rendered `of ${rows.length} listings` next to its search box, which on
 * a catalogue larger than `PAGE_SIZE` is the *page cap* wearing the word "listings": it read
 * "of 100" against 207 real rows and would have read "of 100" against a million.
 *
 * `q` is forwarded to the server, which is the substantive half. The console used to filter the
 * fetched page in the browser, so a moderator searching for anything outside the newest hundred
 * got "No listings match your filters" — a confident empty on a listing that exists, which is the
 * one answer a moderation search must never give.
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
 * `GET /admin/properties/summary` — the console's headline counts, over every listing.
 *
 * Unfiltered by design; see `PropertyModerationSummary` on the server, which spells out why a KPI
 * strip that followed the search box would just be a second copy of the table's row count.
 *
 * This endpoint shipped complete — with that rationale written in the past tense, as though the
 * console had already been moved onto it — and nothing in the frontend referenced it. The strip
 * went on counting the rows the queue fetch happened to return, so on a 207-listing catalogue
 * whose newest hundred rows were all pending it painted **Active 0, Flagged 0, Featured 0** over
 * 54 approved, 4 flagged and 5 featured listings. Three confident zeroes, each of them an
 * all-clear nobody issued.
 */
export async function moderationSummary() {
  return get('/admin/properties/summary');
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

/**
 * `GET /me/listings/{id}` — one of the caller's own listings, in full.
 *
 * This exists for the edit form, and the reason it has to exist is that the form used to prefill
 * from `lib/store`'s `getListing(id)`. On a live build that key holds whatever *this browser*
 * happened to write, so an owner opening the editor on a second device — or after clearing site
 * data, or from the "Add photos" link on an enquiry, which is reached from a server-side id —
 * was handed an empty form for a listing that was not empty, and submitting it would have sent
 * the defaults over the top of their real record.
 *
 * Owner-scoped rather than a `getProperty` read: a listing under moderation is not on the public
 * endpoint at all, and the public view model is the one built for buyers — it omits precisely the
 * fields the editor needs back. A non-owner gets a 404 here by design, because existence is itself
 * information (`MeListingsController.getMine`).
 *
 * Resolves `null` for a listing that is not the caller's, so the form can say so rather than
 * throwing at the top of a screen the owner navigated to deliberately.
 */
export async function myListing(id) {
  if (!id) return null;
  try {
    const vm = toViewModel(await get(`/me/listings/${encodeURIComponent(id)}`));
    /* Carries its own `form` snapshot, because that is the shape the caller reads. The mock resolves
       a stored record which has one already; a server row has the contract's field names instead,
       and the wizard's `listing.form || listing` fallback would then prefill from keys that mostly
       do not exist — `type` for `propertyType`, `desc` for `description`, `"2 BHK"` for `"2"`.
       Synthesising it here keeps the two providers the same shape, which is the seam's whole job. */
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
 * `POST /me/listings/duplicate-check` — "have I already listed this?", answered over the caller's
 * real listings instead of whatever this browser is holding.
 *
 * The address is composed here by the **same** expression `toListingCreate` uses, and that is not a
 * stylistic echo: the server normalises the string it is given into the comparison key, so a
 * three-part line here and a four-part line on the create normalise to two different keys and the
 * pre-check would answer about a property the submission is not about. Reusing `toListingCreate` and
 * discarding the rest of the body would be the tidier-looking way to guarantee it, but that body
 * requires `title`/`deal`/`price`, none of which the check needs or the schema declares.
 *
 * `POST` on a read because the body carries the electricity meter number — the one field on a
 * listing that names a real-world utility account, and not something to put in a query string.
 *
 * `mobile` is ignored: who is asking is the access token's business, and letting the caller name an
 * owner here would be an authorization decision made in the browser. It is in the signature only so
 * this matches the mock provider, which has no session to read.
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
 * `GET /admin/properties/owner-standing?mobile=…` — how much of their ceiling this owner is using.
 *
 * The other half of exempting {@link createListingOnBehalf} from the freemium cap. The desk may now
 * post past an owner's plan; this is what stops that being silent, so the operator can see they are
 * holding an upgrade conversation rather than discovering it from a billing report weeks later.
 *
 * Counts only — no plan name and no price. The operator needs to know a conversation exists, not
 * what the account is worth, and a desk that can read anybody's subscription off a phone number is
 * a larger disclosure than this feature is asking for.
 *
 * A number with no account is a **200 with `known: false`**, not a 404, because on this desk that
 * is the ordinary first call. A short or malformed number is a 400 — the caller should not ask
 * until the field is complete.
 */
export async function ownerListingStanding(mobile) {
  return get(`/admin/properties/owner-standing?mobile=${encodeURIComponent(mobile)}`);
}

/**
 * Every value `DuplicateCluster.reason` is allowed to take, and what the desk calls it.
 *
 * Enumerated rather than sampled. The wire vocabulary and the console's vocabulary overlap enough
 * here to be dangerous — both sides say "address" and "image" — so a missing member would look
 * mapped right up until a cluster matched on both arms and the badge rendered `undefined`.
 *
 * The prototype carried a fourth key, `image+address`, because it joined its reasons in encounter
 * order and could emit either permutation. The server sorts before joining, so that key would now
 * be unreachable; it is gone rather than kept "just in case", since a label nothing can produce is
 * a claim about the contract that is false.
 */
const DUPLICATE_REASON_FROM_WIRE = {
  address: 'same address / electricity meter',
  image: 'matching photos',
  'address+image': 'same address and matching photos',
};

/**
 * `GET /admin/properties/duplicates` — listings that look like the same doorway, grouped.
 *
 * Unpaged by design: a cluster is only meaningful whole, so there is no page boundary that could
 * fall inside one. What the endpoint returns instead is `truncated`, and this provider passes it
 * straight through rather than folding it away, because of how this particular read fails under a
 * cap. A truncated list looks short; a truncated *clustering* looks **clean** — if the scan ceiling
 * falls between two members of a real pair, the pair does not render as a partial cluster, it does
 * not render at all. An ops screen quietly reporting "supply looks clean" is the failure this whole
 * feature exists to prevent, so the flag reaches the UI and the UI says it out loud.
 *
 * `warnIfTruncated` is deliberately not used: it is for paged reads where the server's own page
 * metadata reveals the clamp. Here the server has already made the judgement and named it.
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
 * Translate one wire reason, degrading loudly rather than rendering a blank badge.
 *
 * An unrecognised value returns `undefined` so the caller can fall back to the raw string, and warns
 * naming the table to update — the failure a reader needs to see is "the server grew a reason the
 * console has never heard of", which is invisible if this silently returns the input.
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
 * `POST /admin/properties/duplicates/merge` — keep one listing, archive the others.
 *
 * The losers are named explicitly rather than derived server-side from the cluster. The operator's
 * screen and the server's next derivation are two moments apart, so a listing that joined the
 * cluster in between is one the operator never saw — and inferring the losers would archive it on
 * their behalf.
 *
 * Returns nothing. The caller re-reads the desk, because the merge changes which clusters exist and
 * the merged one is precisely the thing that no longer does.
 */
export async function mergeDuplicateCluster(keepId, dropIds) {
  await post('/admin/properties/duplicates/merge', { keepId, dropIds });
}

/**
 * `POST /admin/properties/duplicates/dismiss` — record that a cluster is a coincidence.
 *
 * Sends the member ids, never a signature. The server derives the signature from them, so there is
 * exactly one implementation of "what identifies this cluster"; a client computing its own would be
 * a second one, and the symptom of the two drifting would be dismissals that never match anything
 * and clusters that come back forever.
 *
 * The verdict is recorded against the set that was on screen. A cluster that later gains a member
 * is a different set and correctly resurfaces — the operator was never asked about the new listing.
 */
export async function dismissDuplicateCluster(ids) {
  await post('/admin/properties/duplicates/dismiss', { ids });
}

/**
 * Owner-scoped edit — `PATCH /me/listings/{id}`, so a non-owner gets a 404 by design (existence is
 * never confirmed to a stranger). Editing a foundation field (price/bhk/type/locality/deal) reverts
 * the listing to `pending` server-side, the same rule the mock implements in the UI.
 *
 * Staff correcting a listing they do not own want {@link updateListingAsModerator} instead. They
 * used to come through here, which worked on mocks — the mock store has no owner check — and 404'd
 * against the API for every listing the moderator did not happen to own, i.e. all of them.
 */
export async function updateListingFields(id, patchBody) {
  return toViewModel(await patch(`/me/listings/${encodeURIComponent(id)}`, toListingUpdate(patchBody)));
}

/**
 * `DELETE /me/listings/{id}` — the owner takes their own listing down.
 *
 * Not `archiveListing`, which is `PATCH /properties/{id}/archive` and is the *moderator's* route:
 * it takes a reason, because a listing pulled by staff owes the owner an explanation. An owner
 * withdrawing their own listing owes nobody one, and routing them through the staff path would mean
 * either inventing a reason on their behalf or storing a blank one on an audit row.
 *
 * Soft server-side — the row survives for the enquiries and deals that point at it, because a
 * listing is not only the owner's; buyers have contacted it. Returns the archived listing so the
 * dashboard can re-render the row from the answer rather than assuming what it now looks like.
 */
export async function takeListingDown(id) {
  return toViewModel(await del(`/me/listings/${encodeURIComponent(id)}`));
}

/**
 * `PATCH /properties/{id}/admin` — a moderator correcting somebody else's listing.
 *
 * Cross-owner and audited, and deliberately *not* a re-moderation trigger: the route leaves the
 * listing's status alone, because the person making the change is the person who would otherwise
 * have to re-approve it. Returns the listing with contacts revealed, so the same `toViewModel` the
 * owner path uses gives the console a row it can render without a second read.
 */
export async function updateListingAsModerator(id, patchBody) {
  return toViewModel(await patch(`/properties/${encodeURIComponent(id)}/admin`, toListingUpdate(patchBody)));
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

/**
 * Move a staff-posted listing along one of the two concierge funnels.
 *
 * `POST /properties/{id}/pipeline` **does** answer with the updated listing — unlike the four
 * decisions above — because the board that issues the call renders the stage it just set. The
 * resolved value is dropped here anyway, for the reason documented above: the mock cannot produce
 * a faithful `PropertyResponse`, so a caller reading this value would work against one provider
 * and not the other. The board re-reads its list after the call, as it already did.
 *
 * The server sorts the value onto the right column: a hand-back milestone lands in
 * `handback_milestone` and pins `pipeline_stage` at `docs_submitted`; an acquisition stage lands in
 * `pipeline_stage` and clears the milestone. Anything outside the eight is a 400, which includes
 * `under_review` and `live` — those are `status`, not stages.
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
 * Make the page ceiling audible. Compares against what actually came back rather than against
 * {@link PAGE_SIZE}: the server clamps the requested size to its own maximum, so a constant that
 * drifts above that maximum silences this warning for every result set between the two — which is
 * exactly what happened while `PAGE_SIZE` was 500 and the server's ceiling was 100.
 *
 * **`console.error`, not `console.warn`, and the list of consumers is no longer hand-maintained.**
 * Two things were wrong with the previous version, and they compounded.
 *
 * The first is that this reported a *correctness* failure at the severity of a style note. Every
 * spec in the suite asserts on console errors, and `e2e/helpers/console.js` drops anything whose
 * `type()` is not `'error'` — so the one detector that exists for a partial catalogue was, by
 * construction, invisible to the only thing that could have acted on it. It is an error now. It
 * still cannot fire against the seeded catalogue (38 approved listings, ceiling 100), so this
 * changes no result today; the point is that the day a fixture set crosses the ceiling, the suite
 * says so instead of quietly measuring the wrong thing.
 *
 * The second is that the message used to name its affected consumers explicitly — "Societies,
 * Locality, Compare, LocationInsights and the admin tables". That list was accurate when it was
 * written and has since gone stale: `pages/consumer/Notifications.jsx` aggregates over this result
 * to count saved-search matches (see register item 33 in tasks/DECISIONS-NEEDED.md) and was never
 * added. A hand-maintained list of callers inside a warning is a claim that grows false silently,
 * and it is worse than no list, because a reader who does not see their screen named will conclude
 * their screen is fine. The message now describes the *condition* and points at the register item,
 * which is a document that gets revised.
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
