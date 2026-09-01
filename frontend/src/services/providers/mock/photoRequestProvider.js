/**
 * Mock photo-request provider — the localStorage counterpart to
 * `providers/http/photoRequestProvider.js`.
 *
 * `lib/photoRequests.js` buckets requests by **owner mobile**, but the service contract is keyed on
 * **listing id** (see `services/photoRequestService.js`). This module closes that gap: it resolves
 * the listing's owner through the property mock and leaves the storage layer untouched, so rows
 * seeded by the existing e2e specs under `puneNestPhotoReq:<digits>` still read back.
 *
 * It also synthesises the pieces the server would otherwise compute — the masked requester number,
 * the `status`/`resolvedAt` pair and the paged envelope — because a call site must not be able to
 * tell which provider it is talking to. Anything shaped only in the http provider is a bug that
 * appears exclusively in production.
 *
 * ## The bug this mock reproduces, and why that is deliberate
 *
 * The write happens in the **buyer's** browser under the *owner's* key, and the read happens in the
 * **owner's** browser — two different localStorage origins, so no real owner has ever seen a photo
 * request. That is the defect the live domain exists to fix. It is preserved here rather than
 * quietly corrected because the mock's job is to behave the way the mock has always behaved; a mock
 * that works better than the thing it stands in for hides the reason for the migration.
 */
import { getProperty } from '../../../lib/mockApi.js';
import { ApiError } from '../../http.js';
import { digits, myMobile } from '../../../lib/contact.js';
import { getPhotoReqs, savePhotoReqs } from '../../../lib/photoRequests.js';

/** The server's page size default, mirrored so paging behaves identically on mocks. */
const DEFAULT_SIZE = 20;

/**
 * `90XXXXX001` — the server's mask (first two digits, then the last three). The two providers have
 * to agree byte-for-byte: this string is asserted on in tests and is what a UI would render if it
 * ever leaked into a "call" link.
 */
const maskMobile = (mobile) => {
  const d = digits(mobile);
  return d.length === 10 ? `${d.slice(0, 2)}XXXXX${d.slice(-3)}` : d;
};

const readUser = () => {
  try {
    return JSON.parse(localStorage.getItem('puneNestUser'));
  } catch {
    return null;
  }
};

/**
 * One stored row in the server's wire vocabulary.
 *
 * `status` defaults to `'pending'` because rows written before this domain existed — including the
 * ones the e2e specs seed — have no such field, and treating a missing status as anything else
 * would make every legacy row read as already dealt with.
 */
const toWire = (r, propTitle) => ({
  id: r.id,
  propertyId: r.propId || '',
  propertySlug: r.propId || '',
  propertyTitle: r.propLabel || propTitle || '',
  requester: { name: r.buyerName || 'A buyer', mobile: maskMobile(r.buyerMobile) },
  status: r.status || 'pending',
  createdAt: r.requestedAt ? new Date(r.requestedAt).toISOString() : null,
  resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
});

export async function requestPhotos(propertyIdOrSlug) {
  const u = readUser();
  if (!u) {
    throw new ApiError({ code: 'unauthorized', status: 401, message: 'Sign in to ask for photos' });
  }
  const p = propertyIdOrSlug ? await getProperty(propertyIdOrSlug) : null;
  if (!p) {
    throw new ApiError({ code: 'not_found', status: 404, message: 'Listing not found' });
  }

  const ownerMobile = String(p.ownerMobile || '');
  const mine = digits(u.mobile);
  // Mirrors the server's own-listing guard. Enforced here as well as there because a mock that lets
  // an owner manufacture interest in their own listing would make the e2e suite green on a flow the
  // live API rejects with a 400.
  if (mine && digits(ownerMobile) === mine) {
    throw new ApiError({
      code: 'bad_request',
      status: 400,
      message: 'You cannot request more photos of your own listing.',
    });
  }

  const rows = getPhotoReqs(ownerMobile);
  const existing = rows.find((r) => r.buyerMobile === mine && r.propId === (p.id || ''));
  // A resolved row still blocks a re-ask, exactly as the unique index does server-side.
  if (existing) return { created: false, request: toWire(existing, p.title) };

  const row = {
    id: 'ph' + Date.now(),
    propId: p.id || '',
    propLabel: p.title || '',
    buyerName: u.name || 'Buyer',
    buyerMobile: mine,
    requestedAt: Date.now(),
    status: 'pending',
  };
  rows.unshift(row);
  savePhotoReqs(ownerMobile, rows);
  return { created: true, request: toWire(row, p.title) };
}

/**
 * The owner's inbox. Owner-scoped by the session rather than by an argument, matching the http
 * provider — the caller is the owner, so there is nothing to pass.
 */
export async function myPhotoRequests({ page = 0, size = DEFAULT_SIZE } = {}) {
  const mine = myMobile();
  if (!mine) return { items: [], total: 0, page, size };
  const rows = getPhotoReqs(mine);
  const items = rows.slice(page * size, page * size + size).map((r) => toWire(r));
  return { items, total: rows.length, page, size };
}

export async function pendingPhotoRequestCount() {
  const mine = myMobile();
  if (!mine) return 0;
  return getPhotoReqs(mine).filter((r) => (r.status || 'pending') === 'pending').length;
}

export async function resolvePhotoRequest(reqId) {
  const mine = myMobile();
  const rows = mine ? getPhotoReqs(mine) : [];
  const row = rows.find((r) => r.id === reqId);
  // 404 rather than 403, matching the server: a 403 would confirm that a row this caller does not
  // own exists.
  if (!row) {
    throw new ApiError({ code: 'not_found', status: 404, message: 'Photo request not found' });
  }
  // Idempotent — a second resolve must not push `resolvedAt` forward, or "when did the owner
  // respond" drifts every time the button is pressed.
  if ((row.status || 'pending') !== 'resolved') {
    row.status = 'resolved';
    row.resolvedAt = Date.now();
    savePhotoReqs(mine, rows);
  }
  return toWire(row);
}
