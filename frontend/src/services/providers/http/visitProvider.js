import { get, patch, post, unwrapFullPage } from '../../http.js';
// Leaf module, no imports of its own — see its header. Deliberately not from `http.js`.
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { slotFromParts, slotFromWhen, whenFromSlot } from '../../../lib/visitWhen.js';

/** It is passed through as-is — masking is the server's decision to make, and a client that tried to "helpfully" fill
 * in a real number would be defeating the gate. */
function toViewModel(row) {
  const mode = row?.mode || 'in-person';
  const parties = Array.isArray(row?.parties) ? row.parties : [];
  const ownerParty = parties.find((p) => ['owner', 'host', 'listing_owner', 'property_owner'].includes(String(p.role || '').toLowerCase()));
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
    ownerId: row.owner?.id || row.host?.id || ownerParty?.id || '',
    parties,
    createdAt: row.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

const paged = () => ({ size: MAX_PAGE_SIZE });

/** `GET /visits` — visits the caller booked, optionally on one listing. Caller-scoped by the token. Paged. */
export async function listVisits({ propertyId } = {}) {
  return unwrapFullPage(await get('/visits', propertyId ? { propertyId, ...paged() } : paged()), 'visit').map(toViewModel);
}

/** `GET /me/visit-requests` — visits on the caller's own listings. Paged. */
export async function myVisitRequests() {
  return unwrapFullPage(await get('/me/visit-requests', paged()), 'visit').map(toViewModel);
}

export async function scheduleVisit(req = {}) {
  const slot = req.slot || (req.dateIso ? slotFromParts(req.dateIso, req.time) : null);
  return toViewModel(await post('/visits', {
    propertyId: req.propertyId,
    slot,
    mode: req.mode || 'in-person',
    note: req.note || undefined,
  }));
}

/** Returns 200 with no body, so the caller gets the id and target status back rather than a row. */
export async function updateVisitStatus(id, status) {
  await patch(`/visit-requests/${encodeURIComponent(id)}/status`, { status });
  return { id, status };
}

/** The server resets the visit to `scheduled`; it returns 200 with no body, so the caller gets the id and new `when`
 * back rather than a row. */
export async function rescheduleVisit(id, when) {
  await patch(`/visits/${encodeURIComponent(id)}/slot`, { slot: slotFromWhen(when) });
  return { id, when };
}
