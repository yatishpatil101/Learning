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
 * | `in-progress`     | `docs_review`    | ops are working the request |
 * | `draft-shared`    | `draft_shared`   | the draft is out for the customer's decision |
 * | `changes-requested` | `changes_requested` | the customer rejected the draft; the server has had this state since V75 (D121) |
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
  // Reachable by the customer, not just a transient: `GET /service-requests` scopes to the
  // requester and does *not* hide it (only the ops queue does), so anyone who closes the Cashfree
  // modal without paying finds their request sitting here until the webhook settles or cancels it.
  'awaiting-payment': 'awaiting_payment',
  new: 'submitted',
  assigned: 'docs_review',
  'in-progress': 'docs_review',
  'draft-shared': 'draft_shared',
  // The customer's rejection of a shared draft. Only `POST /{id}/draft-decision` reaches it —
  // `PATCH /{id}/status` cannot — so it is the one status ops never set. Without this entry the
  // raw hyphenated key reached a stepper that only knows underscored step names, and a rejection
  // rendered as an unknown state instead of the rose "Changes requested" step.
  'changes-requested': 'changes_requested',
  approved: 'approved',
  completed: 'completed',
  cancelled: 'cancelled',
};

/**
 * Service `type` — one alias, in both directions.
 *
 * The frontend's vocabulary is `rental`; the contract names the same desk `rent-agreement`
 * (`ServiceRequestCreate.type`, and the example on `ServiceRequest`). Every *other* frontend type —
 * `legal`, `interior`, `packers`, `valuation` — is spelled identically on both sides and needs no
 * entry here.
 *
 * <strong>Why this one alias is load-bearing.</strong> The server prices a request by matching the
 * type string exactly: only `rent-agreement` is charged (platform fee + stamp duty + registration +
 * GST from the `rent` fee row), and anything else is a free desk that goes straight into the ops
 * queue. `ServiceRequestCreate.type` is now a closed enum, so forgetting this alias is a loud 400
 * rather than a silently unpaid rent agreement — but the alias still has to exist, and it lives here
 * rather than at a call site that could forget it.
 */
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
  const type = toViewType(dto.type);
  return {
    id: dto.id,
    type,
    service: serviceName(type),
    status,
    // Structured on the wire and round-tripped (D119); `{}` for a request that carried none, so the
    // tracker's optional chaining stays safe rather than reading `undefined`.
    details: dto.details && typeof dto.details === 'object' ? dto.details : {},
    // The customer document checklist has no read representation on `ServiceRequestDto`; the vault
    // holds them but the contract does not surface them per request. Empty, never undefined.
    docs: [],
    draft,
    finalDoc: final,
    // `ServiceRequestDto` carries no decision object, so the decision is inferred from the status:
    // `approved` is an acceptance and `changes-requested` is a rejection, which are the only two
    // states `POST /{id}/draft-decision` can produce. The customer's rejection *note* is not
    // recoverable — it lands in the message thread, not on the request — so `note` is omitted
    // rather than invented, and the ops queue falls back to its unadorned "Customer requested
    // changes" line. `at` is the request's creation time, not the decision's, for the same reason.
    draftDecision: dto.status === 'approved' ? { type: 'accepted', at: created }
      : dto.status === 'changes-requested' ? { type: 'changes', at: created }
        : null,
    messages,
    timeline,
    assignedTo: dto.assignee || null,
    createdAt: created,
    amount: dto.amount ?? null,
    paymentSessionId: dto.paymentSessionId ?? null,
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
 * A `PageResponse<ServiceRequest>` → the `{ items, total, page, size }` shape the paged reads
 * across the seam already use (reports, the support queue).
 *
 * The rows keep the server's order rather than being re-sorted into `updatedAt` order the way
 * `toViewModelList` does: this is a *window*, and re-sorting twenty rows would quietly turn
 * "newest first" into "newest on this page first".
 */
export function toViewModelPage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toViewModel).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? res?.number ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}

/**
 * One wire `ServiceRequestIdentity` → the row the drafting desk reads from (D151/D173).
 *
 * Returned unmasked, because a masked PAN cannot be typed into a Leave & License. What makes that
 * safe is the route, not this shape — assignee-only, audited on both outcomes, purged when the
 * matter closes — so there is nothing to redact here and pretending otherwise would only make the
 * numbers useless to the one person allowed to see them.
 *
 * **`purged` is the field that stops a lie.** A null `pan` means two different things: with no
 * `purgedAt` the customer left that field empty, and with one the matter is closed and the number
 * has been discarded. Without the distinction a completed request looks exactly like a customer who
 * never filled the form, and the desk re-asks for something it was given.
 */
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
  const type = toWireType(data?.type || 'rental');
  const details = data?.details && typeof data.details === 'object' ? data.details : {};
  const out = { type, details };
  if (data?.propertyId) out.propertyId = String(data.propertyId);
  return out;
}
