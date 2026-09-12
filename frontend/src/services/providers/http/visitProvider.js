/**
 * HTTP visit provider.
 *
 * Two reads and two writes (schedule, and reschedule via `PATCH /visits/{id}/slot`, D87).
 *
 * The only real translation is the slot: the server carries a single ISO instant plus a separate
 * `mode`, while the dashboard reads one human `when` string through `parseWhen`. Both directions
 * live in `lib/visitWhen.js`, beside the parser they have to stay mutually readable with.
 */
import { get, patch, post, unwrapFullPage } from '../../http.js';
// Leaf module, no imports of its own — see its header, and D208. Deliberately not from `http.js`.
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { slotFromParts, slotFromWhen, whenFromSlot } from '../../../lib/visitWhen.js';

/**
 * Wire `Visit` → the seam's shape.
 *
 * `visitor.mobile` is contact-gated server-side: it arrives masked (`98XXXXX210`) until the owner
 * confirms. It is passed through as-is — masking is the server's decision to make, and a client
 * that tried to "helpfully" fill in a real number would be defeating the gate.
 */
function toViewModel(row) {
  const mode = row?.mode || 'in-person';
  return {
    id: row.id,
    propertyId: row.propertyId || '',
    // Same value under the name the dashboard calendar's property links already use.
    listingId: row.propertyId || '',
    // The wire carries no listing title; the dashboard falls back to a generic label. Resolving it
    // here would mean a property fetch per visit, which is the N+1 this seam exists to avoid.
    listing: row.listing || '',
    when: whenFromSlot(row.slot, mode),
    slot: row.slot || '',
    mode,
    status: row.status || 'scheduled',
    visitorName: row.visitor?.name || 'Visitor',
    visitorMobile: row.visitor?.mobile || '',
    visitorId: row.visitor?.id || '',
    createdAt: row.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

/**
 * Both reads are paged on the wire (D77) and read as plain lists here.
 *
 * The dashboard groups visits into upcoming/past and the calendar buckets them by day, both from
 * one array; neither has a pager. `size=100` is the server's ceiling, so the request stays bounded
 * and {@link unwrapFullPage} warns the day somebody's visit history outgrows it — which matters
 * more here than elsewhere, because a missing row reads as "that viewing was cancelled".
 */
/* A function, not a constant — see the note on `paged` in `dealProvider.js`. `MAX_PAGE_SIZE` now
   comes from the import-free `apiLimits.js` (D208) so this read would be safe either way, but the
   eager provider glob in `config.js` still evaluates this file inside `http.js`'s own evaluation,
   and call-time reads stay out of that window whatever `http.js` grows next. */
const paged = () => ({ size: MAX_PAGE_SIZE });

/** `GET /visits` — visits the caller booked. Caller-scoped by the token. Paged (D77). */
export async function listVisits() {
  return unwrapFullPage(await get('/visits', paged()), 'visit').map(toViewModel);
}

/** `GET /me/visit-requests` — visits on the caller's own listings. Paged (D77). */
export async function myVisitRequests() {
  return unwrapFullPage(await get('/me/visit-requests', paged()), 'visit').map(toViewModel);
}

/**
 * `POST /visits` — book a visit.
 *
 * Rejects with 409 when a live visit already exists on this property for this caller. That is not
 * smoothed over: the mock now raises the same error, so a call site cannot be written against the
 * gentler behaviour and then break on the day the domain goes live.
 */
export async function scheduleVisit(req = {}) {
  const slot = req.slot || (req.dateIso ? slotFromParts(req.dateIso, req.time) : null);
  return toViewModel(await post('/visits', {
    propertyId: req.propertyId,
    slot,
    mode: req.mode || 'in-person',
    note: req.note || undefined,
  }));
}

/**
 * `PATCH /visit-requests/{id}/status` — confirm, cancel, complete or no-show.
 *
 * Returns 200 with no body, so the caller gets the id and target status back rather than a row.
 * Callers that need the updated list re-read it; inventing a row here would be guessing at fields
 * (like the contact gate on the visitor's mobile) that only the server can decide.
 */
export async function updateVisitStatus(id, status) {
  await patch(`/visit-requests/${encodeURIComponent(id)}/status`, { status });
  return { id, status };
}

/**
 * `PATCH /visits/{id}/slot` — reschedule a live visit to a new slot (D87).
 *
 * The dashboard passes a human `when` string; the seam converts it to the ISO instant the server
 * stores, via `slotFromWhen` (the same converter the booking form uses, kept beside `parseWhen` so
 * the two never drift). The server resets the visit to `scheduled`; it returns 200 with no body, so
 * the caller gets the id and new `when` back rather than a row — the dashboard already applied the
 * change optimistically and only rolls back on rejection.
 */
export async function rescheduleVisit(id, when) {
  await patch(`/visits/${encodeURIComponent(id)}/slot`, { slot: slotFromWhen(when) });
  return { id, when };
}
