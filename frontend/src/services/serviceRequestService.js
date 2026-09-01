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
 * | create a deferred co-fill request | `POST /service-requests/co-fill` |
 * | read one | `GET /service-requests/{id}` |
 * | list my co-fill invites | `GET /me/service-request-invites` |
 * | accept / decline a co-fill invite | `POST /me/service-request-invites/{partyId}` |
 * | submit invited-party details | `PUT /service-requests/{id}/party-details` |
 * | open deferred checkout | `POST /service-requests/{id}/checkout` |
 * | withdraw an unanswered invite | `DELETE /service-requests/{id}/parties/{partyId}` |
 * | upload a request document | `POST /service-requests/{id}/docs` |
 * | create | `POST /service-requests` |
 * | record the parties' identity numbers | `PUT /service-requests/{id}/identities` |
 * | post a message | `POST /service-requests/{id}/messages` |
 * | approve / reject a draft | `POST /service-requests/{id}/draft/decision` |
 * | **the desk's queue** (staff/admin) | `GET /service-requests` |
 * | **take a request** (staff/admin) | `PATCH /service-requests/{id}/status` → `assigned` |
 * | **read the parties' identity numbers** (assignee only) | `GET /service-requests/{id}/identities` |
 *
 * The last three are the drafting desk's slice (D173) and belong to `pages/ops/OpsDraftingDesk.jsx`.
 * They are in this module rather than a second service because they are the same resource on the
 * same domain — a `serviceRequestOps` service would have needed its own provider pair over the
 * identical endpoints, which is how two sources of truth start.
 *
 * **Those three never had a second implementation behind them (D184).** The desk filters on
 * `?status=` in the server's vocabulary; the mock's rows carried the stepper's, so its queue read
 * answered most filters with an empty page — a work queue that lied about being idle. A translation
 * table between the two was rejected as a second vocabulary to keep in sync, so the desk gated
 * itself shut instead. Both the mock and that gate are gone (P5c) and the desk is simply live.
 *
 * ## Mock-only, and why (see `serviceRequestMapper.js` for the full table)
 *
 * | Frontend capability | Why it stays on mocks |
 * |---|---|
 * | draft / final document *rendering* | vault `multipart` uploads behind signed URLs that do not resolve in dev |
 * | per-request document checklist | no read representation on `ServiceRequestDto` |
 * | legacy co-fill tracker merge (`listPartyServiceRequests`) | mock-only compatibility path; live flow uses `GET /me/service-request-invites` + `POST /me/service-request-invites/{partyId}` |
 * | unread badges / read receipts | no read-receipt endpoint |
 * | withdrawing an unanswered invite (`withdrawServiceRequestParty`) | the mock's invite row lives in the *invitee's* `localStorage`, which the requester's browser cannot reach — so the mock reports the request unchanged rather than pretending to have withdrawn it |
 * | the customer's rejection *note* | the note goes into the message thread, not onto the request, so `draftDecision.note` is empty on a live read. The rejection itself survives: the server's `changes-requested` maps to the tracker's `changes_requested` step |
 * | staff transitions (share draft, upload final) | no desk surface for them yet — the drafting desk covers the queue read, taking a matter, and the identity read, and stops there |
 * | identity numbers (`recordServiceRequestIdentities`) | mock storage is `localStorage`; writing a PAN and an Aadhaar there is the threat the wizard's redaction closed, so the mock provider drops them on purpose. There is no mock *read* any more — that was the desk's, and the desk is live-only |
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
export const listServiceRequests = async (typeFilter) => (await provider()).listServiceRequests(typeFilter);

/** One request with its thread and documents, or null if it is not the caller's. */
export const getServiceRequest = async (id) => (await provider()).getServiceRequest(id);

/**
 * The whole queue, paged — **staff and admin only** (D173).
 *
 * `GET /service-requests` again, with no `/admin` twin: the endpoint's scope is role-derived, so a
 * customer session calling this reads their own requests and nothing tells them apart. That is the
 * reason it is a separate export rather than an option on `listServiceRequests` — a flag on one
 * function is a flag somebody sets on a consumer surface, and the page it renders would look
 * correct.
 *
 * @param {{type?: string, status?: string, page?: number, size?: number}} [opts]
 * @returns {Promise<{items: object[], total: number, page: number, size: number}>}
 */
export const listServiceRequestQueue = async (opts) => (await provider()).listServiceRequestQueue(opts);

/**
 * Take a request for the calling operator — `PATCH /{id}/status` to `assigned`. Staff/admin.
 *
 * There is no "assign to somebody else", by design: assignment and acknowledgement are the same act.
 * It is also the prerequisite for {@link readServiceRequestIdentities}, which answers only the
 * assignee — so taking a matter somebody else holds costs two visible moves and leaves a timeline
 * entry and an audit row behind. Accountability, not prohibition.
 */
export const takeServiceRequest = async (id) => (await provider()).takeServiceRequest(id);

