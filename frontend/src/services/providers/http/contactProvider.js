import { get, patch, post, unwrapFullPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { readAccessToken } from '../../../lib/auth.js';
import { NO_CONTACT_GATE } from '../../../lib/contact.js';

/** Signed-out callers get the empty gate locally, avoiding noisy doomed 401s. */
export async function contactStatus(propertyId) {
  if (!propertyId) return NO_CONTACT_GATE;
  if (!readAccessToken()) return NO_CONTACT_GATE;
  try {
    return await get('/contacts/status', { propertyId });
  } catch (err) {
    if (err?.status === 401 || err?.status === 404) return NO_CONTACT_GATE;
    throw err;
  }
}

/* The server keeps this idempotent and returns 401/403 exactly as the UI must explain them. */
export async function requestContact(propertyId, message) {
  return post('/contacts/request', { propertyId, ...(message ? { message } : {}) });
}

/** The owner's inbox, newest first. */
export async function myContactRequests({ page = 0, size = MAX_PAGE_SIZE } = {}) {
  const res = await get('/me/contact-requests', { page, size });
  const items = unwrapFullPage(res, 'contact');
  return {
    items,
    page: res?.page ?? res?.number ?? page,
    size: res?.size ?? size,
    total: res?.totalElements ?? items.length,
    totalPages: res?.totalPages ?? 0,
  };
}

export async function respondToContactRequest(reqId, status) {
  return patch(`/me/contact-requests/${encodeURIComponent(reqId)}`, { status });
}

/** Counted server-side, so it stays correct past the first page. */
export async function pendingContactCount() {
  const res = await get('/me/contact-requests/pending-count');
  return res?.pending ?? 0;
}
