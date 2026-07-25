/* Owner-phone privacy model (prototype, localStorage).
   Mirrors the static app's auth.js contact-request helpers and uses the SAME
   storage keys ('puneNestContactReq:<ownerDigits>') so requests are compatible
   across the React and HTML prototypes.

   A buyer's request starts as 'pending'. The owner's number stays MASKED until
   the owner approves the request (status 'approved') — or until the viewer is the
   owner themselves (status 'owner'). Owners approve/decline from their dashboard. */

const USER_KEY = 'puneNestUser';

export const digits = (num) => String(num || '').replace(/\D/g, '');

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

const contactKey = (ownerMobile) => 'puneNestContactReq:' + (digits(ownerMobile) || 'anon');

export function getContactReqs(ownerMobile) {
  try {
    return JSON.parse(localStorage.getItem(contactKey(ownerMobile))) || [];
  } catch {
    return [];
  }
}

export function saveContactReqs(ownerMobile, arr) {
  localStorage.setItem(contactKey(ownerMobile), JSON.stringify(arr));
}

export const isOwnerViewer = (ownerMobile) => {
  const m = myMobile();
  return !!m && m === digits(ownerMobile);
};

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
  // Aadhaar OTP verification gate: user must verify identity before requesting owner contact
  const aadhaarKey = 'puneNestAadhaar:' + (digits(u.mobile) || 'anon');
  try {
    const v = JSON.parse(localStorage.getItem(aadhaarKey));
    if (!v || !v.verified) return 'aadhaar_required';
  } catch {
    return 'aadhaar_required';
  }
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
const ownerPrefsKey = (mobile) => 'pnOwnerPrefs:' + (digits(mobile) || 'anon');
export function getOwnerPrefsFor(mobile) {
  try {
    return JSON.parse(localStorage.getItem(ownerPrefsKey(mobile))) || {};
  } catch {
    return {};
  }
}
export const getOwnerPrefs = () => getOwnerPrefsFor(myMobile());
export function setOwnerPrefs(patch) {
  const next = Object.assign({}, getOwnerPrefs(), patch);
  localStorage.setItem(ownerPrefsKey(myMobile()), JSON.stringify(next));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pn:store', { detail: { key: ownerPrefsKey(myMobile()) } }));
  return next;
}
// True when this owner has opted to keep their number masked from approved buyers.
export const ownerHidesNumber = (mobile) => !!getOwnerPrefsFor(mobile).hideNumber;
