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
import { evaluateListingDedup } from '../../../lib/data/propertyIdentity.js';
import { currentStaffInfo } from '../../../lib/mockApi/core.js';
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
 * Only the self-arm is returned. `evaluateListingDedup` also decides whether to *flag* a submission
 * against a different owner's claim, and that half deliberately stays where it is: it is an ops
 * signal, computed on write, and reporting it to the lister is how a duplicate probe turns into a
 * lookup on somebody else's property. The server's route has no such arm at all.
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
 * The moderation queue: every listing at every status, including archived.
 *
 * There is one store here, so this is the ordinary search with both widenings forced on; against the
 * API it is a separate, role-gated endpoint. Forced rather than passed through, because an
 * unfiltered moderation read means *everything* — the caller narrows with `status`/`archived`, and
 * the http provider's `toModerationQuery` defaults the same way.
 */
export const listForModeration = (filters = {}, sort = 'newest') =>
  _listProperties({ ...filters, includeAllStatuses: true, includeArchived: true }, sort);

/** Mirrors the http provider: unknown ids are dropped, and the result follows `ids` order. */
export const getPropertiesByIds = (ids = []) =>
  Promise.all(ids.map((id) => _getProperty(id))).then((list) => list.filter(Boolean));

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
export const restoreListing = (id) => Promise.resolve(_restoreListing(id));

/**
 * The owner confirms a listing is still available.
 *
 * Stamps `freshenedAt` in the local store, which is exactly the behaviour the live provider now
 * replaces with a server write — kept here so the mock's freshness badges still respond to the
 * dashboard's confirm buttons.
 */
export const confirmListingFresh = (id) => Promise.resolve(_confirmListingFresh(id));
