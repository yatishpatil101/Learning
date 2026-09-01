/* localStorage store behind the MOCK photo-request provider.

   This used to be the feature itself. It is now only the mock provider's storage: the real
   read/write path is services/photoRequestService.js → providers/http/photoRequestProvider.js,
   backed by /properties/{id}/photo-requests and /me/photo-requests.

   The per-owner key is preserved deliberately, faithfully reproducing the bug that motivated the
   server: the buyer writes puneNestPhotoReq:<ownerMobile> into THEIR OWN browser, where the owner
   can never read it. Keep it — a mock that quietly worked better than production would hide the
   very defect the live suite exists to catch.

   `requestMorePhotos` and `photoReqCount` lived here too and are gone; their logic (sign-in gate,
   own-listing guard, duplicate suppression) now belongs to the provider, which mirrors the server's
   rules rather than inventing its own. */

const digits = (num) => String(num || '').replace(/\D/g, '');

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
