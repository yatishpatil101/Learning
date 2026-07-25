import { rawDb, saveDb, mutateDb } from '../mockApi.js';
import { digits as digitsOf, norm } from './identityNorm.js';

const STORE_KEY = 'puneNestShareRequests';
const GROUPS_KEY = 'puneNestShareGroups';
const PREFS_KEY = 'puneNestSharePrefs';
const VERIFIED_KEY = 'puneNestSeekerVerified';
const INTERESTS_KEY = 'puneNestShareInterests';
const SAVED_KEY = 'puneNestShareSaved';

const get = (k, def) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v == null ? def : v;
  } catch {
    return def;
  }
};
const set = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
  return v;
};

export const getShareRequests = () => get(STORE_KEY, []);
export const saveShareRequest = (req) => {
  const arr = getShareRequests();
  arr.unshift(req);
  return set(STORE_KEY, arr);
};
export const updateShareRequest = (id, patch) => {
  const arr = getShareRequests();
  const idx = arr.findIndex((r) => r.id === id);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...patch };
    set(STORE_KEY, arr);
    return arr[idx];
  }
  return null;
};
export const deleteShareRequest = (id) => {
  const arr = getShareRequests().filter((r) => r.id !== id);
  set(STORE_KEY, arr);
};

// Flat-share groups. Mirrors the request seam above so created groups persist,
// are owner-managed, and map cleanly onto a future API. Seed groups (rendered
// from constants) stay out of storage; only user-created groups live here.
export const getShareGroups = () => get(GROUPS_KEY, []);
export const saveShareGroup = (group) => {
  const arr = getShareGroups();
  arr.unshift(group);
  return set(GROUPS_KEY, arr);
};
export const updateShareGroup = (id, patch) => {
  const arr = getShareGroups();
  const idx = arr.findIndex((g) => g.id === id);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...patch };
    set(GROUPS_KEY, arr);
    return arr[idx];
  }
  return null;
};
export const deleteShareGroup = (id) => {
  const arr = getShareGroups().filter((g) => g.id !== id);
  set(GROUPS_KEY, arr);
};

/* =========================================================================
   Anti-broker guardrails. Trust is the product: cap how many live flat-shares
   one identity can host, and detect two people claiming the same physical flat.
   Rooms live in their own store (store.js `puneNestRoomListings`); we read that
   key directly here to avoid a store.js <-> shareFlat.js import cycle.
   ========================================================================= */
const ROOMS_KEY = 'puneNestRoomListings';
const getRoomsRaw = () => {
  const v = get(ROOMS_KEY, []);
  return Array.isArray(v) ? v : [];
};

// A verified owner listing a whole flat room-by-room can legitimately exceed
// this — so the cap only counts NON-owner-tier posts. Owner-tier posts (attached
// to an Ops-verified property) are exempt from the count but still deduped.
export const MAX_ACTIVE_HOST_SHARES = 3;

// Seats still open on a post — the honest "is this still live?" signal. Groups
// carry members; rooms don't, so each is read on its own terms.
const groupSeatsOpen = (g) =>
  g && g.seatsOpen != null
    ? Math.max(0, Math.min(g.seatsTotal || 0, g.seatsOpen))
    : Math.max(0, (g.seatsTotal || 0) - ((g.members && g.members.length) || 0));
const roomSeatsOpen = (r) => (r && r.seatsOpen != null ? Math.max(0, r.seatsOpen) : 1);
const roomActive = (r) => r && r.status !== 'filled' && r.status !== 'closed' && roomSeatsOpen(r) > 0;

// Live non-owner-tier shares hosted by this identity — the number the cap limits.
export const countCappedActiveShares = (mobile) => {
  const d = digitsOf(mobile);
  if (!d) return 0;
  const g = getShareGroups().filter(
    (x) => digitsOf(x.ownerMobile) === d && x.verificationTier !== 'owner' && groupSeatsOpen(x) > 0
  ).length;
  const r = getRoomsRaw().filter(
    (x) => digitsOf(x.ownerMobile) === d && x.verificationTier !== 'owner' && roomActive(x)
  ).length;
  return g + r;
};

// A stable key for one physical flat so two hosts can't both silently "own" it.
// propertyId (an Ops-verified listing) is strongest; else society+locality (rooms)
// or the post title+locality (groups have no society) as a best-effort fallback.
export const addressFingerprint = ({ propertyId, society, locality, title } = {}) => {
  if (propertyId) return 'prop:' + String(propertyId);
  const loc = norm(locality);
  const soc = norm(society);
  const ttl = norm(title);
  if (soc) return 'addr:' + soc + '|' + loc;
  if (ttl) return 'addr:' + ttl + '|' + loc;
  return '';
};

