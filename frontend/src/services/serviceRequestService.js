/**
 * Service Request Service — the customer's assisted-service requests (rent agreements, legal,
 * interiors, packers, valuations).
 *
 * `GET|POST /service-requests`, `GET /service-requests/{id}`,
 * `POST /service-requests/{id}/messages`, `POST /service-requests/{id}/draft/decision`.
 *
 * This is the widest gap between what the page does and what the contract carries, so this module is
 * where the seam is drawn honestly rather than overclaimed. `ServiceTracker.jsx` drives a full
 * maker-checker workflow; only the operations a *customer* can genuinely perform through the API are
 * live, and the rest stays on `lib/serviceFlow.js` (which the ops back-office and the co-fill invite
 * flow still own outright).
 *
 * ## Live here
 *
 * | Operation | Endpoint |
 * |---|---|
 * | list own requests | `GET /service-requests` |
 * | read one | `GET /service-requests/{id}` |
 * | create | `POST /service-requests` |
 * | record the parties' identity numbers | `PUT /service-requests/{id}/identities` |
 * | post a message | `POST /service-requests/{id}/messages` |
 * | approve / reject a draft | `POST /service-requests/{id}/draft/decision` |
 *
 * ## Mock-only, and why (see `serviceRequestMapper.js` for the full table)
 *
 * | Frontend capability | Why it stays on mocks |
 * |---|---|
 * | draft / final document *rendering* | vault `multipart` uploads behind signed URLs that do not resolve in dev |
 * | per-request document checklist | no read representation on `ServiceRequestDto` |
 * | co-fill party requests | no endpoint — the server scopes every request to its requester |
 * | unread badges / read receipts | no read-receipt endpoint |
 * | `changes_requested` as a distinct state | the server collapses a rejection back to `in-progress` |
 * | staff transitions (assign, share draft, upload final) | the ops surface, not the customer tracker |
 * | identity numbers (`recordServiceRequestIdentities`) | mock storage is `localStorage`; writing a PAN and an Aadhaar there is the threat the wizard's redaction closed, so the mock provider drops them on purpose |
 * | "preview a sample draft" | a demo affordance the tracker hides when this domain is live |
 *
 * ## Presentation stays on `serviceFlow.js`
 *
 * `STEPS`, `stepStates`, `statusMeta`, `isActive` and `progressPct` are pure functions of a status
 * string — the tracker keeps importing them directly. Only the *data* operations cross the seam.
 *
 * ## Shape
 *
 * `listServiceRequests` returns view models in the tracker's existing vocabulary:
 *
 *   { id, type, service, status, details, docs, draft, finalDoc, draftDecision,
 *     messages: [{ id, from, text, at, read }], timeline, assignedTo, createdAt, updatedAt }
 *
 * `details` round-trips as the structured object the form sent (D119) — `{}` when the request
 * carried none; `docs` is `[]` against the API rather than absent, because the view reads them with
 * optional chaining and a missing key would render as `undefined`.
 */
import { createProvider } from './config.js';

const provider = createProvider('serviceRequest');

/**
 * The caller's own requests, newest activity first, optionally narrowed to one service `type`.
 *
 * @param {string} [typeFilter] one of `rental|legal|interior|packers|valuation`
 * @returns {Promise<object[]>}
 */
export const listServiceRequests = (typeFilter) => provider().listServiceRequests(typeFilter);

/** One request with its thread and documents, or null if it is not the caller's. */
export const getServiceRequest = (id) => provider().getServiceRequest(id);

/** Create a request from a service form. Structured `details` round-trip to the server (D119). */
export const createServiceRequest = (data) => provider().createServiceRequest(data);

/**
 * Hand the parties' PAN and Aadhaar to the drafting desk (D151).
 *
 * `PUT /service-requests/{id}/identities`. These numbers are deliberately absent from `details` —
 * that object is echoed verbatim to every staff read of the ops queue, which is what made carrying
 * them there a bulk identity dump — and absent from the autosave and the co-fill payload for the
 * same reason. This is the one channel that carries them, and it goes to exactly the operator the
 * request is assigned to.
 *
 * Mock-only no-op, and that is a decision rather than a gap: the mock store is `localStorage`, so
 * "support identities in mock mode" means writing an Aadhaar number to plain JSON on a shared
 * device, which is the precise threat the redaction closed. A demo that cannot show these is the
 * correct demo.
 *
 * @param {string} id the service request the numbers belong to
 * @param {{partyRole:'owner'|'tenant',partyIndex:number,partyName?:string,pan?:string,aadhaar?:string}[]} parties
 *   the complete set — this replaces whatever was recorded before, it does not append
 * @returns {Promise<void>}
 */
export const recordServiceRequestIdentities = (id, parties) =>
  provider().recordServiceRequestIdentities(id, parties);

/** Post a customer message onto a request's thread. Resolves to the updated request. */
export const addServiceRequestMessage = (id, text) =>
  provider().addServiceRequestMessage(id, text);

/**
 * Approve or reject a shared draft — the customer is the checker.
 *
 * @param {string} id
 * @param {'accepted'|'changes'} decision the tracker's vocabulary; mapped to `approve`/`reject`
 * @param {string} [note] required by the UI for a rejection; carried onto the timeline
 */
export const decideServiceRequestDraft = (id, decision, note) =>
  provider().decideServiceRequestDraft(id, decision, note);

/**
 * Co-fill counterparty requests (mock-only — empty against the API). The tracker merges these with
 * the caller's own so both parties to a shared rent agreement see it.
 */
export const listPartyServiceRequests = (typeFilter) =>
  provider().listPartyServiceRequests(typeFilter);

/** Mark a request's staff messages as read (mock-only no-op against the API). */
export const markServiceRequestRead = (id) => provider().markServiceRequestRead(id);
