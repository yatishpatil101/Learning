import { openDocFrom } from '../../../lib/openDoc.js';
import { getServiceRequestDocumentUrl } from '../../../services/serviceRequestService.js';

export const openRequestDoc = (requestId, docId) =>
  openDocFrom(() => getServiceRequestDocumentUrl(requestId, docId));

export const fmtAgo = (ts) => {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
  return new Date(ts).toLocaleDateString('en-IN');
};
