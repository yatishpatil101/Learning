/**
 * Mock document provider — the offline counterpart to `providers/http/documentProvider.js`, and the
 * default the app runs on with no backend.
 *
 * It wraps the existing `lib/data/documents.js` store (the same `localStorage` keys the HTML
 * prototype used) and reshapes its rows into the **same view models** the http provider returns, so
 * every owner and buyer surface reads one object shape from either. The presentation helpers stay
 * in `lib/data/documents.js`; its storage mutations are implementation details behind this provider.
 *
 * `uploadDocument` owns the `File` → base64 `dataUrl` conversion the vault UI used to do inline: the
 * seam speaks in `File`s (what the multipart endpoint needs), and the mock is where a file becomes
 * the stored `dataUrl`. Files over the cap keep only their metadata — the same graceful fallback the
 * store has always used, so a large upload never blows the `localStorage` quota.
 */
import {
  getDocsForProp, addDocument, deleteDocument as removeDocument,
  getDocRequests, addDocRequest, respondDocRequest as respondRequest,
} from '../../../lib/data/documents.js';

/** Bytes kept inline as a `dataUrl`; over this only metadata is stored (quota-safe fallback). */
const SIZE_CAP = 3 * 1024 * 1024; // 3 MB

/** Read a `File`/`Blob` as a base64 data URL, or null if it is over the cap or unreadable here. */
function readDataUrl(file) {
  if (!file || file.size > SIZE_CAP || typeof FileReader === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** One stored vault row → the shared view model (adds the http-only `url`, absent here). */
const toDocVm = (d) => (d ? { ...d, url: null } : null);

/** One stored request row → the shared view model (fills the http-only token/expiry as absent). */
const toRequestVm = (r) =>
  (r
    ? {
        id: r.id,
        propId: r.propId,
        buyerName: r.buyerName || 'Buyer',
        buyerMobile: r.buyerMobile || '',
        docType: r.docType || 'Document',
        categories: Array.isArray(r.categories) ? [...r.categories] : (r.docType ? [r.docType] : []),
        status: r.status || 'pending',
        sharedDocumentCount: Array.isArray(r.sharedDocIds) ? r.sharedDocIds.length : 0,
        requestedAt: r.requestedAt || 0,
        acknowledgedDisclaimer: !!r.acknowledgedDisclaimer,
        shareToken: null,
        expiresAt: null,
      }
    : null);

/** The owner's uploaded files for one property. */
export async function listDocuments(mobile, propId) {
  return getDocsForProp(mobile, propId).map(toDocVm);
}

/** Upload one file under a category; the `File` becomes a stored `dataUrl` (or metadata over cap). */
export async function uploadDocument(mobile, propId, { category, file } = {}) {
  const dataUrl = await readDataUrl(file);
  const doc = addDocument(mobile, propId, {
    category,
    name: file?.name,
    size: file?.size,
    mime: file?.type,
    dataUrl,
  });
  return toDocVm(doc);
}

/** Delete one file; resolves to the property's remaining files. */
export async function deleteDocument(mobile, propId, docId) {
  return removeDocument(mobile, propId, docId).map(toDocVm);
}

/* ---- The managed-property vault ------------------------------------------------------------
 *
 * On the server these are a separate route family against a separate table, because a managed
 * property is not a listing. In the browser store there is no such distinction: `documents.js` is
 * keyed by whatever id it is handed, and a managed id is simply another key. So the three managed
 * operations are the three ordinary ones, re-exported under the names the service expects.
 *
 * They are written out rather than aliased so the parity harness sees two independent pairs, and
 * so that the day the mock store does need to tell the two apart, there is somewhere to put it.
 */

/** The owner's uploaded files for one managed property. */
export async function listManagedDocuments(mobile, managedId) {
  return getDocsForProp(mobile, managedId).map(toDocVm);
}

/** Upload one file to a managed property's vault. */
export async function uploadManagedDocument(mobile, managedId, { category, file } = {}) {
  return uploadDocument(mobile, managedId, { category, file });
}

/** Delete one file from a managed property's vault; resolves to what is left. */
export async function deleteManagedDocument(mobile, managedId, docId) {
  return removeDocument(mobile, managedId, docId).map(toDocVm);
}

/** The owner's inbox of buyer requests. */
export async function listDocRequests(mobile) {
  return getDocRequests(mobile).map(toRequestVm);
}

/** Grant or decline a request; resolves to the updated row. */
export async function respondDocRequest(mobile, reqId, decision) {
  return toRequestVm(respondRequest(mobile, reqId, decision));
}

/**
 * Offline counterpart to one multi-category server request. One submit persists one row carrying
 * the complete scope, so granting in mock and HTTP mode authorizes the same set of papers.
 */
export async function requestDocumentAccess({
  ownerMobile, propertyId, buyerName, buyerMobile, categories = [], acknowledgedDisclaimer = false,
} = {}) {
  return toRequestVm(addDocRequest(ownerMobile, {
    propId: propertyId,
    buyerName,
    buyerMobile,
    categories,
    acknowledgedDisclaimer,
  }));
}

/** The mock buyer's asks in the one owner's store the property page knows how to address. */
export async function listMyDocumentRequests({ ownerMobile, buyerMobile } = {}) {
  return getDocRequests(ownerMobile)
    .filter((row) => !buyerMobile || row.buyerMobile === buyerMobile)
    .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0))
    .map(toRequestVm);
}

/** The exact files one mock request granted; no owner-mobile/request-id URL escapes this provider. */
export async function listMyGrantedDocuments(requestId) {
  const currentMobile = (() => {
    try { return JSON.parse(localStorage.getItem('puneNestUser') || '{}').mobile || ''; } catch { return ''; }
  })();
  const storageKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
  const ownerKey = storageKeys.find((key) => {
    if (!key.startsWith('puneNestDocReq:')) return false;
    const ownerMobile = key.slice('puneNestDocReq:'.length);
    return getDocRequests(ownerMobile).some((row) =>
      row.id === requestId && row.buyerMobile === currentMobile);
  });
  if (!ownerKey) return [];
  const ownerMobile = ownerKey.slice('puneNestDocReq:'.length);
  const request = getDocRequests(ownerMobile).find((row) => row.id === requestId);
  if (!request || request.status !== 'granted') return [];
  const sharedIds = new Set(request.sharedDocIds || []);
  return getDocsForProp(ownerMobile, request.propId)
    .filter((document) => sharedIds.has(document.id))
    .map(toDocVm);
}

/**
 * Read a granted share by token — present so the seam's two providers expose the same operations,
 * and empty because the mock has no server to mint a token.
 *
 * Offline signed-in buyers use `listMyGrantedDocuments`; the token path exists for an outside
 * recipient and only a server can mint that credential. So an arbitrary token in mock mode resolves
 * to no documents — the truthful answer for a credential this store cannot know anything about.
 */
export async function listSharedDocuments() {
  return [];
}
