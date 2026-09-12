import { digits as digitsOf, norm } from './identityNorm.js';

const STORE_KEY = 'draazyFlatmatePosts';
const GROUPS_KEY = 'draazyFlatmateGroups';
const VERIFIED_KEY = 'draazySeekerVerified';
const INTERESTS_KEY = 'draazyFlatmateInterests';

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

const PENDING_REQ_KEY = 'dzPendingRequests';

/* Every flatmate ask ends by staging a chat request for the Messages hand-off.

   A bell notification used to be written beside it, into a `draazyNotifications` array. The
   inbox is `GET /notifications` now and never reads that key, so the write was invisible by
   construction: a seeker was shown a success toast for an alert that existed in one browser and
   that no surface -- not the bell badge, not the Notifications page -- would ever display. The
   server raises the row it needs to; there is nothing for the client to mint.

   Failures are logged rather than swallowed: the caller shows a success toast, so a silently-lost
   write means the user is told their message was sent when it wasn't. */
export const pushPendingRequest = (req) => {
  try {
    set(PENDING_REQ_KEY, [...get(PENDING_REQ_KEY, []), req]);
    return true;
  } catch (e) { console.warn('[flatmates] pending-request write failed', e); return false; }
};

/** Does this browser already hold the seeker's staged ask for `propertyId`?

    KNOWN GAP. This used to consult `dzConversations` as well, which nothing has written since the
    conversation domain went live — so the branch was dead and is gone. What it stood in for is not:
    `drainPendingChats` in `providers/http/conversationProvider.js` EMPTIES this queue once Messages
    is opened and the server accepts the staged chat. After that drain this answers `false`, so a
    later `already_interested` 409 on the same device re-stages the ask, and the Requests tab shows
    a staged copy beside the real server thread with `unreadCount()` one too high.

    Closing it properly means asking the live inbox whether a thread already exists for this
    `propertyId`, rather than keeping a second drain-surviving key here — a local marker would just
    be the same bet on browser storage that this whole seam is being taken off. */
const hasLocalThread = (propertyId) => {
  const queued = get(PENDING_REQ_KEY, []);
  return Array.isArray(queued) && queued.some((r) => r?.propertyId === propertyId);
};

/* The one place an ask becomes visible on THIS device (D183).

   Every flatmate ask — seeker interest, room enquiry, group join — used to write the Messages
   hand-off only when the provider accepted it. The duplicate `409` path flipped the card to its
   done state without it, so a seeker who first asked from their phone opened this laptop to a
   finished card and an empty Messages: the server's truth and the device's state disagreed. Both
   paths call this now, so they leave the device in the same state.

   Idempotent on `request.propertyId`, which is the identity the record already carries — the device
   that DID make the original ask calls this again on any later 409 and writes nothing. */
export const recordAskLocally = ({ request }) => {
  const propertyId = request?.propertyId;
  if (propertyId == null || hasLocalThread(propertyId)) return false;
  pushPendingRequest(request);
  return true;
};

export const getFlatmatePosts = () => get(STORE_KEY, []);
export const saveFlatmatePost = (req) => {
  const arr = getFlatmatePosts();
  arr.unshift(req);
  return set(STORE_KEY, arr);
};
export const updateFlatmatePost = (id, patch) => {
  const arr = getFlatmatePosts();
  const idx = arr.findIndex((r) => r.id === id);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...patch };
    set(STORE_KEY, arr);
    return arr[idx];
  }
  return null;
};
export const deleteFlatmatePost = (id) => {
  const arr = getFlatmatePosts().filter((r) => r.id !== id);
  set(STORE_KEY, arr);
};

// Flatmate groups. Mirrors the request seam above so created groups persist,
// are owner-managed, and map cleanly onto a future API. Seed groups (rendered
// from constants) stay out of storage; only user-created groups live here.
export const getFlatmateGroups = () => get(GROUPS_KEY, []);
export const saveFlatmateGroup = (group) => {
  const arr = getFlatmateGroups();
  arr.unshift(group);
  return set(GROUPS_KEY, arr);
};
export const updateFlatmateGroup = (id, patch) => {
  const arr = getFlatmateGroups();
  const idx = arr.findIndex((g) => g.id === id);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...patch };
    set(GROUPS_KEY, arr);
    return arr[idx];
  }
  return null;
};
export const deleteFlatmateGroup = (id) => {
  const arr = getFlatmateGroups().filter((g) => g.id !== id);
  set(GROUPS_KEY, arr);
};

/* =========================================================================
   Moderation visibility — mirrors the server exactly (tech-debt D97d, D72).

   `FlatmateVocabulary.MOD_PUBLIC` on the backend is `{live, approved}`, and every
   public flatmate read filters on it — nine query sites across
   `FlatmateRoomRepository`, `FlatmateGroupRepository` and `FlatmateSeekerPostRepository`,
   one of which carries the comment *"the mod_status clause is not decoration: a
   flagged post must disappear"*. The mock had no equivalent, so in mock mode a
   moderator could remove a post and the board would keep showing it.

   This is a **whitelist, not a blacklist**, for the same reason the server's is
   (D72): a new state — `pending`, the state every new post now starts in — must be
   invisible by default. With a blacklist the board would have shown every
   unreviewed post until somebody remembered to add the new word here.

   The set is duplicated here rather than imported because there is nothing to
   import from — but it is duplicated *deliberately and named after its source*,
   so a change on the server has one obvious place to land.
   ========================================================================= */
export const MOD_PUBLIC = ['live', 'approved'];

/** True when a post may appear on a public board. Absent `modStatus` = live, as on the server. */
export const isPubliclyVisible = (item) => MOD_PUBLIC.includes(item?.modStatus || 'live');

