/* Signed URLs are read-time values, never stable storage identifiers. */
/** ISO instant → epoch ms. 0 for a missing date, so a sort never produces NaN. */
function epoch(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function toDoc(dto) {
  if (!dto) return null;
  return {
    id: dto.id,
    category: dto.category || 'Other',
    name: dto.fileName || 'Document',
    size: dto.sizeBytes || 0,
    mime: dto.mimeType || 'application/octet-stream',
    dataUrl: null,
    url: dto.url || null,
    uploadedAt: epoch(dto.uploadedAt),
  };
}

export const toDocList = (rows) => (Array.isArray(rows) ? rows.map(toDoc).filter(Boolean) : []);

export function toRequest(dto) {
  if (!dto) return null;
  const categories = Array.isArray(dto.categories) ? dto.categories : [];
  const requester = dto.requester || {};
  return {
    id: dto.id,
    propId: dto.propertyId,
    requesterId: requester.id || dto.requesterId || '',
    buyerName: requester.name || 'Buyer',
    buyerMobile: requester.mobile || '',
    docType: categories[0] || 'Document',
    categories,
    status: dto.status || 'pending',
    sharedDocumentCount: Math.max(0, Number(dto.sharedDocumentCount) || 0),
    requestedAt: epoch(dto.createdAt),
    acknowledgedDisclaimer: !!dto.acknowledgedDisclaimer,
    shareToken: dto.shareToken || null,
    expiresAt: epoch(dto.expiresAt) || null,
  };
}

export const toRequestList = (rows) => (Array.isArray(rows) ? rows.map(toRequest).filter(Boolean) : []);

/* Guard decisions to the two server statuses so typos fail closed as `declined`. */
export function toStatusUpdate(decision, note) {
  const status = decision === 'granted' ? 'granted' : 'declined';
  return { status, note: note || '' };
}
