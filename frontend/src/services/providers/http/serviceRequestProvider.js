/** HTTP service-request provider; `serviceRequestService.js` is the only contract to the tracker and
 * `serviceRequestMapper.js` holds shape translation. */
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

export async function listServiceRequestQueue({ type, status, mine, unassigned, overdue, q, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (type) query.type = toWireType(type);
  if (status) query.status = Array.isArray(status) ? status.join(',') : status;
  if (mine) query.mine = true;
  if (unassigned) query.unassigned = true;
  if (overdue) query.overdue = true;
  if (q) query.q = q;
  return toViewModelPage(await get('/service-requests', query), { page, size });
}

export async function getServiceRequestQueueSummary(team) {
  return get('/service-requests/queue-summary', team ? { team } : {});
}

export async function takeServiceRequest(id) {
  return toViewModel(
    await patch(`/service-requests/${encodeURIComponent(id)}/status`, { status: 'assigned' }),
  );
}

const uploadStaffDocument = async (id, path, file, fields = {}) => {
  if (!file) throw new Error('Choose a document to upload.');
  const { prepareUpload } = await import('../../../lib/uploads/prepareUpload.js');
  const prepared = await prepareUpload(file, { document: true });
  const form = new FormData();
  form.append('file', prepared);
  Object.entries(fields).forEach(([key, value]) => {
    [value].flat().forEach((item) => {
      const text = String(item ?? '').trim();
      if (text) form.append(key, text);
    });
  });
  return postMultipart(`/service-requests/${encodeURIComponent(id)}${path}`, form);
};

/** Rent-agreement drafts include every `checks` key or the server answers 422. */
export async function shareServiceRequestDraft(id, { file, note, checks } = {}) {
  return toViewModel(await uploadStaffDocument(id, '/draft', file, { note, checks }));
}

export async function uploadServiceRequestFinalDoc(id, file, registration = {}) {
  await uploadStaffDocument(id, '/final-doc', file, registration);
  return getServiceRequest(id);
}

/** Cancel as ops. The server requires and forwards the reason to the customer. */
export async function cancelServiceRequestAsOps(id, reason) {
  return toViewModel(await patch(`/service-requests/${encodeURIComponent(id)}/status`, {
    status: 'cancelled',
    note: String(reason || '').trim(),
  }));
}

/** The assigned operator's read of the parties' identity numbers. Errors propagate: collapsing a 403 would render
 * "nothing was recorded" over a refusal, so the caller shows `err.message`. */
export async function readServiceRequestIdentities(id) {
  return toIdentityList(await get(`/service-requests/${encodeURIComponent(id)}/identities`));
}

export async function readServiceRequestChecklist(id) {
  return toChecklist(await get(`/service-requests/${encodeURIComponent(id)}/checklist`));
}

/** Verify or reject the newest paper in one checklist slot (the holder or an admin). */
export async function reviewServiceRequestDocument(id, category, { documentId, verdict, reason } = {}) {
  const body = { documentId, verdict };
  if (reason) body.reason = reason;
  return toChecklist(await put(
    `/service-requests/${encodeURIComponent(id)}/checklist/${encodeURIComponent(category)}`, body));
}

/** Re-priced terms on a paid rent agreement (the holder or an admin); `terms` names only what changes. */
export async function proposeServiceRequestAmendment(id, { reason, ...terms } = {}) {
  return toViewModel(await post(`/service-requests/${encodeURIComponent(id)}/amendments`, { ...terms, reason }));
}

/** The requester accepts; a positive difference answers a `paymentSessionId` to pay it with. */
export async function acceptServiceRequestAmendment(id, amendmentId) {
  return toViewModel(await post(
    `/service-requests/${encodeURIComponent(id)}/amendments/${encodeURIComponent(amendmentId)}/accept`));
}

export async function withdrawServiceRequestAmendment(id, amendmentId) {
  return toViewModel(await post(
    `/service-requests/${encodeURIComponent(id)}/amendments/${encodeURIComponent(amendmentId)}/withdraw`));
}

const refundsPath = (id) => `/service-requests/${encodeURIComponent(id)}/refunds`;

export async function getServiceRequestRefunds(id) {
  return get(refundsPath(id));
}

export async function requestServiceRequestRefund(id, { amount, dutyPaid, grn, reason } = {}) {
  return post(refundsPath(id), { amount, dutyPaid: !!dutyPaid, grn: grn || undefined, reason });
}

/** `decision` is `approve` or `reject`; a rejection needs the `note`. */
export async function decideServiceRequestRefund(id, refundId, decision, note) {
  return post(`${refundsPath(id)}/${encodeURIComponent(refundId)}/${decision}`, note ? { note } : {});
}

export async function confirmServiceRequestPoliceIntimation(id, { reference, submittedOn } = {}) {
  return toViewModel(await post(`/service-requests/${encodeURIComponent(id)}/police-intimation`, {
    reference: reference || undefined,
    submittedOn: submittedOn || undefined,
  }));
}

/** The tenancy rows a registered copy produced, for the second operator's check. Errors propagate. */
export async function listServiceRequestRentAgreements(id) {
  const rows = await get(`/service-requests/${encodeURIComponent(id)}/rent-agreements`);
  return Array.isArray(rows) ? rows : [];
}

/** Other live rent agreements on the same flat whose term overlaps this one. Errors propagate. */
export async function listServiceRequestOverlaps(id) {
  const rows = await get(`/service-requests/${encodeURIComponent(id)}/overlaps`);
  return Array.isArray(rows) ? rows : [];
}

/** `registered` after checking the copy, or `expired` when the tenant is not on it. */
export async function verifyRentAgreement(agreementId, status) {
  return patch(`/admin/rent-agreements/${encodeURIComponent(agreementId)}`, { status });
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

export async function openServiceRequestCheckout(id, declaration) {
  return toViewModel(await post(`/service-requests/${encodeURIComponent(id)}/checkout`,
    declaration ? { declaration } : {}));
}

// Local backend only: settles a mock-gateway order the way the Cashfree webhook would.
export async function simulateServiceRequestPayment(id, outcome = 'paid') {
  return toViewModel(await post(`/service-requests/${encodeURIComponent(id)}/payment/simulate?outcome=${outcome}`, {}));
}

/** Requester cancels their own request while it still awaits payment. */
export async function cancelServiceRequest(id) {
  return toViewModel(await post(`/service-requests/${encodeURIComponent(id)}/cancel`, {}));
}

export async function withdrawServiceRequestParty(id, partyId) {
  await del(`/service-requests/${encodeURIComponent(id)}/parties/${encodeURIComponent(partyId)}`);
  return getServiceRequest(id);
}

/** Requester invites a counterparty onto an existing request, e.g. after the first one declined. */
export async function inviteServiceRequestParty(id, { role, mobile, partyIndex }) {
  await post(`/service-requests/${encodeURIComponent(id)}/parties`, { role, mobile, partyIndex });
  return getServiceRequest(id);
}

/** Files one of the caller's own personal-vault papers: a vault row carries a signed URL, not bytes. */
export async function addServiceRequestDocFromVault(id, { documentId, category }) {
  await post(`/service-requests/${encodeURIComponent(id)}/docs/from-vault`, { documentId, category });
}

const toUploadFile = (doc = {}) => {
  if (doc?.file instanceof File) return doc.file;
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

export async function addServiceRequestDoc(id, doc) {
  const file = toUploadFile(doc);
  if (!file) return getServiceRequest(id);
  // Service attachments share the vault's server size gate, including invited-party uploads.
  const { prepareUpload } = await import('../../../lib/uploads/prepareUpload.js');
  const prepared = await prepareUpload(file, { document: true });
  const form = new FormData();
  form.append('category', doc?.category || 'service-request');
  form.append('file', prepared);
  await postMultipart(`/service-requests/${encodeURIComponent(id)}/docs`, form);
  return getServiceRequest(id);
}

/** Identity numbers go in a separate 204 call so an Aadhaar can never be echoed onto a rendered create response.
 * `PUT` because the body is the whole set; sends nothing when there is nothing. */
export async function recordServiceRequestIdentities(id, parties) {
  if (!id || !Array.isArray(parties) || parties.length === 0) return;
  await put(`/service-requests/${encodeURIComponent(id)}/identities`, { parties });
}

export async function addServiceRequestMessage(id, text) {
  // A blank body is a no-op that returns the request unchanged rather than POSTing an empty message.
  const body = String(text || '').trim();
  if (!body) return getServiceRequest(id);
  await post(`/service-requests/${encodeURIComponent(id)}/messages`, { body });
  return getServiceRequest(id);
}

/** The checker's half of the maker-checker: the tracker speaks `'accepted'`/`'changes'`, the contract
 * `approve`/`reject`. */
export async function decideServiceRequestDraft(id, decision, note) {
  const wire = decision === 'accepted' ? 'approve' : 'reject';
  return toViewModel(
    await post(`/service-requests/${encodeURIComponent(id)}/draft/decision`, {
      decision: wire,
      note: note || '',
    }),
  );
}

export async function approveServiceRequestDraftParty(id, partyKey, otp) {
  const body = otp ? { partyKey, otp } : { partyKey };
  return post(`/service-requests/${encodeURIComponent(id)}/draft/otp`, body);
}

export async function checkServiceRequestDraft(id, decision, note) {
  const wire = decision === 'release' ? 'release' : 'send-back';
  return toViewModel(
    await post(`/service-requests/${encodeURIComponent(id)}/draft/check`, {
      decision: wire,
      note: note || '',
    }),
  );
}

/** Mark messages from the other side as read. The endpoint intentionally returns no body. */
export async function markServiceRequestRead(id) {
  await post(`/service-requests/${encodeURIComponent(id)}/read`, {});
}

export async function markServiceRequestDraftOpened(id) {
  await post(`/service-requests/${encodeURIComponent(id)}/draft/opened`, {});
}
