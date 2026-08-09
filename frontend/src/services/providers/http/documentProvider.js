/**
 * HTTP document provider — the live counterpart to `providers/mock/documentProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `documentService.js` is
 * the only contract between them and a migrated owner surface may not care which is active. Shape
 * translation — and the divergence it papers over — lives in `documentMapper.js`.
 *
 * ## The honest subset
 *
 * Only the **owner's** side of the vault is live here: listing, uploading and deleting their own
 * files, and reading/answering the buyer requests in their inbox. Each maps to a real endpoint:
 *
 *   | Operation           | Endpoint                                   |
 *   |---------------------|--------------------------------------------|
 *   | list vault docs     | `GET /me/documents/{propId}`               |
 *   | upload (multipart)  | `POST /me/documents/{propId}`              |
 *   | delete              | `DELETE /me/documents/{propId}/{docId}`    |
 *   | inbox: list         | `GET /me/documents/requests`               |
 *   | inbox: grant/decline| `PATCH /me/documents/requests/{reqId}`     |
 *
 * The **buyer's** side (asking for access, polling a request's status, opening a shared bundle) is a
 * client cross-user flow with no faithful contract surface and stays mock-only — see the boundary
 * table in `documentService.js`. The dev signed-URL limitation means an uploaded file's *bytes* do
 * not render in dev (D120); the upload round-trip, list and delete are fully live.
 */
import { get, del, patch, postMultipart } from '../../http.js';
import { toDoc, toDocList, toRequestList, toStatusUpdate } from './documentMapper.js';

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

/** The owner's inbox of buyer requests. */
export async function listDocRequests() {
  const res = await get('/me/documents/requests');
  return toRequestList(res?.content ?? (Array.isArray(res) ? res : []));
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
