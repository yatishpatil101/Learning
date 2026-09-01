/**
 * HTTP service-request provider — the live counterpart to
 * `providers/mock/serviceRequestProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `serviceRequestService.js`
 * is the only contract between them and `ServiceTracker.jsx` may not care which one is active. Shape
 * translation — and the divergence it papers over — lives in `serviceRequestMapper.js`.
 *
 * ## The honest subset
 *
 * Only the operations a customer can genuinely drive through the contract are live here: listing
 * their own requests, reading one, creating one, posting a message, and approving/rejecting a
 * shared draft. The rest of the workflow stays mock-only and is documented as such:
 *
 *   - **draft / final-document uploads** are `multipart/form-data` to the vault; there is no upload
 *     surface behind the customer tracker, and the vault's signed URLs do not resolve in dev.
 *   - **co-fill invites** (`listPartyServiceRequests`) have no endpoint — the server scopes every
 *     request to its requester, so there is no counterparty view to fetch.
 *   - **read receipts** (`markServiceRequestRead`) have no endpoint; unread badges are a mock-only
 *     affordance.
 *   - **share draft and upload final** have no surface at all any more. They were the five
 *     per-team ops desks, which read `localStorage` while the work had moved to Postgres; they were
 *     retired rather than ported, and the endpoints (`POST /{id}/draft`, `POST /{id}/final`) are
 *     multipart writes into a vault whose signed URLs do not resolve in dev, so there was never a
 *     working path to keep. The four operations the *drafting desk* needs — the queue read, taking
 *     a request, the identity read, and the document checklist — are live here (D173, D120);
 *     everything else about working a matter is not.
 */
import { get, patch, post, put } from '../../http.js';
import {
  toChecklist, toIdentityList, toViewModel, toViewModelList, toViewModelPage, toCreate, toWireType,
} from './serviceRequestMapper.js';

export async function listServiceRequests(typeFilter) {
  // `?type=` filters on the stored wire type, so the frontend's `rental` has to become
  // `rent-agreement` here too — an untranslated filter matches nothing and renders "no requests"
  // over a tracker that is actually full.
  const qs = typeFilter ? `?type=${encodeURIComponent(toWireType(typeFilter))}` : '';
  const res = await get(`/service-requests${qs}`);
  // Paged envelope in the general case; tolerate a bare array in case the endpoint is unpaged.
  return toViewModelList(res?.content ?? (Array.isArray(res) ? res : []));
}

/**
 * The desk's view of the same endpoint — staff/admin see the whole queue (D173).
 *
 * `GET /service-requests` has no `/admin` twin: scope is **role-derived**, so this is the identical
 * path with a different answer depending on who asks. That is worth stating out loud, because it
 * means the only thing separating "my requests" from "everyone's" is the session — which is why
 * this operation is named for the audience rather than being a flag on `listServiceRequests`, and
 * why nothing on a consumer surface may call it.
 *
 * Genuinely paged, and the totals come from the envelope. The consumer read above collapses the
 * page to an array because one customer's own requests fit on a page; the platform's queue does
 * not, and a desk that silently saw only the first twenty would work a queue it believed was
 * finished.
 */
