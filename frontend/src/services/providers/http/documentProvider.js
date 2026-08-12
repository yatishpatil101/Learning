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
import { get, del, patch, postMultipart, unwrapFullPage } from '../../http.js';
// Leaf module, no imports of its own — see its header, and D208. Deliberately not from `http.js`.
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
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
