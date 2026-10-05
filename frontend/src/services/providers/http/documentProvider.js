import { get, del, patch, post, postMultipart, unwrapFullPage } from '../../http.js';
// Leaf module, no imports of its own — see its header. Deliberately not from `http.js`.
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { toDoc, toDocList, toRequest, toRequestList, toStatusUpdate } from './documentMapper.js';

/** The owner's uploaded files for one property, newest first (the server already orders them). */
export async function listDocuments(_mobile, propId) {
  const res = await get(`/me/documents/${encodeURIComponent(propId)}`);
  // Bare array by contract; tolerate a paged envelope in case the endpoint is paged later.
  return toDocList(res?.content ?? (Array.isArray(res) ? res : []));
}

/** Upload one file under a category. `file` is a `File`/`Blob`, not a data URL. */
export async function uploadDocument(_mobile, propId, { category, file } = {}) {
  const form = new FormData();
  form.append('category', category || 'Other');
  form.append('file', file);
  return toDoc(await postMultipart(`/me/documents/${encodeURIComponent(propId)}`, form));
}

/** A file in the caller's personal vault — not tied to a listing, e.g. a tenant host's agreement. */
export async function uploadPersonalDocument({ category, file } = {}) {
  const form = new FormData();
  form.append('category', category || 'Other');
  form.append('file', file);
  return toDoc(await postMultipart('/me/documents/personal', form));
}

/** The endpoint answers 204, so the trimmed list has to be re-read rather than synthesised by filtering a stale one. */
export async function deleteDocument(mobile, propId, docId) {
  await del(`/me/documents/${encodeURIComponent(propId)}/${encodeURIComponent(docId)}`);
  return listDocuments(mobile, propId);
}

/* Managed vaults work before a property is advertised, so they use managed ids. */
/** The owner's uploaded files for one managed property, newest first. */
export async function listManagedDocuments(_mobile, managedId) {
  const res = await get(`/me/documents/managed/${encodeURIComponent(managedId)}`);
  return toDocList(res?.content ?? (Array.isArray(res) ? res : []));
}

/** Upload one file to a managed property's vault. */
export async function uploadManagedDocument(_mobile, managedId, { category, file } = {}) {
  const form = new FormData();
  form.append('category', category || 'Other');
  form.append('file', file);
  return toDoc(await postMultipart(`/me/documents/managed/${encodeURIComponent(managedId)}`, form));
}

/** Delete one file from a managed property's vault; resolves to what is left. */
export async function deleteManagedDocument(mobile, managedId, docId) {
  await del(`/me/documents/managed/${encodeURIComponent(managedId)}/${encodeURIComponent(docId)}`);
  return listManagedDocuments(mobile, managedId);
}

/** Leaving it off takes the server's default of twenty, which is not "the inbox" but "the first page of it": a grant
 * on the twenty-first request would come back as `null` and the panel would show nothing happening. */
export async function listDocRequests() {
  const res = await get('/me/documents/requests', { size: MAX_PAGE_SIZE });
  return toRequestList(unwrapFullPage(res, 'document'));
}

/** Grant or decline a request. The endpoint returns 200 with an empty body and mints the share token server-side, so
 * re-read the inbox and hand back the updated row (now carrying `shareToken`). */
export async function respondDocRequest(mobile, reqId, decision, note) {
  await patch(`/me/documents/requests/${encodeURIComponent(reqId)}`, toStatusUpdate(decision, note));
  const reqs = await listDocRequests(mobile);
  return reqs.find((r) => r.id === reqId) || null;
}

/** One buyer ask carrying every category shown on the property page. */
export async function requestDocumentAccess({
  propertyId, categories = [], message = '', acknowledgedDisclaimer = false,
} = {}) {
  return toRequest(await post('/documents/requests', {
    propertyId,
    categories,
    message: message || undefined,
    acknowledgedDisclaimer: !!acknowledgedDisclaimer,
  }));
}

/** The signed-in buyer's own asks, newest first. */
export async function listMyDocumentRequests() {
  const res = await get('/me/document-requests', { size: MAX_PAGE_SIZE });
  return toRequestList(unwrapFullPage(res, 'document'));
}

/** Documents one of the signed-in buyer's own live grants unlocked. */
export async function listMyGrantedDocuments(requestId) {
  const res = await get(`/me/document-requests/${encodeURIComponent(requestId)}/documents`);
  return toDocList(Array.isArray(res) ? res : (res?.content ?? []));
}

/** Read a granted share by token — the one operation here with no session behind it. */
export async function listSharedDocuments(token) {
  const res = await get('/documents/shared', undefined, {
    auth: false,
    headers: { 'X-Share-Token': token },
  });
  return toDocList(Array.isArray(res) ? res : (res?.content ?? []));
}
