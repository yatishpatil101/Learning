/**
 * HTTP document provider — the live counterpart to `providers/mock/documentProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `documentService.js` is
 * the only contract between them and a migrated owner surface may not care which is active. Shape
 * translation — and the divergence it papers over — lives in `documentMapper.js`.
 *
 * Every data operation in the document flow now has a server counterpart. The two ways to read a
 * grant are intentionally separate: a signed-in requester proves identity with their JWT; an
 * outside lawyer or banker proves possession of the owner's expiring share token.
 *
 *   | Operation           | Endpoint                                   |
 *   |---------------------|--------------------------------------------|
 *   | list vault docs     | `GET /me/documents/{propId}`               |
 *   | upload (multipart)  | `POST /me/documents/{propId}`              |
 *   | delete              | `DELETE /me/documents/{propId}/{docId}`    |
 *   | managed: list       | `GET /me/documents/managed/{managedId}`    |
 *   | managed: upload     | `POST /me/documents/managed/{managedId}`   |
 *   | managed: delete     | `DELETE /me/documents/managed/{managedId}/{docId}` |
 *   | inbox: list         | `GET /me/documents/requests`               |
 *   | inbox: grant/decline| `PATCH /me/documents/requests/{reqId}`     |
 *   | buyer: request      | `POST /documents/requests`                 |
 *   | buyer: status       | `GET /me/document-requests`                |
 *   | buyer: open grant   | `GET /me/document-requests/{reqId}/documents` |
 *   | recipient: open link| `GET /documents/shared` + `X-Share-Token`  |
 *
 * The dev signed-URL limitation means an uploaded file's *bytes* do not render in dev (D120); the
 * authorisation, request, list and metadata round trips are fully live.
 */
import { get, del, patch, post, postMultipart, unwrapFullPage } from '../../http.js';
// Leaf module, no imports of its own — see its header, and D208. Deliberately not from `http.js`.
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { toDoc, toDocList, toRequest, toRequestList, toStatusUpdate } from './documentMapper.js';

/** The owner's uploaded files for one property, newest first (the server already orders them). */
export async function listDocuments(_mobile, propId) {
  const res = await get(`/me/documents/${encodeURIComponent(propId)}`);
  // Bare array by contract; tolerate a paged envelope in case the endpoint is paged later.
  return toDocList(res?.content ?? (Array.isArray(res) ? res : []));
}

/**
 * Upload one file under a category. `file` is a `File`/`Blob`; the mock derives the same metadata
 * from it that the server records here, so a migrated caller passes the raw file to either provider.
 */
export async function uploadDocument(_mobile, propId, { category, file } = {}) {
  const form = new FormData();
  form.append('category', category || 'Other');
  form.append('file', file);
  return toDoc(await postMultipart(`/me/documents/${encodeURIComponent(propId)}`, form));
}

/**
 * Delete one file, then resolve to the property's remaining files — the mock returns the trimmed
 * list, so re-read to keep the return shape identical (what the parity harness pins).
 */
export async function deleteDocument(mobile, propId, docId) {
  await del(`/me/documents/${encodeURIComponent(propId)}/${encodeURIComponent(docId)}`);
  return listDocuments(mobile, propId);
}

/* ---- The managed-property vault ------------------------------------------------------------
 *
 * The same three operations against a different subject. A managed property is not a listing —
 * it may never become one — so its documents hang off `managed_property_documents` and a separate
 * route family, `/me/documents/managed/{managedId}`. Routing them through `/me/documents/{propId}`
 * would mean the passport's vault only worked for properties the owner had already advertised,
 * which is precisely backwards: the passport exists to be filled in *before* that decision.
 *
 * Identical shapes on the way out, so the vault component does not know which family it is on.
 */

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

/**
 * The owner's inbox of buyer requests. Paged on the wire (D77), read as a list here.
 *
 * The vault panel groups requests by property and by status from one array, and
 * {@link respondDocRequest} re-reads this list to find the row it just granted — both need the
 * whole set, so `size` is asked for explicitly. Leaving it off would have taken the server's
 * default of twenty, which is not "the inbox" but "the first page of it": a grant on the
 * twenty-first request would have come back as `null` and the panel would have shown nothing
 * happening.
 */
export async function listDocRequests() {
  const res = await get('/me/documents/requests', { size: MAX_PAGE_SIZE });
  return toRequestList(unwrapFullPage(res, 'document'));
}

/**
 * Grant or decline a request. The endpoint returns 200 with an empty body and mints the share token
 * server-side, so re-read the inbox and hand back the updated row (now carrying `shareToken`) —
 * matching the mock, which returns the mutated request.
 */
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

/**
 * Read a granted share by token — the one operation here with no session behind it.
 *
 * `auth: false` because the recipient may have no account, and because attaching a stale bearer
 * would drag in the 401-refresh recovery: a 401 from this endpoint means *the share token* is bad,
 * and retrying it after a token refresh would be answering the wrong question.
 *
 * The token goes on `X-Share-Token`, never in the query string (D42). A URL is copied into browser
 * history, written to every proxy and CDN access log on the way, and forwarded verbatim when the
 * recipient pastes the link; a request header is none of those things. The caller reads it from
 * `location.hash`, which browsers do not transmit at all.
 */
export async function listSharedDocuments(token) {
  const res = await get('/documents/shared', undefined, {
    auth: false,
    headers: { 'X-Share-Token': token },
  });
  return toDocList(Array.isArray(res) ? res : (res?.content ?? []));
}