/* =========================================================================
   Anti-broker guardrails. Trust is the product: cap how many live flatmate posts
   one identity can host, and detect two people claiming the same physical flat.
   Rooms live in their own store (store.js `draazyRoomListings`); we read that
   key directly here to avoid a store.js <-> flatmates.js import cycle.
   ========================================================================= */
const ROOMS_KEY = 'draazyRoomListings';
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
export const countCappedActiveFlatmatePosts = (mobile) => {
  const d = digitsOf(mobile);
  if (!d) return 0;
  const g = getFlatmateGroups().filter(
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
  getFlatmateGroups().forEach((g) => {
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
  const capped = countCappedActiveFlatmatePosts(mobile);
  const overCap = tier !== 'owner' && capped >= MAX_ACTIVE_HOST_SHARES;
  const fingerprint = addressFingerprint(address || {});
  const claims = findAddressClaims(fingerprint);
  const duplicate = claims.some((c) => c.mobile && c.mobile === d);
  const flagForReview = claims.some((c) => c.mobile && c.mobile !== d);
  const reason = overCap
    ? `You already have ${MAX_ACTIVE_HOST_SHARES} live flatmate posts. Fill or close one before posting another.`
    : duplicate
    ? 'You already have a live flatmate for this address.'
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
const CONSENT_KEY = 'draazyOwnerConsent';
export const getOwnerConsents = () => get(CONSENT_KEY, {});
export const setOwnerConsent = (ownerMobile, byMobile) => {
  const map = getOwnerConsents();
  map[digitsOf(ownerMobile)] = { at: Date.now(), by: digitsOf(byMobile) };
  return set(CONSENT_KEY, map);
};

/* Ops agreement-review queue. A tenant's "I have a registered rent agreement" is
   self-declared, so tenant-tier posts (and any address a different host already
   claimed) land here for Ops to verify. Approve → the post shows Ops-verified;
   reject(+reason) → it shows the review failed. One review per group/room. */
const REVIEW_KEY = 'draazyFlatmateReviews';
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
export const getFlatmateReviews = () => get(REVIEW_KEY, []);
export const enqueueFlatmateReview = (rec) => {
  const arr = getFlatmateReviews();
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
export const decideFlatmateReview = (id, status, reason) => {
  const arr = getFlatmateReviews();
  const idx = arr.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  arr[idx] = { ...arr[idx], status, reason: reason || '', updatedAt: Date.now() };
  set(REVIEW_KEY, arr);
  return arr[idx];
};
// Map of targetId -> review status, for cards to render their moderation state.
export const getFlatmateReviewStatusMap = () => {
  const m = {};
  getFlatmateReviews().forEach((r) => { m[r.groupId || r.roomId] = r.status; });
  return m;
};

export const getMyRequest = (userMobile, userName) => {
  return getFlatmatePosts().find((r) => {
    if (userMobile && r.mobile && r.mobile === userMobile) return true;
    if (userName && r.name && r.name.toLowerCase() === userName.toLowerCase()) return true;
    return false;
  });
};

/* =========================================================================
   Two stores, because there are two different facts (D181).

   1. `draazyFlatmateInterests` — **what this browser asked**, per signed-in requester. Page-owned,
      and the reason a done-state survives a reload. It is memory, not truth: it can only ever know
      about asks made from this device, so it is written from the outcome of a call and is NEVER
      consulted to decide whether to make one. Doing that is what made the server's 409 unreachable
      in the first place.

   2. `dzMockFlatmateInterests` — the **mock provider's** stand-in for V27's
      unique index: one request per (requester, kind, target), a second ask
      refused with the same 409 the real API answers. Provider-owned; the page
      must not read it, because in http mode it does not exist.

   The split is the whole fix. One store doing both jobs is a lie in one of them:
   as truth it is wrong on the second device, and as memory it silently pre-empts
   the only thing that actually knows.
   ========================================================================= */
/* ── 1. The page's memory of its own asks ─────────────────────────────────── */

/* Scoped by requester, like every other identity-bearing store here. A bare global map would be
   read by whoever signs in next on the same browser: they would see the previous person's asks
   rendered as "Interest sent", which discloses that activity AND leaves them with no button to
   press — so the provider would never be asked, which is the very failure this item removed.

   No mobile, no bucket. Falling back to a shared `'anon'` key would recreate exactly that leak for
   any two identities that lack one; forgetting instead costs a redundant call the server answers
   correctly anyway, which is the whole point of the split. */

/** The asks `mobile` has made from this browser, as the `interests` map the page keys on. */
export const getAskedInterests = (mobile) => (digitsOf(mobile) ? get(INTERESTS_KEY, {})[digitsOf(mobile)] || {} : {});
/** Remember an ask that the provider confirmed — either accepted, or 409'd as a duplicate. */
export const rememberAsk = (mobile, key) => {
  const who = digitsOf(mobile);
  if (!who) return;
  const all = get(INTERESTS_KEY, {});
  all[who] = { ...(all[who] || {}), [key]: true };
  set(INTERESTS_KEY, all);
};

/* ── 2. The provider's ledger and the host inbox are gone ─────────────────────

   `dzMockFlatmateInterests` stood in for V27's unique index, and
   `draazyFlatmateReq:<ownerId>` stood in for the host inbox. Both were browser-local and both
   are now the server's: `GET /me/flatmate-interests` answers the first, and
   `FlatmateSeekerController` (`GET`/`PATCH /me/flatmate-requests`) the second. A host reads their
   inbox on their own device, so a store keyed on an id this browser minted could never have
   reached them — it only ever worked when host and seeker were the same person.

   The seeker-scoped memory above survives because it is memory, not truth: it keeps the button
   from re-offering an ask this browser has already made and had confirmed. */
