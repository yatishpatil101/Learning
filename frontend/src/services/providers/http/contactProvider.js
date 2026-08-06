/**
 * HTTP contact provider — the live counterpart to `providers/mock/contactProvider.js`.
 *
 * There is deliberately no `contactMapper.js` alongside this, unlike the property slice. The
 * server's `ContactStatus` and `ContactRequest` schemas were designed against this seam, so the
 * only translation left is unwrapping Spring's page envelope. A mapper module here would be a file
 * of identity functions.
 *
 * The gate is keyed on the listing and the owner is derived server-side, so — unlike the mock —
 * nothing in this file ever sees or needs an owner's phone number to answer a permission question.
 */
import { get, patch, post } from '../../http.js';
import { NO_CONTACT_GATE } from '../../../lib/contact.js';

/**
 * The caller's gate state for one listing.
 *
 * A public listing page must render for anonymous visitors, so the two statuses that are *facts
 * about the caller rather than failures* are translated instead of thrown:
 *
 *   401 — not signed in. Semantically this is `status: 'none'`; they have made no request. Letting
 *         it throw would blank a public page for exactly the visitor we want to convert.
 *   404 — no such listing, which the mock also reports as "no gate". The page's own not-found
 *         handling owns that message; the gate has no opinion to add.
 */
export async function contactStatus(propertyId) {
  if (!propertyId) return NO_CONTACT_GATE;
  try {
    return await get('/contacts/status', { propertyId });
  } catch (err) {
    if (err?.status === 401 || err?.status === 404) return NO_CONTACT_GATE;
    throw err;
  }
}

/**
 * Ask the owner for their number. Returns the resulting gate state — the server models this as
 * "tell me where I now stand" rather than "create a request", which is what makes a repeat press
 * idempotent instead of stacking duplicate rows in the owner's inbox.
 *
 * Errors propagate as-is: 401 (sign in) and 403 `verification_required` are both things the user
 * can act on, so unlike the read above they must not be flattened into a silent no-op.
 */
export async function requestContact(propertyId, message) {
  return post('/contacts/request', { propertyId, ...(message ? { message } : {}) });
}

/** The owner's inbox, newest first. */
export async function myContactRequests({ page = 0, size = 20 } = {}) {
  const res = await get('/me/contact-requests', { page, size });
  return {
    items: res?.content ?? [],
    // `totalElements` counts the whole result set, not the page — the difference the badge and any
    // "N enquiries" label depend on.
    total: res?.totalElements ?? 0,
    page: res?.number ?? page,
    size: res?.size ?? size,
  };
}

export async function respondToContactRequest(reqId, status) {
  return patch(`/me/contact-requests/${encodeURIComponent(reqId)}`, { status });
}

/** Counted server-side, so it stays correct past the first page (D78). */
export async function pendingContactCount() {
  const res = await get('/me/contact-requests/pending-count');
  return res?.pending ?? 0;
}
