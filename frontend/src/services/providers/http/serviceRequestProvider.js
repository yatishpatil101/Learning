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
 *   - **staff transitions** (assign, share draft, upload final) are the ops surface, not the
 *     customer tracker, and remain on `lib/serviceFlow.js`.
 */
import { get, post } from '../../http.js';
import { toViewModel, toViewModelList, toCreate } from './serviceRequestMapper.js';

export async function listServiceRequests(typeFilter) {
  const qs = typeFilter ? `?type=${encodeURIComponent(typeFilter)}` : '';
  const res = await get(`/service-requests${qs}`);
  // Paged envelope in the general case; tolerate a bare array in case the endpoint is unpaged.
  return toViewModelList(res?.content ?? (Array.isArray(res) ? res : []));
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
