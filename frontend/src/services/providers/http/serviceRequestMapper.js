
/* The pre-API frontend vocabulary is richer, so every mapping below must be explicit. */
/** ISO instant → epoch ms. 0 for a missing date, so a sort never produces NaN. */
function epoch(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Staff-side roles. Everything else — buyer, owner, null — is the customer who raised the request. */
const STAFF_ROLES = new Set(['staff', 'manager', 'admin']);

/** Server status → the frontend step vocabulary the stepper and status chip key on. */
const STATUS = {
  'awaiting-payment': 'awaiting_payment',
  new: 'submitted',
  assigned: 'docs_review',
  'in-progress': 'docs_review',
  'draft-shared': 'draft_shared',
  /* Stepper keys are underscored, so the contract's hyphenated rejection status is mapped here. */
  'changes-requested': 'changes_requested',
  approved: 'approved',
  completed: 'completed',
  cancelled: 'cancelled',
};

/* The frontend calls rent agreements `rental`; the contract calls the same desk `rent-agreement`. */
const WIRE_TYPE = { rental: 'rent-agreement' };
const VIEW_TYPE = { 'rent-agreement': 'rental' };

/** Frontend type → the wire type. Used by `toCreate` and by the list's `?type=` filter. */
export const toWireType = (type) => WIRE_TYPE[type] || type;

/** Wire type → the frontend vocabulary the pages filter on (`r.type === 'rental'`). */
const toViewType = (type) => VIEW_TYPE[type] || type;

/** A human service name from the `type`. Falls back to a title-cased type for anything new. */
const SERVICE = {
  rental: 'Rent Agreement',
  legal: 'Property & Legal',
  interior: 'Interior & Renovation',
  packers: 'Packers & Movers',
  valuation: 'Property Valuation',
};
const titleCase = (s) =>
  String(s || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
const serviceName = (type) => SERVICE[type] || titleCase(type) || 'Service request';

/** One wire `Message` → one thread bubble. */
function toMessage(m) {
  if (!m) return null;
  return {
    id: m.id,
    from: STAFF_ROLES.has(m.authorRole) ? 'staff' : 'user',
    text: m.body || '',
    at: epoch(m.createdAt),
    read: Boolean(m.readAt),
  };
}

/** Newest `documents[]` entry of a category, with how many versions exist. */
function newestDoc(docs, category) {
  const rows = docs
    .filter((d) => d && d.category === category)
    .sort((a, b) => epoch(b.uploadedAt) - epoch(a.uploadedAt));
  return { row: rows[0] || null, count: rows.length };
}

/** One wire `ServiceRequest` → one view model. */
export function toViewModel(dto) {
  if (!dto) return null;
  const docs = Array.isArray(dto.documents) ? dto.documents : [];
  const draftDoc = newestDoc(docs, 'draft');
  const finalDoc = newestDoc(docs, 'final-document');
  const messages = (Array.isArray(dto.messages) ? dto.messages : []).map(toMessage).filter(Boolean);
  const timeline = (Array.isArray(dto.timeline) ? dto.timeline : []).map((t) => ({
    stage: t?.event || '',
    by: t?.by || '',
    at: epoch(t?.at),
  }));
  const status = STATUS[dto.status] || dto.status;
  const created = epoch(dto.createdAt);
  const draft = draftDoc.row
    ? {
        id: draftDoc.row.id || '',
        fileName: draftDoc.row.fileName || 'draft',
        sharedAt: epoch(draftDoc.row.uploadedAt),
        version: draftDoc.count,
        opened: timeline.reduce((seen, t) => (t.stage === 'draft.shared' ? false : t.stage === 'draft.opened' || seen), false),
      }
    : null;
  const final = finalDoc.row
    ? {
        id: finalDoc.row.id || '',
        fileName: finalDoc.row.fileName || 'final-document',
        uploadedAt: epoch(finalDoc.row.uploadedAt),
      }
    : null;
  const updatedAt = Math.max(
    created,
    draft?.sharedAt || 0,
    final?.uploadedAt || 0,
    ...messages.map((x) => x.at),
    ...timeline.map((t) => t.at),
  );
  const type = toViewType(dto.type);
  return {
    id: dto.id,
    type,
    service: serviceName(type),
    status,
    // Structured on the wire and round-tripped; `{}` for a request that carried none, so the
    // tracker's optional chaining stays safe rather than reading `undefined`.
    details: dto.details && typeof dto.details === 'object' ? dto.details : {},
    docs: docs.map((document) => ({
      id: document?.id || '',
      category: document?.category || '',
      fileName: document?.fileName || 'document',
      uploadedAt: epoch(document?.uploadedAt),
    })),
    draft,
    finalDoc: final,
    /* Draft decisions use request time because the wire carries no separate decision timestamp. */
    draftDecision: dto.status === 'approved' ? { type: 'accepted', at: created }
      : dto.status === 'changes-requested' ? { type: 'changes', at: created }
        : null,
    messages,
    timeline,
    /* Parties pass through: this DTO already matches both readers' shape. */
    parties: (Array.isArray(dto.parties) ? dto.parties : []).map((p) => ({
      id: p?.id || '',
      requestId: p?.requestId || dto.id,
      role: p?.role || '',
      partyIndex: p?.partyIndex ?? 0,
      status: p?.status || '',
      party: p?.party || '',
      mobile: p?.mobile || null,
      pending: !!p?.pending,
      invitedBy: p?.invitedBy || '',
      createdAt: epoch(p?.createdAt),
    })),
    assignedTo: dto.assignee || null,
    assignedToMe: !!dto.assignedToMe,
    createdAt: created,
    amount: dto.amount ?? null,
    propertyId: dto.propertyId ?? null,
    paymentSessionId: dto.paymentSessionId ?? null,
    registration: dto.registration ?? null,
    policeIntimation: {
      confirmed: !!dto.policeIntimation?.confirmed,
      confirmedAt: epoch(dto.policeIntimation?.confirmedAt) || null,
      confirmedBy: dto.policeIntimation?.confirmedBy || null,
      reference: dto.policeIntimation?.reference || null,
      submittedOn: dto.policeIntimation?.submittedOn || null,
    },
    sla: dto.sla ? { waitingOn: dto.sla.waitingOn, dueAt: epoch(dto.sla.dueAt) || null, overdue: !!dto.sla.overdue } : null,
    amendment: dto.amendment ? {
      id: dto.amendment.id,
      terms: dto.amendment.terms || {},
      reason: dto.amendment.reason || '',
      amountBefore: dto.amendment.amountBefore ?? 0,
      amountAfter: dto.amendment.amountAfter ?? 0,
      delta: dto.amendment.delta ?? 0,
      checkoutOpen: !!dto.amendment.checkoutOpen,
      proposedAt: epoch(dto.amendment.proposedAt),
    } : null,
    draftApproval: dto.draftApproval ? {
      version: dto.draftApproval.version ?? draft?.version ?? 0,
      approved: dto.draftApproval.approved ?? 0,
      total: dto.draftApproval.total ?? 0,
      parties: (Array.isArray(dto.draftApproval.parties) ? dto.draftApproval.parties : []).map((p) => ({
        key: p?.key || '',
        label: p?.label || 'Party',
        method: p?.method || '',
        mobile: p?.mobile || null,
        opened: !!p?.opened,
        approved: !!p?.approved,
        approvedAt: epoch(p?.approvedAt) || null,
      })),
    } : null,
    draftCheck: dto.draftCheck ? {
      version: dto.draftCheck.version ?? draft?.version ?? 0,
      status: dto.draftCheck.status || '',
      reasons: Array.isArray(dto.draftCheck.reasons) ? dto.draftCheck.reasons : [],
      note: dto.draftCheck.note || '',
      sharedBy: dto.draftCheck.sharedBy || '',
      checkedBy: dto.draftCheck.checkedBy || '',
      checkedAt: epoch(dto.draftCheck.checkedAt) || null,
    } : null,
    updatedAt,
  };
}

/** A wire page/array → view models, newest activity first. */
export function toViewModelList(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(toViewModel)
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One slim `ServiceRequestQueueRow` → the row shape the desk lists draw. No thread, parties, documents or timeline
 * are fetched for a list; the single `draft.approved` instant the age chip needs arrives as `approvedAt`. */
export function toQueueRow(row) {
  if (!row) return null;
  const created = epoch(row.createdAt);
  const type = toViewType(row.type);
  const approvedAt = epoch(row.approvedAt);
  return {
    id: row.id,
    type,
    service: serviceName(type),
    status: STATUS[row.status] || row.status,
    details: row.details && typeof row.details === 'object' ? row.details : {},
    assignedTo: row.assignee || null,
    assignedToMe: !!row.assignedToMe,
    createdAt: created,
    amount: row.amount ?? null,
    sla: row.sla ? { waitingOn: row.sla.waitingOn, dueAt: epoch(row.sla.dueAt) || null, overdue: !!row.sla.overdue } : null,
    draftCheck: row.draftCheckStatus ? { status: row.draftCheckStatus } : null,
    policeIntimation: { confirmed: !!row.policeConfirmed },
    timeline: approvedAt ? [{ stage: 'draft.approved', by: '', at: approvedAt }] : [],
    updatedAt: Math.max(created, approvedAt),
  };
}

export function toQueueRowPage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toQueueRow).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? res?.number ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}

/** Returned unmasked, because a masked PAN cannot be typed into a Leave & License. What makes that safe is the route,
 * not this shape — assignee-only, audited on both outcomes, purged when the matter closes. */
export function toIdentity(row) {
  if (!row) return null;
  return {
    partyRole: row.partyRole || 'tenant',
    partyIndex: Number.isFinite(row.partyIndex) ? row.partyIndex : 0,
    partyName: row.partyName || '',
    pan: row.pan || '',
    aadhaar: row.aadhaar || '',
    purged: !!row.purgedAt,
    purgedAt: epoch(row.purgedAt),
  };
}

/** The wire array → identity rows, owner first, in the order the server sent them. */
export function toIdentityList(rows) {
  return (Array.isArray(rows) ? rows : []).map(toIdentity).filter(Boolean);
}

/** Near enough to a pass-through that the mapping is only defence: the contract already speaks the renderer's
 * vocabulary, because the checklist is *computed* for reading rather than stored. */
export function toChecklist(dto) {
  if (!dto) return null;
  const items = (Array.isArray(dto.items) ? dto.items : [])
    .filter((i) => i && i.id)
    .map((i) => ({
      id: i.id, name: i.name || i.id, done: !!i.done, documentId: i.documentId || null,
      review: i.review || null, reason: i.reason || null, canUpload: i.canUpload !== false,
    }));
  return { ready: dto.ready ?? 0, total: dto.total ?? items.length, items };
}

/** `ticketId` preserves the ops enquiry a service request came from. */
export function toCreate(data) {
  const type = toWireType(data?.type || 'rental');
  const details = data?.details && typeof data.details === 'object' ? data.details : {};
  const out = { type, details };
  if (data?.propertyId) out.propertyId = String(data.propertyId);
  const ticket = data?.ticketId ?? data?.ticketRef;
  if (ticket) out.ticketId = String(ticket);
  return out;
}
