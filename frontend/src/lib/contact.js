/* Owner-phone privacy model (prototype, localStorage). The number stays MASKED until the owner
   approves the request, or the viewer is the owner. Storage keys are shared with the static app's
   auth.js helpers, so requests stay compatible across both prototypes. */

const USER_KEY = 'draazyUser';

export const digits = (num) => String(num || '').replace(/\D/g, '');

/* Only a *known* intermediary withdraws the "deal direct with the owner" half of the zero-brokerage
   claim: a blank column is silence, not evidence of one, and Draazy's own cut is nil either way. */
export const isBrokered = (p) => p?.postedByType === 'agent' || p?.postedByType === 'builder';

/* The "nothing is known" gate: not signed in, unknown listing, or still loading. Lives in `lib/`
   because both providers and `useContactGate` need it and only `lib/` is importable by all three
   without a cycle. Every field is the safe answer — no status, no reveal. */
export const NO_CONTACT_GATE = Object.freeze({
  status: 'none',
  verifiedContactOnly: false,
  verificationRequired: false,
  ownerHidesNumber: false,
});

/* A usable identity is a full 10-digit Indian mobile and nothing else: stripping digits out of a
   mask ('98XXXXX210') yields a short plausible string, and every owner sharing a first-two/last-three
   prefix would collapse onto one storage bucket and read each other's contact requests. Length is
   the reliable test — a mask can never produce 10 digits, so nothing has to sniff for 'X' or '•'. */
export const isFullMobile = (num) => digits(num).length === 10;

export function maskPhone(num) {
  const d = digits(num);
  if (d.length < 4) return '+91 ••••• •••••';
  return '+91 ' + d.slice(0, 2) + '••• •••' + d.slice(-2);
}

export function fmtPhone(num) {
  const d = digits(num);
  return d.length === 10 ? '+91 ' + d.slice(0, 5) + ' ' + d.slice(5) : '+91 ' + d;
}

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export const myMobile = () => {
  const u = readUser();
  return u ? digits(u.mobile) : '';
};

/* The single place a mobile becomes a storage bucket. Null unless the number is a full identity, so
   a masked or missing value can never name one — masks collide and every mobile-less session would
   share the same bucket. Callers treat null as "identity unknown": read nothing, write nothing. */
const mobileKey = (prefix, mobile) =>
  isFullMobile(mobile) ? prefix + digits(mobile) : null;

const contactKey = (ownerMobile) => mobileKey('draazyContactReq:', ownerMobile);

export function getContactReqs(ownerMobile) {
  const key = contactKey(ownerMobile);
  if (!key) return [];
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

export function saveContactReqs(ownerMobile, arr) {
  const key = contactKey(ownerMobile);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(arr));
}

/* Identity check, so it demands a full mobile on BOTH sides. Given a masked owner number
   this is false — the viewer is treated as a stranger, which keeps the number hidden.
   That is the safe direction to fail: it never reveals, it can only under-reveal. */
export const isOwnerViewer = (ownerMobile) => {
  const m = myMobile();
  return isFullMobile(m) && isFullMobile(ownerMobile) && m === digits(ownerMobile);
};

/* True when this signed-in user carries the opt-in "Verified" badge. This grants a privilege, so it
   fails closed: a session without a full mobile has no badge of its own and must not inherit one
   from a shared bucket. */
function isViewerVerified(u) {
  const key = mobileKey('draazyIdentity:', u && u.mobile);
  if (!key) return false;
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return !!(v && v.verified);
  } catch {
    return false;
  }
}

/* The signed-in viewer's own badge. Exported so the contact provider can report
   `verificationRequired` on a *read* — the gate has to be describable before the user
   presses anything, or the "Verify to contact" prompt only ever appears after a failure. */
export const viewerIsVerified = () => isViewerVerified(readUser());

function findContactReq(ownerMobile, propId) {
  const mine = myMobile();
  if (!mine) return null;
  return (
    getContactReqs(ownerMobile).filter(
      (x) => x.buyerMobile === mine && (!x.propId || !propId || x.propId === propId),
    )[0] || null
  );
}

/* → 'owner' | 'approved' | 'pending' | 'declined' | 'none' */
export function contactStatus(ownerMobile, propId) {
  if (isOwnerViewer(ownerMobile)) return 'owner';
  const r = findContactReq(ownerMobile, propId);
  return r ? r.status : 'none';
}

export function requestContact(ownerMobile, propId) {
  const u = readUser();
  if (!u) return 'login';
  // A masked owner number cannot address a bucket, so refuse with a distinct code rather than
  // faking a sent request.
  if (!isFullMobile(ownerMobile)) return 'unavailable';
  // Badge-not-gate (ADR-019): contact is L1-only, except where the owner accepts verified
  // contacts only — an unverified requester is then asked to earn the badge first.
  if (ownerVerifiedOnly(ownerMobile) && !isViewerVerified(u)) return 'verification_required';
  const existing = findContactReq(ownerMobile, propId);
  if (existing) return existing.status;
  const reqs = getContactReqs(ownerMobile);
  reqs.unshift({
    id: 'c' + Date.now(),
    propId: propId || '',
    buyerName: u.name || 'Buyer',
    buyerMobile: digits(u.mobile),
    status: 'pending',
    requestedAt: Date.now(),
  });
  saveContactReqs(ownerMobile, reqs);
  return 'pending';
}

export function setContactStatus(ownerMobile, reqId, status) {
  const reqs = getContactReqs(ownerMobile);
  reqs.forEach((r) => {
    if (r.id === reqId) r.status = status;
  });
  saveContactReqs(ownerMobile, reqs);
}

export const pendingContactCount = (ownerMobile) =>
  getContactReqs(ownerMobile).filter((x) => x.status === 'pending').length;

/* Owner privacy preferences (per owner mobile). `hideNumber` lets an owner keep
   their phone masked even AFTER they approve a contact request — approved buyers
   are routed to in-app chat / callback instead of the raw number. This is a real
   behavior on top of the always-on request gate, not a duplicate of it. */
const ownerPrefsKey = (mobile) => mobileKey('dzOwnerPrefs:', mobile);
export function getOwnerPrefsFor(mobile) {
  const key = ownerPrefsKey(mobile);
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}
export const getOwnerPrefs = () => getOwnerPrefsFor(myMobile());
export function setOwnerPrefs(patch) {
  const key = ownerPrefsKey(myMobile());
  if (!key) return getOwnerPrefs();
  const next = Object.assign({}, getOwnerPrefs(), patch);
  localStorage.setItem(key, JSON.stringify(next));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pn:store', { detail: { key } }));
  return next;
}
// True when this owner has opted to keep their number masked from approved buyers.
export const ownerHidesNumber = (mobile) => !!getOwnerPrefsFor(mobile).hideNumber;
// True when this owner accepts contact requests ONLY from Verified-badge users.
// This is the sole path that can turn a contact request into 'verification_required'.
export const ownerVerifiedOnly = (mobile) => !!getOwnerPrefsFor(mobile).verifiedContactOnly;