// Existing live host-claims (groups + rooms) on the same physical address.
export const findAddressClaims = (fingerprint) => {
  if (!fingerprint) return [];
  const claims = [];
  getShareGroups().forEach((g) => {
    if (groupSeatsOpen(g) <= 0) return;
    if (addressFingerprint({ propertyId: g.propertyId, locality: g.locality, title: g.title }) === fingerprint)
      claims.push({ kind: 'group', id: g.id, mobile: digitsOf(g.ownerMobile), tier: g.verificationTier });
  });
  getRoomsRaw().forEach((r) => {
    if (!roomActive(r)) return;
    if (addressFingerprint({ propertyId: r.propertyId, society: r.society, locality: r.localities && r.localities[0] }) === fingerprint)
      claims.push({ kind: 'room', id: r.id, mobile: digitsOf(r.ownerMobile), tier: r.verificationTier });
  });
  return claims;
};

// Single decision point the group + room create flows both call. Returns whether
// the post must be blocked (cap hit or same host duplicating an address) and
// whether it should be flagged for an Ops look (a DIFFERENT host already claimed
// this address — fuzzy match, so flag-not-block to avoid false positives).
export const evaluateHostEligibility = ({ mobile, tier, address } = {}) => {
  const d = digitsOf(mobile);
  const capped = countCappedActiveShares(mobile);
  const overCap = tier !== 'owner' && capped >= MAX_ACTIVE_HOST_SHARES;
  const fingerprint = addressFingerprint(address || {});
  const claims = findAddressClaims(fingerprint);
  const duplicate = claims.some((c) => c.mobile && c.mobile === d);
  const flagForReview = claims.some((c) => c.mobile && c.mobile !== d);
  const reason = overCap
    ? `You already have ${MAX_ACTIVE_HOST_SHARES} live flat-shares. Fill or close one before posting another.`
    : duplicate
    ? 'You already have a live flat-share for this address.'
    : '';
  return { fingerprint, overCap, duplicate, flagForReview, blocked: overCap || duplicate, reason };
};

export const isSeekerVerified = (userKey) => {
  const map = get(VERIFIED_KEY, {});
  return !!map[userKey];
};
export const setSeekerVerified = (userKey) => {
  const map = get(VERIFIED_KEY, {});
  map[userKey] = true;
  set(VERIFIED_KEY, map);
};

/* Owner-consent ping. When a sitting tenant lists a replacement flatmate, the
   flat's owner confirms via OTP that they're aware — turning "trust me" into an
   auditable consent record. Keyed by the OWNER's mobile so the same consent is
   remembered if the tenant reopens the form. */
const CONSENT_KEY = 'puneNestOwnerConsent';
export const getOwnerConsents = () => get(CONSENT_KEY, {});
export const hasOwnerConsent = (ownerMobile, byMobile) => {
  const rec = getOwnerConsents()[digitsOf(ownerMobile)];
  if (!rec) return false;
  return byMobile ? digitsOf(rec.by) === digitsOf(byMobile) : true;
};
export const setOwnerConsent = (ownerMobile, byMobile) => {
  const map = getOwnerConsents();
  map[digitsOf(ownerMobile)] = { at: Date.now(), by: digitsOf(byMobile) };
  return set(CONSENT_KEY, map);
};

/* Ops agreement-review queue. A tenant's "I have a registered rent agreement" is
   self-declared, so tenant-tier posts (and any address a different host already
   claimed) land here for Ops to verify. Approve → the post shows Ops-verified;
   reject(+reason) → it shows the review failed. One review per group/room. */
const REVIEW_KEY = 'puneNestShareReviews';
// A tenant's uploaded agreement is the artifact Ops verifies. We keep only the
// metadata + the inline data URL when it's small enough for localStorage; an
// oversized file is recorded as present-but-not-stored so Ops can still ask for it.
const AGREEMENT_DOC_CAP = 3 * 1024 * 1024;
const normalizeAgreementDoc = (doc) => {
  if (!doc) return null;
  const size = Math.max(0, parseInt(doc.size, 10) || 0);
  const tooLarge = !!doc.tooLarge || size > AGREEMENT_DOC_CAP;
  return {
    name: String(doc.name || 'Agreement').slice(0, 200),
    size,
    mime: String(doc.mime || '').slice(0, 100),
    dataUrl: tooLarge ? null : (doc.dataUrl || null),
    tooLarge,
  };
};
export const getShareReviews = () => get(REVIEW_KEY, []);
export const getShareReviewFor = (targetId) =>
  getShareReviews().find((r) => r.groupId === targetId || r.roomId === targetId) || null;
