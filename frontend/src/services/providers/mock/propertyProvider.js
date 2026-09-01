/**
 * Mock property provider — wraps mockApi.js and properties-admin.js
 * All functions return Promises (mockApi already does; admin functions wrapped).
 */
import {
  listProperties as _listProperties,
  getProperty as _getProperty,
  featuredProperties as _featuredProperties,
  verifiedStats as _verifiedStats,
  getOwner as _getOwner,
  addListing as _addListing,
  setListingStatus as _setListingStatus,
  toggleFeatured as _toggleFeatured,
  setPipelineStage as _setPipelineStage,
  confirmListingFresh as _confirmListingFresh,
} from '../../../lib/mockApi.js';

import {
  flagListing as _flagListing,
  clearFlag as _clearFlag,
  deleteListing as _deleteListing,
  updateListingFields as _updateListingFields,
  archiveListing as _archiveListing,
  restoreListing as _restoreListing,
  digits,
} from '../../../lib/data/properties-admin.js';
import { myOwnerId, ownerIdOfProperty } from '../../../lib/data/ownerIdentity.js';
import { enrichWithVerification } from '../../../lib/data/enrichProperties.js';
import { enrichRent } from '../../../lib/listings/enrichRent.js';
import { matchesFacetQuery } from '../../../lib/listings/facetMatch.js';
import { sortByQuery } from '../../../lib/listings/facetRank.js';
import { evaluateListingDedup } from '../../../lib/data/propertyIdentity.js';
import { currentStaffInfo } from '../../../lib/mockApi/core.js';
import { PLAN_LISTING_LIMITS } from '../../../lib/store/billing.js';
import { ApiError } from '../../http.js';

// Already async (returns Promise)
export const listProperties = _listProperties;
export const getProperty = _getProperty;
export const featuredProperties = _featuredProperties;

/**
 * The mock's long-standing `verifiedStats`, renamed to the seam's vocabulary.
 *
 * Async to match the provider contract even though the mock answers synchronously — the whole point
 * of the seam is that the caller cannot tell which side it is talking to.
 */
export const trustStats = async (localitySlug) => _verifiedStats(localitySlug);

/**
 * The mock's owner card, narrowed to the fields the server actually publishes.
 *
 * `getOwner` spreads the whole user row — email, role, account status and all. Picking here rather
 * than passing it through is what makes the two providers interchangeable in the direction that
 * matters: a page developed against the mock cannot come to depend on a field the live API will
 * never send, which is exactly how this page ended up reading five things and receiving twenty.
 */
export const ownerProfile = async (id) => {
  const o = await _getOwner(id);
  if (!o) return null;
  return {
    id: o.id,
    name: o.name,
    mobile: o.mobile,
    verified: !!o.verified,
    city: o.city,
    memberSince: o.joinedAt ? Number(String(o.joinedAt).slice(0, 4)) : null,
    listingCount: (o.listings || []).filter((l) => l.status === 'approved' && !l.archived).length,
  };
};

/**
 * One owner's live stock.
 *
 * The status filter is applied here and not in `getOwner`, which returns every row this person has
 * ever posted. Left as it was, an owner's public page would show a stranger their rejected and
 * archived listings — and it did, until this seam was drawn.
 */
export const ownerListings = async (id) => {
  const o = await _getOwner(id);
  return (o?.listings || []).filter((l) => l.status === 'approved' && !l.archived);
};
export const addListing = _addListing;

/**
 * The mock counterpart of `POST /me/listings/duplicate-check`.
 *
 * Delegates to the same local scan the wizard used to run inline. Against the mock store that scan
 * is right — every listing in it belongs to the demo, the caller included — and it is the only
 * reading available, since there is no server here to ask. What changed is where it is called from:
 * behind the seam, so the wizard asks one question and gets the same answer shape either way.
 *
 * The self-arm is all `evaluateListingDedup` has left. It used to decide whether to *flag* a
 * submission against a different owner's claim too, and that half has moved to the server (D245),
 * where it belongs and where it can actually see other owners' listings — `ListingDuplicateProbe`,
 * on write, as an internal note the lister never sees. Reporting it to the lister is how a
 * duplicate probe turns into a lookup on somebody else's property, which is why the server's
 * duplicate-check *route* still has no such arm: it answers only "have I already listed this?".
 *
 * `mobile` is the caller's, because the mock store has no session to read; the http provider ignores
 * it and lets the token say who is asking.
 */
