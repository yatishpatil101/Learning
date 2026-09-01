/**
 * Photo Request Service — the "please add more photos" demand signal.
 *
 * ## The lightest gate on the platform
 *
 * A photo request reveals nothing in either direction: the buyer learns no owner PII, and the owner
 * learns only that *somebody* wants better pictures. So unlike the contact gate (ADR-019) there is
 * no Aadhaar badge, no owner approval and no quota — sign-in is the entire gate. That is also why
 * the requester's mobile is masked with **no reveal path at all**: this is the cheapest endpoint we
 * expose, and a raw number here would be a way to harvest buyer contacts that walks straight past
 * the contact gate.
 *
 * ## Maker-checker
 *
 * The buyer is the maker (`requestPhotos`) and the listing owner is the checker (`resolvePhotoRequest`).
 * The server enforces the separation both ways: an owner cannot request photos of their own listing,
 * and a requester cannot resolve their own row. Neither rule is re-implemented here — the UI hides
 * what the caller cannot do, but hiding a button is a courtesy, not a control.
 *
 * ## Shape
 *
 * Both providers return the server's row, so no call site can tell which one it is talking to:
 *
 *   { id, propertyId, propertySlug, propertyTitle, requester: { name, mobile }, status, createdAt, resolvedAt }
 *
 *   status  'pending' | 'resolved'   — there is no 'declined'; see below.
 *
 * There is deliberately no decline. The owner either has more photos or does not, and a request the
 * owner ignores is already expressed by it staying `pending`. Adding a third state would ask owners
 * to make a decision the product has no use for.
 *
 * ## Failure
 *
 * Providers reject with an `ApiError` carrying a stable `status`, rather than the in-band sentinel
 * strings (`'login'`, `'duplicate'`, `'ok'`) the localStorage prototype returned — those were
 * indistinguishable from real data and had to be checked in the right order.
 *
 *   401 unauthorized  not signed in — send them to /signin
 *   400 bad_request   asking for photos of your own listing
 */
import { createProvider } from './config.js';

const provider = createProvider('photoRequest');

/**
 * Ask this listing's owner for more photos.
 *
 * Idempotent, and idempotent *permanently*: a repeat ask returns the existing row rather than
 * stacking a second one, and that holds even after the owner has resolved it — otherwise the same
 * buyer could re-nag on every upload and the owner's count would stop meaning "distinct people who
 * wanted this", which is the only thing it is good for.
 *
 * @param {string} propertyIdOrSlug
 * @returns {Promise<{created: boolean, request: object}>} `created` distinguishes a new row from a
 *   repeat press. It is a field rather than a 201-vs-200 status because this seam hands callers the
 *   parsed body and discards the status line, so a status-only signal would not survive the trip.
 */
export const requestPhotos = async (propertyIdOrSlug) => (await provider()).requestPhotos(propertyIdOrSlug);

/** The owner's inbox — requests against listings *they* own. Paged; the server default is 20. */
export const myPhotoRequests = async (opts) => (await provider()).myPhotoRequests(opts);

/** Counted server-side, so it stays correct past the first page (D78). */
export const pendingPhotoRequestCount = async () => (await provider()).pendingPhotoRequestCount();

/**
 * The checker's one move: mark a request satisfied. Owner-only, and enforced server-side — a
 * foreign row is a 404 rather than a 403, because a 403 would confirm the row exists.
 */
export const resolvePhotoRequest = async (reqId) => (await provider()).resolvePhotoRequest(reqId);
