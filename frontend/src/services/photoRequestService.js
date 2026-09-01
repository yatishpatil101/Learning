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
 * The buyer is the maker (`requestPhotos`) and the listing owner is the checker (`decidePhotoRequest`).
 * The server enforces the separation both ways: an owner cannot request photos of their own listing,
 * and a requester cannot decide their own row. Neither rule is re-implemented here — the UI hides
 * what the caller cannot do, but hiding a button is a courtesy, not a control.
 *
 * ## Shape
 *
 * Both providers return the server's row, so no call site can tell which one it is talking to:
 *
 *   { id, propertyId, propertySlug, propertyTitle, requester: { name, mobile }, status, createdAt, decidedAt }
 *
 *   status     'pending' | 'resolved' | 'declined'
 *   decidedAt  null while pending; otherwise when the owner answered, whichever way they went.
 *
 * `declined` arrived in V118, reversing an explicit earlier decision. V117 argued there was nothing
 * to decline — the owner either has more photos or does not, and a request they will not act on is
 * already expressed by it staying `pending`. What that missed is who `pending` is for. It reads as
 * "not yet" to both parties, so an owner with nothing more to share had no way to say so, and their
 * inbox accumulated rows they could never clear. The buyer's half is worse: they wait on photos that
 * are never coming, with the empty gallery indistinguishable from an owner who has not got round to
 * it. Both halves are closed by the same state, which is why it is worth a third one.
 *
 * ## The buyer is told, either way
 *
 * A decision notifies the requester (`photo.added` / `photo.declined`), which is the buyer's *only*
 * window onto the outcome. There is deliberately no requester-scoped read to pair with it, because
 * the photos are not a reply addressed to this buyer — they are an attribute of the listing, visible
 * in the same gallery to everyone who opens it. The notification carries the news; the listing
 * carries the goods.
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
 * The checker's move: answer a request, either way. Owner-only, and enforced server-side — a foreign
 * row is a 404 rather than a 403, because a 403 would confirm the row exists.
 *
 * Deciding twice is a no-op rather than an error: the first answer stands and `decidedAt` does not
 * move, so a double-tap cannot rewrite when the owner replied.
 *
 * @param {string} reqId
 * @param {'resolved'|'declined'} decision required — there is no default. Omitting it is a 400.
 */
export const decidePhotoRequest = async (reqId, decision) =>
  (await provider()).decidePhotoRequest(reqId, decision);