export const checkOwnDuplicate = async ({ mobile, fields } = {}) => {
  const { blocked, existingId } = evaluateListingDedup({ mobile, fields });
  return { found: !!blocked, existingId: blocked ? existingId : null };
};

/**
 * The mock counterpart of `POST /admin/properties`.
 *
 * The store has one flat `owner` name per listing and no accounts to provision, so the owner
 * identity the server derives from a mobile is simply written onto the record. What is reproduced
 * faithfully is the part that matters: **the caller does not get to name the staff member**.
 * `postedByStaff` is read from the session here, exactly as the server reads it from the token, so
 * a console that went back to passing a display name would break in demo mode too rather than only
 * against the API.
 *
 * `currentStaffInfo()` yields a name where the server yields a user id. The two disagree, and the
 * disagreement is confined to a field no screen renders — see the outreach provider's note on the
 * same trade — because the mock store has no ids for staff and a permanently-null field would be
 * worse than a readable one.
 */
export const createListingOnBehalf = (ownerMobile, ownerName, listing) => _addListing({
  ...listing,
  owner: ownerName || listing.owner || '',
  ownerMobile,
  postedByAdmin: true,
  postedByStaff: currentStaffInfo().name || 'Admin',
});

/**
 * `(id, status, reason)` — the third argument is accepted and **ignored** here. The API records it
 * on the audit row; there is no audit store in the mock, so a rejection reason has nowhere to go.
 * Declared rather than silently absent so the two providers' signatures match and a caller passing
 * a reason is not misled into thinking the mock lost it by accident.
 *
 * **Approving a listing with no `localitySlug` is refused**, mirroring
 * `PropertyModerationService.denyApprovingUnfiled`. Publishing one puts a listing live that is
 * absent from locality search facets, from its locality landing page, from saved-search alerts and
 * from its society's home list — while telling its owner it is now visible to buyers. The guard
 * lives at the seam rather than in `lib/mockApi`, because it is a restatement of the server's
 * contract and `ApiError` is the seam's vocabulary for one; putting it deeper would also fire on
 * the store's internal writes, which are fixtures rather than decisions.
 *
 * Only approval. Rejecting or returning an unfiled listing to `pending` stays allowed: a listing
 * that is plainly spam has to be disposable without first being carefully filed, or a curation rule
 * becomes a moderation deadlock.
 */
export const setListingStatus = async (id, status, _reason) => {
  if (status === 'approved') {
    const row = await _getProperty(id);
    if (row && !row.localitySlug) {
      throw new ApiError({
        code: 'conflict',
        status: 409,
        message: 'This listing has no locality, so approving it would publish it out of locality'
          + ' search, its locality page, saved-search alerts and the society join. Assign one from'
          + ` the locality queue first (the owner typed '${row.locality || ''}').`,
      });
    }
  }
  return _setListingStatus(id, status);
};

export const toggleFeatured = _toggleFeatured;

/**
 * Counting by listing and measuring the result keeps the mock's filter semantics as the single
 * definition of "matches" — a reimplementation here could drift from `matchesFilters` and make the
 * two providers disagree about the very number the http one exists to get right.
 */
export const countProperties = (filters) => _listProperties(filters).then((l) => l.length);

