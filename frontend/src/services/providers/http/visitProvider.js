/**
 * HTTP visit provider — the live counterpart to `providers/mock/visitProvider.js`.
 *
 * Two reads, one write, and one operation the API cannot serve yet (see `rescheduleVisit`).
 *
 * The only real translation is the slot: the server carries a single ISO instant plus a separate
 * `mode`, while the dashboard reads one human `when` string through `parseWhen`. Both directions
 * live in `lib/visitWhen.js`, beside the parser they have to stay mutually readable with.
 */
import { get, patch, post } from '../../http.js';
import { slotFromParts, whenFromSlot } from '../../../lib/visitWhen.js';

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

const toList = (rows) => (Array.isArray(rows) ? rows : []).map(toViewModel);

/** `GET /visits` — visits the caller booked. Caller-scoped by the token. */
export async function listVisits() {
  return toList(await get('/visits'));
}

/** `GET /me/visit-requests` — visits on the caller's own listings. */
export async function myVisitRequests() {
  return toList(await get('/me/visit-requests'));
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
 * Not supported by the API.
 *
 * `PATCH /visit-requests/{id}/status` accepts a status and a note — there is no route that moves a
 * visit's slot. Cancel-and-rebook is not a silent substitute: it mints a new id (breaking the row
 * the UI is holding), discards the visit's history, and would hit the duplicate-visit 409 against
 * the row it had just cancelled unless that write had already settled.
 *
 * Throwing follows the same convention as `propertyProvider`'s unshipped admin moderation and the
 * saved-search anonymous capture: an operation with no server home fails loudly rather than writing
 * somewhere the reads will never look (D87).
 */
export async function rescheduleVisit() {
  throw new Error(
    '[visit] Reschedule is not supported by the API: PATCH /visit-requests/{id}/status carries a '
      + 'status only, and there is no slot-update route. Needs a reschedule endpoint (D87).',
  );
}
