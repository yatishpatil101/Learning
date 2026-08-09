/**
 * `ServiceRequest` / `Message` / `Document` (wire) → the view models `ServiceTracker.jsx` renders.
 *
 * The assisted-service workflow is the most divergent slice in the seam so far: the frontend
 * invented its own richer vocabulary before the API existed, and the contract is deliberately
 * narrower. Every reconciliation below has a wrong answer that looks right.
 *
 * ## 1. Status — two different vocabularies
 *
 * The stepper keys on frontend step names; the server has its own set. They overlap in meaning but
 * not in spelling, and the server collapses two frontend states into one.
 *
 * | Server            | Frontend step    | note |
 * |-------------------|------------------|------|
 * | `new`             | `submitted`      | every request opens here |
 * | `assigned`        | `docs_review`    | ops picked it up |
 * | `in-progress`     | `docs_review`    | **also** where a rejected draft returns — the server has no `changes_requested`, so that distinction is lost on read |
 * | `draft-shared`    | `draft_shared`   | the draft is out for the customer's decision |
 * | `approved`        | `approved`       | customer approved; awaiting the final document |
 * | `completed`       | `completed`      | |
 * | `cancelled`       | `cancelled`      | |
 *
 * Unknown statuses pass through unchanged rather than defaulting, so a gap renders as the raw key
 * (visibly wrong) instead of silently masquerading as a state the request is not in.
 *
 * ## 2. `details` — a structured object, round-tripped
 *
 * `ServiceRequestCreate` accepts a `details` **object** and `ServiceRequestDto` echoes it back
 * (D119). The tracker's detail line (`details.property` / `details.from`) reads the same shape the
 * form sent, so `toCreate` passes the object through untouched and `toViewModel` reads `dto.details`.
 * A missing `details` becomes `{}` on read so the view's optional chaining stays safe; nested
 * objects survive, because the wire field is `jsonb`, not a flat string.
 *
 * ## 3. Draft / final document — signed URLs, not data URLs
 *
 * Both live in `documents[]`, keyed by `category`: newest `draft` is the current version (their
 * count is the version number — the contract has no version field), `final-document` is the
 * registered copy. Their `url` is a short-lived signed URL, not the base64 `dataUrl` the mock mints,
 * so it shares the vault dev-storage limitation (the dev backend points at `mock.storage.local`,
 * which does not resolve locally). The workflow state, thread and approve/reject decision are fully
 * live; only the rendered *file* degrades in dev, exactly as it does for the documents slice.
 *
 * ## 4. Author role and time
 *
 * `authorRole` is `buyer|owner|staff|admin`; the bubbles key on `from: 'user'|'staff'`. Staff-side
 * is `staff`/`admin`; everything else is the customer. Times must be **numbers** — the thread sorts
 * on `at` — so every ISO instant becomes epoch ms here.
 */

/** ISO instant → epoch ms. 0 for a missing date, so a sort never produces NaN. */
function epoch(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Staff-side roles. Everything else — buyer, owner, null — is the customer who raised the request. */
const STAFF_ROLES = new Set(['staff', 'admin']);

/** Server status → the frontend step vocabulary the stepper and status chip key on. */
const STATUS = {
  new: 'submitted',
  assigned: 'docs_review',
  'in-progress': 'docs_review',
  'draft-shared': 'draft_shared',
  approved: 'approved',
  completed: 'completed',
  cancelled: 'cancelled',
};

/** A human service name from the wire `type`. Falls back to a title-cased type for anything new. */
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
    // No per-recipient read state on the wire; treat the thread as read. Unread badges are a
    // mock-only affordance in http mode.
    read: true,
  };
}

/** Newest `documents[]` entry of a category → the `{ fileName, dataUrl }` shape `openDocUrl` reads. */
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
        fileName: draftDoc.row.fileName || 'draft',
        dataUrl: draftDoc.row.url || '',
        sharedAt: epoch(draftDoc.row.uploadedAt),
        version: draftDoc.count,
      }
    : null;
  const final = finalDoc.row
    ? {
        fileName: finalDoc.row.fileName || 'final-document',
        dataUrl: finalDoc.row.url || '',
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
  return {
    id: dto.id,
    type: dto.type,
    service: serviceName(dto.type),
    status,
    // Structured on the wire and round-tripped (D119); `{}` for a request that carried none, so the
    // tracker's optional chaining stays safe rather than reading `undefined`.
    details: dto.details && typeof dto.details === 'object' ? dto.details : {},
    // The customer document checklist has no read representation on `ServiceRequestDto`; the vault
    // holds them but the contract does not surface them per request. Empty, never undefined.
    docs: [],
    draft,
    finalDoc: final,
    // The server collapses "changes requested" back into `in-progress`, so only an approval is
    // recoverable on read. A rejection is indistinguishable from ordinary in-progress work.
    draftDecision: dto.status === 'approved' ? { type: 'accepted', at: created } : null,
    messages,
    timeline,
    assignedTo: dto.assignee || null,
    createdAt: created,
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

/**
 * The create form → `ServiceRequestCreate`.
 *
 * `details` is a structured object the server stores as-is and echoes back (D119), so it is passed
 * through untouched — nested fields and all. `propertyId` is only sent when it is a real backend id
 * — the server validates it exists (404) or is malformed (400). The frontend often carries a
 * free-text address in `details.property` instead, which stays in the details object; sending it as
 * `propertyId` would fail the request.
 */
export function toCreate(data) {
  const type = data?.type || 'rental';
  const details = data?.details && typeof data.details === 'object' ? data.details : {};
  const out = { type, details };
  if (data?.propertyId) out.propertyId = String(data.propertyId);
  return out;
}