/**
 * One page of a fully-filtered listings search, plus the two totals that describe the whole match.
 *
 * Answers the *wire query* rather than the page's filter state, which is the point: the shared
 * matcher and ranker in `lib/listings/` are the single definition of what each facet means, so this
 * is a fake of the endpoint rather than a second implementation of the page. The alternative — each
 * provider interpreting the filter state its own way — is exactly how the browser ended up with
 * ~25 filter axes the server had never been asked about.
 *
 * `total` and `verifiedTotal` are counted over the whole match and not over the returned page,
 * because that is the bug this operation exists to fix: filtering and slicing in the browser meant
 * both numbers described a page while reading as facts about the catalogue.
 */
export const searchListings = async (query = {}, { page = 1, size = 24 } = {}) => {
  const all = await _listProperties({ includeAllStatuses: false }, 'newest');
  const enriched = all.map((p) => enrichWithVerification(enrichRent(p)));
  // The approved floor is applied outside the facet chain, mirroring the server, where it is a
  // hard floor on the public search that no caller can widen.
  const matched = sortByQuery(
    enriched.filter((p) => p.status === 'approved' && matchesFacetQuery(p, query)),
    query,
  );
  const from = Math.max(0, page - 1) * size;
  return {
    items: matched.slice(from, from + size),
    total: matched.length,
    verifiedTotal: matched.filter((p) => p.ownerVerified || p.ownershipVerified).length,
    pageCount: Math.ceil(matched.length / size),
  };
};

/**
 * The moderation queue: every listing at every status, including archived.
 *
 * There is one store here, so this is the ordinary search with both widenings forced on; against the
 * API it is a separate, role-gated endpoint. Forced rather than passed through, because an
 * unfiltered moderation read means *everything* — the caller narrows with `status`/`archived`, and
 * the http provider's `toModerationQuery` defaults the same way.
 */
export const listForModeration = (filters = {}, sort = 'newest') =>
  _listProperties({ ...filters, includeAllStatuses: true, includeArchived: true }, sort);

/**
 * The moderation queue as a page envelope, mirroring the http provider's `searchForModeration`.
 *
 * The store is small enough that this never truncates, which is exactly why the mock could not see
 * the defect this shape was added for: a fixture set below the page size makes `items.length` and
 * `total` agree forever, so a console reading the first as the second looks correct.
 */
export const searchForModeration = async (filters = {}, sort = 'newest', { page = 1, size = 100 } = {}) => {
  const matched = await listForModeration(filters, sort);
  const from = Math.max(0, page - 1) * size;
  return {
    items: matched.slice(from, from + size),
    total: matched.length,
    pageCount: Math.ceil(matched.length / size),
  };
};

/**
 * The headline counts, over the whole store rather than over a page.
 *
 * `total` excludes archived and `archived` is counted separately, matching the server's record —
 * where `archived` is called out as "the one counter that is not a subset of `total`".
 */
export const moderationSummary = async () => {
  const all = await listForModeration({}, 'newest');
  const live = all.filter((l) => !l.archived);
  return {
    total: live.length,
    approved: live.filter((l) => l.status === 'approved').length,
    pending: live.filter((l) => l.status === 'pending').length,
    flagged: live.filter((l) => l.status === 'flagged').length,
    featured: live.filter((l) => l.featured).length,
    recheck: live.filter((l) => l.recheckRequestedAt).length,
    archived: all.length - live.length,
  };
};

/** Mirrors the http provider: unknown ids are dropped, and the result follows `ids` order. */
export const getPropertiesByIds = (ids = []) =>
  Promise.all(ids.map((id) => _getProperty(id))).then((list) => list.filter(Boolean));

/**
 * The mock counterpart of `GET /admin/properties/owner-standing`.
 *
 * `held` is real: the store knows every listing and who owns it, and the two statuses that occupy a
 * slot are the same two the server counts.
 *
 * `allowance` cannot be. The store keeps exactly one plan — the signed-in session's — so there is
 * no honest way to ask what *another* person's plan permits, and reading the operator's own limit
 * here would report the desk's entitlements as the caller's. It answers with the free tier instead,
 * which is what the server says about the large majority of the people this desk speaks to: every
 * account it provisions starts there. The consequence is that demo mode understates a paying
 * owner's ceiling and so may show the note when the API would not — the wrong direction to be wrong
 * in, and deliberately chosen over the alternative, which is a note that never appears in demo mode
 * at all and therefore never gets looked at until it is wrong in production.
 *
 * `known` is "the store has heard of this number", which for the mock means it holds a listing under
 * it. The store has no accounts, so there is nothing else to ask.
 */
