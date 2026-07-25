/**
 * Mock document provider — wraps data/documents.js
 */
import {
  getDocsForProp as _getDocsForProp,
  addDocument as _addDocument,
  deleteDocument as _deleteDocument,
  getDocRequests as _getDocRequests,
  addDocRequest as _addDocRequest,
  respondDocRequest as _respondDocRequest,
  getPendingDocRequestCount as _getPendingDocRequestCount,
  getChecklistProgress as _getChecklistProgress,
} from '../../../lib/data/documents.js';

export const getDocsForProp = (mobile, propId) => Promise.resolve(_getDocsForProp(mobile, propId));
export const addDocument = (mobile, propId, data) => Promise.resolve(_addDocument(mobile, propId, data));
export const deleteDocument = (mobile, propId, docId) => Promise.resolve(_deleteDocument(mobile, propId, docId));
export const getDocRequests = (mobile) => Promise.resolve(_getDocRequests(mobile));
export const addDocRequest = (mobile, data) => Promise.resolve(_addDocRequest(mobile, data));
export const respondDocRequest = (mobile, reqId, decision) => Promise.resolve(_respondDocRequest(mobile, reqId, decision));
export const getPendingDocRequestCount = (mobile) => Promise.resolve(_getPendingDocRequestCount(mobile));
export const getChecklistProgress = (mobile, propId) => Promise.resolve(_getChecklistProgress(mobile, propId));