export async function listServiceRequestQueue({ type, status, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (type) query.type = toWireType(type);
  if (status) query.status = status;
  return toViewModelPage(await get('/service-requests', query), { page, size });
}

/**
 * Take a request — `PATCH /service-requests/{id}/status` with `assigned` (D151).
 *
 * There is no "assign to somebody else" here and that is the contract's decision, not an omission:
 * moving to `assigned` takes the request for the **calling** staff member, because assignment and
 * acknowledgement are the same act and a queue you can push work into is a queue people push work
 * into. It is also the only way to become the one caller `readServiceRequestIdentities` will answer,
 * which is what makes that refusal an accountability control rather than a prohibition — the move
 * writes a timeline entry the customer can read and an audit row naming whoever made it.
 */
export async function takeServiceRequest(id) {
  return toViewModel(
    await patch(`/service-requests/${encodeURIComponent(id)}/status`, { status: 'assigned' }),
  );
}

/**
 * Read the parties' identity numbers — the assigned operator's, and nobody else's (D151/D173).
 *
 * Errors are **not** swallowed here, unlike every other read in this file. A 403 is the endpoint
 * working: it means this matter belongs to somebody else, or to nobody, and the server's own
 * sentence says which. Collapsing it to `null` or `[]` the way `getServiceRequest` collapses a 404
 * would render "no identity numbers were recorded" over a refusal — telling the desk the customer
 * never supplied what it is being denied. The caller shows `err.message`.
 */
export async function readServiceRequestIdentities(id) {
  return toIdentityList(await get(`/service-requests/${encodeURIComponent(id)}/identities`));
}

/**
 * The document checklist — `GET /service-requests/{id}/checklist` (D120).
 *
 * Errors propagate, for the same reason they do in `readServiceRequestIdentities` and for the same
 * reason the queue read refuses to fall back to `[]`: the failure mode of a swallowed checklist is
 * a desk told that nothing has been filed when the truth is that nobody asked. "No documents yet"
 * and "we could not find out" are different sentences and the caller renders them differently.
 *
 * No role gate, and none is missing. `ServiceRequestService.checklist` guards on participation and
 * answers a stranger with 404 rather than 403 — which requests exist is not a fact this API
 * confirms to people who are not on them — so an ops caller reaches it exactly when they can
 * already read the request itself.
 */
export async function readServiceRequestChecklist(id) {
  return toChecklist(await get(`/service-requests/${encodeURIComponent(id)}/checklist`));
}

export async function getServiceRequest(id) {
  try {
    return toViewModel(await get(`/service-requests/${encodeURIComponent(id)}`));
  } catch (e) {
    // Somebody else's request is a 404 by design — visibility misses are 404, not 403, so the id is
    // the only thing that distinguishes access. The tracker renders a missing request the same way.
    // Only "not found / forbidden" collapses to null; a 500, network drop, or dead session must
    // propagate so the caller's `allSettled` surfaces a real failure rather than a false empty.
    if (e?.status === 404 || e?.status === 403) return null;
    throw e;
  }
}

export async function createServiceRequest(data) {
  return toViewModel(await post('/service-requests', toCreate(data)));
}

/**
 * Record the parties' identity numbers against a request (D151).
 *
 * A separate call after the create rather than a field on the create body, deliberately: the create
 * response is a `ServiceRequest` the tracker renders and logs, and a payload that carries an Aadhaar
 * number is one refactor away from being echoed onto it. This request has no response to leak into —
 * the server answers 204.
 *
 * `PUT`, because the body is the whole set: the wizard resubmits every party when the customer fixes
 * one, and appending would leave the mistyped number behind under a shifted index.
 *
 * Sends nothing when there is nothing to send, so a desk with no identity fields (a legal opinion, a
 * packers quote) does not post an empty set the server would 422.
 */
export async function recordServiceRequestIdentities(id, parties) {
  if (!id || !Array.isArray(parties) || parties.length === 0) return;
  await put(`/service-requests/${encodeURIComponent(id)}/identities`, { parties });
}

/**
 * Post a customer message.
 *
 * The endpoint returns the created `Message`, but the mock returns the whole updated request and the
 * tracker reloads the list afterwards regardless — so re-read the request to keep the return shape
 * identical across providers (what the parity harness pins).
 */
export async function addServiceRequestMessage(id, text) {
  // Mirror the mock's guard (serviceFlow.addMessage): a blank body is a no-op that returns the
  // request unchanged, rather than POSTing an empty message the server would 400 or store blank.
  const body = String(text || '').trim();
  if (!body) return getServiceRequest(id);
  await post(`/service-requests/${encodeURIComponent(id)}/messages`, { body });
  return getServiceRequest(id);
}

/**
 * Approve or reject a shared draft — the checker's half of the maker-checker.
 *
 * The tracker speaks `'accepted'`/`'changes'`; the contract speaks `approve`/`reject`. A rejection
 * is not a failure — the server returns the request to `in-progress` for ops to revise.
 */
export async function decideServiceRequestDraft(id, decision, note) {
  const wire = decision === 'accepted' ? 'approve' : 'reject';
  return toViewModel(
    await post(`/service-requests/${encodeURIComponent(id)}/draft/decision`, {
      decision: wire,
      note: note || '',
    }),
  );
}

/**
 * Co-fill counterparty requests. No endpoint — the server scopes every request to its requester —
 * so there is nothing to merge in http mode. Empty array, never undefined: the tracker spreads it.
 */
export async function listPartyServiceRequests() {
  return [];
}

/** No read-receipt endpoint on service requests. No-op; unread badges are mock-only in http mode. */
export async function markServiceRequestRead() {}
