/**
 * HTTP service-request provider; `serviceRequestService.js` is the only contract to the tracker and
 * `serviceRequestMapper.js` holds shape translation. Document rendering degrades without a vault.
 */
import { del, get, patch, post, postMultipart, put } from '../../http.js';
import {
  toChecklist, toIdentityList, toViewModel, toViewModelList, toViewModelPage, toCreate, toWireType,
} from './serviceRequestMapper.js';

export async function listServiceRequests(typeFilter) {
  // `?type=` filters on the stored wire type, so an untranslated `rental` matches nothing and
  // renders "no requests" over a tracker that is actually full.
  const qs = typeFilter ? `?type=${encodeURIComponent(toWireType(typeFilter))}` : '';
  const res = await get(`/service-requests${qs}`);
  // Paged envelope in the general case; tolerate a bare array in case the endpoint is unpaged.
  return toViewModelList(res?.content ?? (Array.isArray(res) ? res : []));
}

/**
 * The desk's view of the same path — scope is role-derived, so only the session separates "mine"
 * from "everyone's" and no consumer surface may call it. Genuinely paged; totals come from the envelope.
 */
export async function listServiceRequestQueue({ type, status, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (type) query.type = toWireType(type);
  if (status) query.status = status;
  return toViewModelPage(await get('/service-requests', query), { page, size });
}

/**
 * Take a request for the *calling* staff member — assignment and acknowledgement are one act, and a
 * queue you can push work into is one people push work into. It also gates the identity read.
 */
export async function takeServiceRequest(id) {
  return toViewModel(
    await patch(`/service-requests/${encodeURIComponent(id)}/status`, { status: 'assigned' }),
  );
}

/**
 * The assigned operator's read of the parties' identity numbers. Errors propagate: collapsing a 403
 * would render "nothing was recorded" over a refusal, so the caller shows `err.message`.
 */
export async function readServiceRequestIdentities(id) {
  return toIdentityList(await get(`/service-requests/${encodeURIComponent(id)}/identities`));
}

/**
 * The document checklist. Errors propagate: "no documents yet" and "we could not find out" are
 * different sentences. The server guards on participation and answers a stranger 404, not 403.
 */
export async function readServiceRequestChecklist(id) {
  return toChecklist(await get(`/service-requests/${encodeURIComponent(id)}/checklist`));
}

export async function getServiceRequest(id) {
  try {
    return toViewModel(await get(`/service-requests/${encodeURIComponent(id)}`));
  } catch (e) {
    // Somebody else's request is a 404 by design, so only "not found / forbidden" collapses to
    // null; a 500 or dead session must propagate or `allSettled` reports a false empty.
    if (e?.status === 404 || e?.status === 403) return null;
    throw e;
  }
}

export async function createServiceRequest(data) {
  return toViewModel(await post('/service-requests', toCreate(data)));
}

/**
 * Deferred co-fill create: commit awaiting-payment with no checkout yet, and invite the second
 * party.
 */
export async function createCoFillServiceRequest({ request, role, mobile }) {
  return toViewModel(await post('/service-requests/co-fill', {
    request: toCreate(request || {}),
    role,
    mobile,
  }));
}

/** Outstanding invitations addressed to the signed-in account. */
export async function listMyServiceRequestInvites() {
  const rows = await get('/me/service-request-invites');
  return Array.isArray(rows) ? rows : [];
}

/** Accept or decline one invitation. */
export async function decideServiceRequestInvite(partyId, decision) {
  return post(`/me/service-request-invites/${encodeURIComponent(partyId)}`, { decision });
}

/** Accepted invitee submits their section of the details payload. */
export async function submitServiceRequestPartyDetails(id, details) {
  return toViewModel(await put(`/service-requests/${encodeURIComponent(id)}/party-details`, {
    details: details || {},
  }));
}

/** Requester opens checkout for a deferred co-fill request. */
export async function openServiceRequestCheckout(id) {
  return toViewModel(await post(`/service-requests/${encodeURIComponent(id)}/checkout`, {}));
}

/**
 * Requester takes an unanswered invitation back. Answers 204, so re-read the request: withdrawing
 * frees the role, and whether it is re-issuable is the server's answer to give.
 */
export async function withdrawServiceRequestParty(id, partyId) {
  await del(`/service-requests/${encodeURIComponent(id)}/parties/${encodeURIComponent(partyId)}`);
  return getServiceRequest(id);
}

const toUploadFile = (doc = {}) => {
  const name = doc?.fileName || 'document.bin';
  const mime = doc?.mime || 'application/octet-stream';
  const dataUrl = String(doc?.dataUrl || '');
  const comma = dataUrl.indexOf(',');
  if (comma <= 0 || !dataUrl.startsWith('data:')) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
};

/** Upload one customer document to `POST /service-requests/{id}/docs` and return the fresh request. */
export async function addServiceRequestDoc(id, doc) {
  const file = toUploadFile(doc);
  if (!file) return getServiceRequest(id);
  // Service attachments share the vault's server size gate, including invited-party uploads.
  const { prepareUpload } = await import('../../../lib/uploads/prepareUpload.js');
  const prepared = await prepareUpload(file, { document: true });
  const form = new FormData();
  form.append('category', 'service-request');
  form.append('file', prepared);
  await postMultipart(`/service-requests/${encodeURIComponent(id)}/docs`, form);
  return getServiceRequest(id);
}

/**
 * Identity numbers go in a separate 204 call so an Aadhaar can never be echoed onto a rendered
 * create response. `PUT` because the body is the whole set; sends nothing when there is nothing.
 */
export async function recordServiceRequestIdentities(id, parties) {
  if (!id || !Array.isArray(parties) || parties.length === 0) return;
  await put(`/service-requests/${encodeURIComponent(id)}/identities`, { parties });
}

/**
 * Post a customer message. The endpoint returns the created `Message` but the tracker needs the
 * mapped request view model, so re-read the request after posting.
 */
export async function addServiceRequestMessage(id, text) {
  // A blank body is a no-op that returns the request unchanged rather than POSTing an empty message.
  const body = String(text || '').trim();
  if (!body) return getServiceRequest(id);
  await post(`/service-requests/${encodeURIComponent(id)}/messages`, { body });
  return getServiceRequest(id);
}

/**
 * The checker's half of the maker-checker: the tracker speaks `'accepted'`/`'changes'`, the contract
 * `approve`/`reject`. A rejection is not a failure — the request returns to `in-progress`.
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

/** Mark messages from the other side as read. The endpoint intentionally returns no body. */
export async function markServiceRequestRead(id) {
  await post(`/service-requests/${encodeURIComponent(id)}/read`, {});
}
