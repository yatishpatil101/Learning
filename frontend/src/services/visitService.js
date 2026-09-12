/**
 * Visit Service — property visits, from booking through to the completed-visit review gate.
 *
 * ## One visit, two surfaces
 *
 * The mock kept **two** parallel stores: a global `visits` collection in `mockApi`, and per-owner
 * `draazyPropVisitReqs:<mobile>` buckets in `lib/store`. Booking wrote to both, and each surface
 * read a different one — the dashboard calendar read the collection, the review gate read the
 * bucket. Two records for one real-world event, free to disagree the moment either was updated
 * alone.
 *
 * The server has one table behind two endpoints (backend D3: `POST /visits` and
 * `POST /visit-requests` share a create path). This seam matches that: one shape, one write,
 * and two *reads* that differ only in which side of the visit the caller is on.
 *
 *   listVisits()        visits I booked            → GET /visits
 *   myVisitRequests()   visits on listings I own   → GET /me/visit-requests
 *
 * ## Shape
 *
 * The seam speaks the UI's vocabulary, not the wire's:
 *
 *   { id, propertyId, listingId, listing, when, mode, status, visitorName, visitorMobile, createdAt }
 *
 * `when` is the human slot string (`"19 Jul 2026, 10:30 AM (in-person)"`) that the whole dashboard
 * — calendar grid, day grouping, reschedule dialog — reads through `parseWhen`. The server stores a
 * single ISO instant instead; `visitWhen.slotFromWhen` / `whenFromSlot` convert at the providers.
 * `listingId` is kept alongside `propertyId` because the calendar's property links are written
 * against it and they are the same value.
 *
 * ## Contact gating
 *
 * `visitorMobile` is **masked** (`98XXXXX210`) until the owner confirms the visit — the server
 * applies the same gate the contact slice does. Nothing here can unmask it.
 */
import { createProvider } from './config.js';

const provider = createProvider('visit');

/** Visits the caller booked, newest first. */
export const listVisits = async () => (await provider()).listVisits();

/** Visits booked against listings the caller owns, newest first. */
export const myVisitRequests = async () => (await provider()).myVisitRequests();

/**
 * Book a visit.
 *
 * **Not idempotent, and the two providers disagree about that.** The mock moves the slot of an
 * existing live visit; the server rejects a second live visit on the same property with a 409. The
 * mock now matches the server (it throws the same `ApiError`), because the alternative — silently
 * moving a slot the owner has already confirmed — is a worse failure than a visible one.
 *
 * @param {{propertyId: string, when?: string, dateIso?: string, time?: string, mode?: string,
 *          note?: string, listing?: string}} req
 * @throws {ApiError} 409 `visit_exists` when a live visit is already booked on this property
 */
export const scheduleVisit = async (req) => (await provider()).scheduleVisit(req);

/**
 * Move a visit through the workflow: `confirmed`, `cancelled`, `completed`, `no-show`.
 *
 * The server enforces who may make which transition (an owner confirms, either party cancels) and
 * rejects illegal ones with a 409, so this deliberately does not second-guess it client-side —
 * a guard here could only ever disagree with the authority.
 */
export const updateVisitStatus = async (id, status) => (await provider()).updateVisitStatus(id, status);

/**
 * Reschedule to a new slot, returning the visit to `scheduled` so the other party re-confirms.
 *
 * Served by `PATCH /visits/{id}/slot` (D87): the seam converts the dashboard's human `when` string
 * to the ISO instant the server stores. Either participant may reschedule a *live* visit; the
 * server rejects a terminal one (completed/cancelled/no-show) with a 409, so this does not
 * second-guess it client-side.
 */
export const rescheduleVisit = async (id, when) => (await provider()).rescheduleVisit(id, when);