/**
 * Read the parties' PAN and Aadhaar — the assigned operator's read (D151/D173).
 *
 * `GET /service-requests/{id}/identities`. The counterpart to
 * {@link recordServiceRequestIdentities}: the customer writes, exactly one operator reads, every
 * call is audited (refusals included), and the rows are blanked when the request reaches a terminal
 * status.
 *
 * **Callers owe this result three things**, because the route's guarantees end where the client
 * begins: hold it in component state for as long as the view is open and no longer, never put it in
 * a URL, a list column, `localStorage` or a log line, and let a refusal reach the screen with the
 * server's own sentence rather than an empty list — "no numbers were recorded" and "you are not the
 * one working this matter" are different facts.
 *
 * Rejects rather than resolving empty on a 403.
 *
 * @param {string} id
 * @returns {Promise<{partyRole:string,partyIndex:number,partyName:string,pan:string,aadhaar:string,
 *   purged:boolean,purgedAt:number}[]>} owner first. A blank number with `purged:false` means the
 *   customer left it empty; with `purged:true` the matter is closed and it has been discarded.
 */
export const readServiceRequestIdentities = async (id) => (await provider()).readServiceRequestIdentities(id);

/**
 * The paperwork this request asks for, and what has arrived — `GET /{id}/checklist` (D120).
 *
 * **Derived on read, never stored.** There is no checklist table and no `status` column a desk can
 * tick, so there is no way for "verified" to disagree with "there is a file". That also means there
 * is nothing here to write: the only way to move an item is for somebody to upload the document.
 * A desk operation that marked paperwork verified would be inventing a second source of truth for
 * the same fact, which is why the retired ops desks' "Mark all verified" did not come with them.
 *
 * `ready`/`total` come off the envelope rather than being counted here, so every surface that shows
 * "3 of 5" shows the server's count and not its own.
 *
 * Rejects rather than resolving empty. A caller must not render a failed read as an empty
 * checklist: "nothing has been filed" is a fact about the customer, and getting it wrong sends a
 * desk chasing documents it already has.
 *
 * Reads from the server, like the rest of the desk. The mock store had no notion of the server's
 * document catalogue, so `OpsDraftingDesk` gated itself shut rather than answer from it (D184).
 *
 * @param {string} id
 * @returns {Promise<{ready:number,total:number,items:{id:string,name:string,done:boolean,
 *   documentId:string|null}[]}>} every item, present or missing, in a fixed order.
 */
export const readServiceRequestChecklist = async (id) => (await provider()).readServiceRequestChecklist(id);

/** Create a request from a service form. Structured `details` round-trip to the server (D119). */
export const createServiceRequest = async (data) => (await provider()).createServiceRequest(data);

/** Create a deferred co-fill request and invite the counterparty (rent-agreement only). */
export const createCoFillServiceRequest = async ({ request, role, mobile }) =>
  (await provider()).createCoFillServiceRequest({ request, role, mobile });

/** Outstanding co-fill invites addressed to the signed-in account. */
export const listMyServiceRequestInvites = async () =>
  (await provider()).listMyServiceRequestInvites();

/** Accept or decline one co-fill invite (`decision`: `accept|decline`). */
export const decideServiceRequestInvite = async (partyId, decision) =>
  (await provider()).decideServiceRequestInvite(partyId, decision);

/** Accepted invitee submits their half of the request details. */
export const submitServiceRequestPartyDetails = async (id, details) =>
  (await provider()).submitServiceRequestPartyDetails(id, details);

/** Requester opens checkout for a deferred co-fill request. */
export const openServiceRequestCheckout = async (id) =>
  (await provider()).openServiceRequestCheckout(id);

/** Requester takes back an unanswered co-fill invitation, freeing the role (V107). */
export const withdrawServiceRequestParty = async (id, partyId) =>
  (await provider()).withdrawServiceRequestParty(id, partyId);

/** Upload one document onto a service request. */
export const addServiceRequestDoc = async (id, doc) =>
  (await provider()).addServiceRequestDoc(id, doc);

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
export const recordServiceRequestIdentities = async (id, parties) =>
  (await provider()).recordServiceRequestIdentities(id, parties);

/** Post a customer message onto a request's thread. Resolves to the updated request. */
export const addServiceRequestMessage = async (id, text) =>
  (await provider()).addServiceRequestMessage(id, text);

/**
 * Approve or reject a shared draft — the customer is the checker.
 *
 * @param {string} id
 * @param {'accepted'|'changes'} decision the tracker's vocabulary; mapped to `approve`/`reject`
 * @param {string} [note] required by the UI for a rejection; carried onto the timeline
 */
export const decideServiceRequestDraft = async (id, decision, note) =>
  (await provider()).decideServiceRequestDraft(id, decision, note);

/**
 * Co-fill counterparty requests (mock-only — empty against the API). The tracker merges these with
 * the caller's own so both parties to a shared rent agreement see it.
 */
export const listPartyServiceRequests = async (typeFilter) =>
  (await provider()).listPartyServiceRequests(typeFilter);

/** Mark a request's staff messages as read (mock-only no-op against the API). */
export const markServiceRequestRead = async (id) => (await provider()).markServiceRequestRead(id);