export const enqueueShareReview = (rec) => {
  const arr = getShareReviews();
  const key = rec.groupId || rec.roomId;
  if (key && arr.some((r) => (r.groupId || r.roomId) === key)) return arr;
  const { agreementDoc, ...rest } = rec;
  arr.unshift({ id: 'rev' + Date.now(), status: 'pending', reason: '', createdAt: Date.now(), updatedAt: Date.now(), ...rest, agreementDoc: normalizeAgreementDoc(agreementDoc) });
  try {
    return set(REVIEW_KEY, arr);
  } catch {
    // localStorage quota (a large inline agreement) — retry without the data URL
    // so the review still enqueues; Ops sees the file as recorded-not-stored.
    if (arr[0] && arr[0].agreementDoc && arr[0].agreementDoc.dataUrl) {
      arr[0] = { ...arr[0], agreementDoc: { ...arr[0].agreementDoc, dataUrl: null, tooLarge: true } };
    }
    return set(REVIEW_KEY, arr);
  }
};
export const decideShareReview = (id, status, reason) => {
  const arr = getShareReviews();
  const idx = arr.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  arr[idx] = { ...arr[idx], status, reason: reason || '', updatedAt: Date.now() };
  set(REVIEW_KEY, arr);
  return arr[idx];
};
// Map of targetId -> review status, for cards to render their moderation state.
export const getShareReviewStatusMap = () => {
  const m = {};
  getShareReviews().forEach((r) => { m[r.groupId || r.roomId] = r.status; });
  return m;
};

export const getMyRequest = (userMobile, userName) => {
  return getShareRequests().find((r) => {
    if (userMobile && r.mobile && r.mobile === userMobile) return true;
    if (userName && r.name && r.name.toLowerCase() === userName.toLowerCase()) return true;
    return false;
  });
};

export const hasInterest = (id) => {
  const map = get(INTERESTS_KEY, {});
  return !!map[id];
};
export const addInterest = (id) => {
  const map = get(INTERESTS_KEY, {});
  map[id] = Date.now();
  set(INTERESTS_KEY, map);
};

/* =========================================================================
   Host-facing incoming requests. The interest map above only lives on the
   SEEKER's device (it disables the button + fires a notification/chat). The
   HOST of a flat-share post never saw who reached out. This seam records an
   incoming request keyed to the HOST's mobile (same per-owner keying idea as
   photoRequests.js / contact.js) so the host sees it in Dashboard → Requests.
   Maps cleanly onto a future API: one host inbox endpoint.
   ========================================================================= */
const shareFlatReqKey = (ownerMobile) => 'puneNestShareFlatReq:' + (digitsOf(ownerMobile) || 'anon');

export const getShareFlatRequests = (ownerMobile) => get(shareFlatReqKey(ownerMobile), []);

/* kind: 'flatmate' | 'room' | 'group'. action: 'request' (needs host approval)
   or 'join' (open-policy group, already joined → informational). Deduped by
   requester + target so a repeat tap is a no-op. Returns 'anon' | 'duplicate' |
   the new record. */
export const addShareFlatRequest = (ownerMobile, req = {}) => {
  const host = digitsOf(ownerMobile);
  if (!host) return 'anon'; // can't route to a host — leave the notification/chat as-is
  const arr = getShareFlatRequests(ownerMobile);
  const reqMob = digitsOf(req.requesterMobile);
  if (arr.some((r) => r.targetId === req.targetId && digitsOf(r.requesterMobile) === reqMob && reqMob)) {
    return 'duplicate';
  }
  const rec = {
    id: 'sfr' + Date.now(),
    kind: req.kind || 'group',
    action: req.action || 'request',
    targetId: req.targetId || '',
    targetTitle: req.targetTitle || 'Flat-share',
    locality: req.locality || '',
    requesterName: req.requesterName || 'Someone',
    requesterMobile: req.requesterMobile || '',
    status: req.action === 'join' ? 'accepted' : 'pending',
    requestedAt: Date.now(),
  };
  arr.unshift(rec);
  set(shareFlatReqKey(ownerMobile), arr);
  return rec;
};

export const decideShareFlatRequest = (ownerMobile, id, decision) => {
  const arr = getShareFlatRequests(ownerMobile);
  const idx = arr.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  arr[idx] = { ...arr[idx], status: decision, decidedAt: Date.now() };
  set(shareFlatReqKey(ownerMobile), arr);
  return arr[idx];
};

export const shareFlatReqPendingCount = (ownerMobile) =>
  getShareFlatRequests(ownerMobile).filter((r) => r.status === 'pending').length;
