/**
 * Contact Service — the owner-contact gate (ADR-019).
 *
 * ## Why this contract is keyed on `propertyId` alone
 *
 * The gate is **per listing**: approving Asha for a 2BHK in Baner says nothing about the same
 * owner's shop in Kothrud, and she must ask again there. The server enforces that with a unique
 * constraint on `(requester, property)`, so a listing id is the whole key and the owner is derived
 * from it server-side.
 *
 * The mock predates that decision and buckets requests by *owner mobile*, which is why the old
 * signatures took `(ownerMobile, propId)`. Keeping `ownerMobile` here would have been the smaller
 * diff, but it is an identifier the browser should never need: it forced every caller to resolve a
 * phone number before it could ask a permission question, and a masked number (`98XXXXX210`) is not
 * a usable key — that mismatch is exactly how a caller ends up silently reading an empty bucket.
 * The mock provider now resolves the owner from the listing internally instead.
 *
 * ## Shape
 *
 * Every read returns the same gate object, mirroring the server's `ContactStatus` schema:
 *
 *   { status, verifiedContactOnly, verificationRequired, ownerHidesNumber }
 *
 *   status               'owner' | 'approved' | 'pending' | 'declined' | 'none'
 *   verifiedContactOnly  the owner accepts enquiries from Verified-badge users only
 *   verificationRequired this caller is blocked by that opt-in right now
 *   ownerHidesNumber     the owner stays masked even once approved — offer chat, not a call (D5)
 *
 * Returning one object rather than a bare status string is what lets `ownerHidesNumber` stop being
 * a second lookup keyed on a phone number. It arrives from the same round trip that decided the
 * status, so the two can never disagree.
 *
 * ## Failure
 *
 * Both providers reject with an `ApiError`, so callers branch on a stable `code` instead of the
 * mock's old in-band sentinel strings (`'login'`, `'unavailable'`, `'verification_required'`),
 * which were indistinguishable from real statuses and had to be checked in the right order:
 *
 *   401 unauthorized           not signed in — send them to /signin
 *   403 verification_required  owner accepts verified contacts only, and this caller has no badge
 */
import { createProvider } from './config.js';

const provider = createProvider('contact');

/** Read the gate for one listing. Safe for signed-out callers — they get `status: 'none'`. */
export const contactStatus = (propertyId) => provider().contactStatus(propertyId);

/**
 * Ask this listing's owner for their number. Idempotent: asking twice returns the existing state
 * rather than stacking duplicate rows in the owner's inbox.
 *
 * @param {string} propertyId
 * @param {string} [message]  optional note to the owner, capped at 1000 chars server-side
 */
export const requestContact = (propertyId, message) => provider().requestContact(propertyId, message);

/** The owner's inbox — requests against listings *they* own. Paged; the server default is 20. */
export const myContactRequests = (opts) => provider().myContactRequests(opts);

/** Approve or decline one request. `status` is 'approved' | 'declined'. */
export const respondToContactRequest = (reqId, status) =>
  provider().respondToContactRequest(reqId, status);

/**
 * How many requests are waiting on the signed-in owner, across *all* pages.
 *
 * Deliberately not derived from `myContactRequests`: that is one page, so a busy owner's badge
 * would silently cap at the page size and under-report exactly when it matters most (D78).
 */
export const pendingContactCount = () => provider().pendingContactCount();
