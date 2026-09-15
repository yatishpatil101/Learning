// The server owns grant tokens and buyer notifications: an owner's session has no authority
// to write another user's inbox. Signed-in buyers read grants without a forwardable token.
import { createProvider } from './config.js';
import { prepareUpload } from '../lib/uploads/prepareUpload.js';

const provider = createProvider('document');

export const listDocuments = async (mobile, propId) => (await provider()).listDocuments(mobile, propId);

/**
 * `prepared` is for a caller that already ran the file through `prepareUpload` — the listing wizard,
 * which prepares at the picker. Preparing is the default: vault callers hand over a raw input file.
 */
export const uploadDocument = async (mobile, propId, upload) => {
  const file = upload.prepared ? upload.file : await prepareUpload(upload.file, { document: true });
  return (await provider()).uploadDocument(mobile, propId, { ...upload, file });
};

export const deleteDocument = async (mobile, propId, docId) =>
  (await provider()).deleteDocument(mobile, propId, docId);

// A managed property may never become a listing, so its vault needs its own identity and routes
// rather than a listing ID or a mode flag on the listing operations.
export const listManagedDocuments = async (mobile, managedId) =>
  (await provider()).listManagedDocuments(mobile, managedId);

export const uploadManagedDocument = async (mobile, managedId, upload) => {
  const file = await prepareUpload(upload.file, { document: true });
  return (await provider()).uploadManagedDocument(mobile, managedId, { ...upload, file });
};

export const deleteManagedDocument = async (mobile, managedId, docId) =>
  (await provider()).deleteManagedDocument(mobile, managedId, docId);

export const listDocRequests = async (mobile) => (await provider()).listDocRequests(mobile);

// Only the owner decides access; the note supplies the server's audit context.
export const respondDocRequest = async (mobile, reqId, decision, note) =>
  (await provider()).respondDocRequest(mobile, reqId, decision, note);

export const requestDocumentAccess = async (body) => (await provider()).requestDocumentAccess(body);

export const listMyDocumentRequests = async (opts) => (await provider()).listMyDocumentRequests(opts);

export const listMyGrantedDocuments = async (requestId, opts) =>
  (await provider()).listMyGrantedDocuments(requestId, opts);

// The token authorizes recipients without an account. Read it from location.hash and send it only
// in X-Share-Token, never the request URL, to keep it out of URL-based access logs and Referer.

// Unknown, declined and expired tokens all yield 401; callers must not distinguish credential
// failures that the server deliberately keeps indistinguishable.
export const listSharedDocuments = async (token) => (await provider()).listSharedDocuments(token);
