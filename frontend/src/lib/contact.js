/* Contact storage stays compatible with the static app's auth.js helpers. */
const USER_KEY = 'draazyUser';

export const digits = (num) => String(num || '').replace(/\D/g, '');

/* Shared "nothing is known" gate for providers and `useContactGate`. */
export const NO_CONTACT_GATE = Object.freeze({
  status: 'none',
  verifiedContactOnly: false,
  verificationRequired: false,
  ownerHidesNumber: false,
});

/* Full mobile only: masked prefixes collide and would share contact-request buckets. */
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

/* Masked or missing numbers never name a bucket, because masks and blanks collide. */
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

export const isOwnerViewer = (ownerMobile) => {
  const m = myMobile();
  return isFullMobile(m) && isFullMobile(ownerMobile) && m === digits(ownerMobile);
};

/* Verification grants a privilege, so sessions without a full mobile fail closed. */
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

/* Owners may keep phones masked after approval; buyers use chat or callbacks instead. */
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