export const ownerListingStanding = async (mobile) => {
  const wanted = digits(mobile);
  const all = await _listProperties({ includeAllStatuses: true, includeArchived: true }, 'newest');
  const theirs = all.filter((p) => digits(p.ownerMobile) === wanted);
  const held = theirs.filter((p) => !p.archived
    && (p.status === 'pending' || p.status === 'approved')).length;
  const allowance = PLAN_LISTING_LIMITS.free;
  return {
    mobile: wanted,
    known: theirs.length > 0,
    allowance,
    held,
    overAllowance: held > allowance,
  };
};

/**
 * The mock counterpart of `GET /admin/properties/duplicates`.
 *
 * Delegates to the union-find in `lib/data/properties-admin.js`, which is where this clustering was
 * born and which the server implementation was written against. Keeping it means the mock build's
 * Duplicates tab still demonstrates the feature; moving the *call* behind the service seam is what
 * lets the tab itself stop importing the mock store directly.
 *
 * Two fields the store cannot answer honestly, both reported rather than faked:
 *
 * `truncated` is always `false`. The store is a fixture of a few dozen rows, so no scan ceiling can
 * bind — but the flag is on the shape rather than omitted, because the UI branch that renders it is
 * a branch that must exist in both builds. A field present only on the wire is a field only the
 * live build's code path knows about, which is how a UI state ships untested.
 *
 * `reasonLabel` is resolved here rather than in the tab, matching the http provider, so both builds
 * hand the component the same already-translated value and the component owns no vocabulary.
 */
export const listDuplicateClusters = async () => {
  const { findDuplicateClusters } = await import('../../../lib/data/properties-admin.js');
  const clusters = findDuplicateClusters().map((c) => ({
    id: c.id,
    reason: c.reason,
    reasonLabel: MOCK_DUPLICATE_REASON_LABEL[c.reason] ?? undefined,
    // The store has an `owner` string rather than an account, so "same owner" is the best question
    // it can answer: the server compares owner ids.
    sameOwner: new Set(c.listings.map((l) => l.owner ?? '')).size === 1,
    listings: c.listings,
  }));
  return { clusters, scanned: clusters.reduce((n, c) => n + c.listings.length, 0), truncated: false };
};

/**
 * The mock's reason vocabulary, which is a superset of the server's on purpose.
 *
 * `findDuplicateClusters` joins its reasons in encounter order, so it can emit either permutation of
 * the two-arm case; the server sorts first and emits only `address+image`. Both permutations are
 * mapped here rather than "fixed" in the store, because changing the store's join order would edit
 * the fixture this build's own regression tests were written against, to no benefit — the value
 * never leaves this file untranslated.
 */
const MOCK_DUPLICATE_REASON_LABEL = {
  address: 'same address / electricity meter',
  image: 'matching photos',
  'address+image': 'same address and matching photos',
  'image+address': 'same address and matching photos',
};

/** The mock counterpart of `POST /admin/properties/duplicates/merge`. */
export const mergeDuplicateCluster = async (keepId, dropIds = []) => {
  const { resolveDuplicate } = await import('../../../lib/data/properties-admin.js');
  dropIds.filter((id) => id !== keepId).forEach((id) => resolveDuplicate(keepId, id));
};

/**
 * The mock counterpart of `POST /admin/properties/duplicates/dismiss`.
 *
 * Diverges from the server in where the verdict lives, and it is worth naming. The server stores a
 * row keyed on the member set, so a cluster that later gains a member is a *different* set and is
 * correctly asked again. The store has no such table; `dismissDuplicate` clears per-listing flags,
 * so a dismissal there is permanent for those listings however the cluster changes around them.
 * Demo mode is therefore more forgetful than production in one direction and more final in the
 * other — acceptable for a fixture, and not something a test should read as the contract.
 */
