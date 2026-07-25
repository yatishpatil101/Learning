/* "Request more photos" demand signal (prototype, localStorage).

   When a buyer taps "More photos" on a listing, we persist a lightweight request
   keyed to the OWNER (same per-owner keying idea as contact.js), so the owner sees
   who asked from their dashboard Enquiries tab and is nudged to add more photos.

   Photo requests are lower-stakes than a phone-number reveal — they expose no owner
   PII — so the gate is lighter: sign-in only (no Aadhaar). A buyer can't spam the
   same listing: a repeat request for a listing they've already asked about is a no-op. */

const USER_KEY = 'puneNestUser';

const digits = (num) => String(num || '').replace(/\D/g, '');

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

const photoKey = (ownerMobile) => 'puneNestPhotoReq:' + (digits(ownerMobile) || 'anon');

export function getPhotoReqs(ownerMobile) {
  try {
    return JSON.parse(localStorage.getItem(photoKey(ownerMobile))) || [];
  } catch {
    return [];
  }
}

export function savePhotoReqs(ownerMobile, arr) {
  localStorage.setItem(photoKey(ownerMobile), JSON.stringify(arr));
}

/* → 'login' | 'duplicate' | 'ok' */
export function requestMorePhotos(ownerMobile, propId, propLabel) {
  const u = readUser();
  if (!u) return 'login';
  const mine = digits(u.mobile);
  const reqs = getPhotoReqs(ownerMobile);
  if (reqs.some((r) => r.buyerMobile === mine && r.propId === (propId || ''))) {
    return 'duplicate';
  }
  reqs.unshift({
    id: 'ph' + Date.now(),
    propId: propId || '',
    propLabel: propLabel || '',
    buyerName: u.name || 'Buyer',
    buyerMobile: mine,
    requestedAt: Date.now(),
  });
  savePhotoReqs(ownerMobile, reqs);
  return 'ok';
}

export const photoReqCount = (ownerMobile) => getPhotoReqs(ownerMobile).length;
