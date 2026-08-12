/**
 * Document Service — the owner's document vault and request inbox.
 *
 * `GET|POST /me/documents/{propId}`, `DELETE /me/documents/{propId}/{docId}`,
 * `GET /me/documents/requests`, `PATCH /me/documents/requests/{reqId}`.
 *
 * The document domain does **not** cross the seam whole: only the operations a signed-in *owner* can
 * genuinely drive through the contract are live. The buyer's half of the flow is a client cross-user
 * mechanism (a buyer reads and writes the *owner's* `localStorage`, keyed by the owner's mobile) that
 * the contract deliberately does not expose — the server is token-mediated, and gives a buyer no way
 * to poll a request's status. So that half stays on `lib/data/documents.js`, imported directly by the
 * surfaces that need it, and never routes through this service.
 *
 * ## Live here (owner side)
 *
 * | Operation | Endpoint |
 * |---|---|
 * | list a property's files | `GET /me/documents/{propId}` |
 * | upload a file | `POST /me/documents/{propId}` (multipart) |
 * | delete a file | `DELETE /me/documents/{propId}/{docId}` |
 * | list the request inbox | `GET /me/documents/requests` |
 * | grant / decline a request | `PATCH /me/documents/requests/{reqId}` |
 *
 * ## Stays on `lib/data/documents.js`, and why
 *
 * | Frontend capability | Why it does not cross the seam |
 * |---|---|
 * | buyer requests access (`addDocRequest`) writes the *owner's* store | the contract's `POST /documents/requests` has no matching buyer-side *read*, so the per-document status the property page shows has nothing to poll |
 * | buyer reads a shared bundle (`ViewDocuments`, `?o=owner&r=req`) | the contract shares by opaque `token`, not by owner mobile; the buyer-side link is a mock-only construct |
 * | `countSharedDocs` / `notifyBuyerDocsGranted` (grant side effects) | the server owns the share token and the buyer notification on grant; these are mock-only affordances |
 * | rent agreements (`/me/rent-agreements`) | created as a side effect of the already-live tenancy flow (`lib/data/tenancy.js`), not a standalone form — owned by that domain, not this slice |
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
 * acknowledgedDisclaimer, shareToken, expiresAt }`; `shareToken`/`expiresAt` are the owner's
 * re-send affordance, present only once granted and only in http mode.
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