export const dismissDuplicateCluster = async (ids = []) => {
  const { dismissDuplicate } = await import('../../../lib/data/properties-admin.js');
  dismissDuplicate(ids);
};

/**
 * The owner's own listings at every status. The mock has no session, so ownership is matched on the
 * last 10 mobile digits (formatting varies across seeded and user-entered numbers); the http
 * provider gets the same set from the access token instead.
 *
 * `real` filters out demo catalogue rows, which have no owner and would otherwise appear in every
 * owner's dashboard.
 */
export const myListings = (user) => {
  const mine = myOwnerId() || ownerIdOfProperty(user);
  // No identified user means no listings. Without this the `!mine` short-circuit below matches every
  // row, so a transient null user (logout, or a session still restoring) would show one owner every
  // other owner's listings — and it would diverge from http, where ownership is the token's and an
  // absent session simply returns nothing.
  if (!mine) return Promise.resolve([]);
  return _listProperties({ includeAllStatuses: true }, 'newest').then((props) =>
    props.filter((p) => {
      if (!p.real) return false;
      const owner = ownerIdOfProperty(p);
      return !owner || owner === mine;
    }));
};

/**
 * One of the caller's own listings — the mock half of `GET /me/listings/{id}`.
 *
 * Filtered through `myListings` rather than reading `getListing(id)` straight out of the store, so
 * that the ownership rule is written once. A store read would resolve any listing whose id you
 * could name, including another owner's, and a mock that answers a question the server refuses is
 * a mock that teaches the suite a permission the product does not have.
 */
export const myListing = (id, user) => {
  if (!id) return Promise.resolve(null);
  return myListings(user).then((rows) => rows.find((p) => p.id === id || p.slug === id) || null);
};

// Sync → async wrappers
export const flagListing = (id, reason) => Promise.resolve(_flagListing(id, reason));
export const clearFlag = (id) => Promise.resolve(_clearFlag(id));

/**
 * Move along a concierge funnel. Resolves with no value, matching the live provider — the mock's
 * own `setPipelineStage` returns the updated record, and swallowing it here is deliberate so a
 * caller cannot come to depend on a value the API does not send.
 */
export const setPipelineStage = async (id, stage) => { await _setPipelineStage(id, stage); };

export const deleteListing = (id) => Promise.resolve(_deleteListing(id));
export const updateListingFields = (id, patch) => Promise.resolve(_updateListingFields(id, patch));
/* The mock store has no owner check, so both routes are the same write here. They are still two
   exports, because the seam is the contract: a caller that picks the wrong one has to be wrong in
   mock mode too, or the mistake only ever shows up against the API. */
export const updateListingAsModerator = (id, patch) => Promise.resolve(_updateListingFields(id, patch));
export const archiveListing = (id, reason) => Promise.resolve(_archiveListing(id, reason));

/**
 * The owner takes their own listing down — the mock half of `DELETE /me/listings/{id}`.
 *
 * Ownership is checked here rather than delegating straight to the store's archive, because the
 * store has no notion of a caller and would happily withdraw any listing whose id you could name.
 * A mock that answers a question the server refuses teaches the suite a permission the product does
 * not have, which is the one thing a mock provider must never do.
 */
export const takeListingDown = (id, user) =>
  myListing(id, user).then((mine) => {
    if (!mine) throw new Error('That listing is not yours to take down.');
    return _archiveListing(id);
  });
export const restoreListing = (id) => Promise.resolve(_restoreListing(id));

/**
 * The owner confirms a listing is still available.
 *
 * Stamps `freshenedAt` in the local store, which is exactly the behaviour the live provider now
 * replaces with a server write — kept here so the mock's freshness badges still respond to the
 * dashboard's confirm buttons.
 */
export const confirmListingFresh = (id) => Promise.resolve(_confirmListingFresh(id));
