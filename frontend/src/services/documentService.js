/**
 * Document Service — the document vault and both sides of its access gate.
 *
 * `GET|POST /me/documents/{propId}`, `DELETE /me/documents/{propId}/{docId}`,
 * `GET /me/documents/requests`, `PATCH /me/documents/requests/{reqId}`.
 *
 * The buyer side is server-backed too: one request carries all selected categories, the requester
 * can poll their own rows, and a granted requester can read the unlocked files without receiving
 * the owner's forwardable token. The anonymous token route remains for an outside recipient.
 *
 * ## Operations
 *
 * | Operation | Endpoint |
 * |---|---|
 * | list a property's files | `GET /me/documents/{propId}` |
 * | upload a file | `POST /me/documents/{propId}` (multipart) |
 * | delete a file | `DELETE /me/documents/{propId}/{docId}` |
 * | list the request inbox | `GET /me/documents/requests` |
 * | grant / decline a request | `PATCH /me/documents/requests/{reqId}` |
 * | buyer requests access | `POST /documents/requests` |
 * | buyer lists their asks | `GET /me/document-requests` |
 * | buyer opens their grant | `GET /me/document-requests/{reqId}/documents` |
 * | outside recipient opens a grant | `GET /documents/shared` + `X-Share-Token` |
 *
 * `countSharedDocs` remains a mock implementation detail behind the provider. The server computes
 * `sharedDocumentCount`, mints the token and notifies the buyer — `document.granted`, raised by
 * `DocumentRequestService`. There was a `notifyBuyerDocsGranted` here that wrote the buyer's row
 * from the *owner's* browser into `localStorage`; it is gone, because a browser holding one
 * session has no authority over another user's inbox and no endpoint that would let it try.
 * Rent agreements stay in `rentService`: they belong to the tenancy domain, not this access gate.
 *
 * ## Presentation stays on `lib/data/documents.js`
 *
 * `DOC_CATEGORIES`, `DOC_INFO`, `docInfo`, `checklistFromDocs`, `formatSize` and `docIcon` are
 * pure functions of a category, a byte count, or an already-fetched document list — surfaces keep
 * importing them directly. Only the *data* operations cross the seam.
 *
 * ## Shape
 *
 * A vault document is `{ id, category, name, size, mime, dataUrl, url, uploadedAt }` — `dataUrl` is
 * the mock's inline base64, `url` the http provider's signed URL, and a viewer opens whichever is
 * present (`url` does not resolve in dev — D120). A request is
 * `{ id, propId, buyerName, buyerMobile, docType, categories, status, requestedAt,
 * acknowledgedDisclaimer, sharedDocumentCount, shareToken, expiresAt }`; `shareToken`/`expiresAt`
 * are the owner's re-send affordance, present only once granted and only in http mode.
 */
import { createProvider } from './config.js';

const provider = createProvider('document');

/**
 * The owner's uploaded files for one property, newest first.
 *
 * @param {string} mobile the owner's mobile (the mock's store key; ignored in http, which scopes by
 *                        session)
 * @param {string} propId
 * @returns {Promise<object[]>}
 */
export const listDocuments = async (mobile, propId) => (await provider()).listDocuments(mobile, propId);

/**
 * Upload one file under a category.
 *
 * @param {string} mobile
 * @param {string} propId
 * @param {{ category: string, file: File }} upload the raw file — the mock turns it into a stored
 *        `dataUrl`, the http provider posts it as `multipart/form-data`
 * @returns {Promise<object>} the created document
 */
export const uploadDocument = async (mobile, propId, upload) =>
  (await provider()).uploadDocument(mobile, propId, upload);

/** Delete one file; resolves to the property's remaining files. */
export const deleteDocument = async (mobile, propId, docId) =>
  (await provider()).deleteDocument(mobile, propId, docId);

/* ---- The managed-property vault ------------------------------------------------------------
 *
 * The property passport's vault. Same three operations, same shapes, different subject: these hang
 * off a *managed* property, which may never become a listing at all. That is the whole point of the
 * passport — an owner assembles their paperwork before deciding to advertise, or instead of it — so
 * the vault cannot be addressed by a listing id.
 *
 * Kept as three separate exports rather than a flag on the originals because the two are different
 * routes against different tables live, and a boolean argument at the call site reads like a
 * variation on one thing when it is really two.
 */

/**
 * The owner's uploaded files for one managed property, newest first.
 *
 * @param {string} mobile the owner's mobile (the mock's store key; ignored in http, which scopes by
 *                        session)
 * @param {string} managedId
 * @returns {Promise<object[]>}
 */
export const listManagedDocuments = async (mobile, managedId) =>
  (await provider()).listManagedDocuments(mobile, managedId);

/**
 * Upload one file to a managed property's vault.
 *
 * @param {string} mobile
 * @param {string} managedId
 * @param {{ category: string, file: File }} upload
 * @returns {Promise<object>} the created document
 */
export const uploadManagedDocument = async (mobile, managedId, upload) =>
  (await provider()).uploadManagedDocument(mobile, managedId, upload);

/** Delete one file from a managed property's vault; resolves to what is left. */
export const deleteManagedDocument = async (mobile, managedId, docId) =>
  (await provider()).deleteManagedDocument(mobile, managedId, docId);

/** The owner's inbox of buyer requests. */
export const listDocRequests = async (mobile) => (await provider()).listDocRequests(mobile);

/**
 * Grant or decline a buyer request — the owner is the gatekeeper.
 *
 * @param {string} mobile
 * @param {string} reqId
 * @param {'granted'|'declined'} decision
 * @param {string} [note] carried onto the server's audit note; ignored by the mock
 * @returns {Promise<object|null>} the updated request (carrying `shareToken` once granted, in http)
 */
export const respondDocRequest = async (mobile, reqId, decision, note) =>
  (await provider()).respondDocRequest(mobile, reqId, decision, note);

/** Submit one buyer request carrying every category shown on the listing. */
export const requestDocumentAccess = async (body) => (await provider()).requestDocumentAccess(body);

/** List the signed-in buyer's own document-access requests. */
export const listMyDocumentRequests = async (opts) => (await provider()).listMyDocumentRequests(opts);

/** Read documents unlocked by one of the signed-in buyer's own grants. */
export const listMyGrantedDocuments = async (requestId, opts) =>
  (await provider()).listMyGrantedDocuments(requestId, opts);

/**
 * Read the documents one grant unlocked, by share token — the buyer/recipient side of the flow.
 *
 * The only operation in this service with no session behind it: the token *is* the authorisation,
 * because the person opening the link may be a lawyer or a bank officer with no PuneNest account.
 * The http provider sends it on an `X-Share-Token` header and never in the URL (D42), so it stays
 * out of access logs, `Referer`, and anything else that records a URL.
 *
 * @param {string} token the share token, read by `/shared-documents` from `location.hash`
 * @returns {Promise<object[]>} the shared documents, in the same view model the vault uses
 * @throws {ApiError} 401 for every credential failure the server refuses to distinguish — unknown,
 *         declined, expired — so a caller must not try to tell them apart either
 */
export const listSharedDocuments = async (token) => (await provider()).listSharedDocuments(token);
