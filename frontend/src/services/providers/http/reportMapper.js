/** Kind maps to targetType (share → `post`, listing → `property`) and the server validates reason against it;
 * `resolved` is sent as `dismissed`; `reporterId` is withheld so a complaint can't become a reprisal. */
import {
  LISTING_REPORT_REASONS,
  SHARE_REPORT_REASONS,
  OWNER_REPORT_REASONS,
  REVIEW_REPORT_REASONS,
} from '../../../lib/reportReasons.js';

/** Client `kind` → wire `targetType`; a society review is reported as an ordinary `review`. */
const KIND_TO_TARGET = {
  listing: 'property',
  property: 'property',
  user: 'user',
  review: 'review',
  share: 'post',
  post: 'post',
};

/** Wire `targetType` → client `kind`, for rendering the queue's tabs. */
const TARGET_TO_KIND = {
  property: 'listing',
  user: 'user',
  review: 'review',
  post: 'share',
};

const warned = new Set();

/** Unknown kind warns and files under `property` rather than throwing: losing a safety report is worse. */
export function toTargetType(kind) {
  const mapped = KIND_TO_TARGET[kind];
  if (!mapped) {
    if (!warned.has(kind)) {
      warned.add(kind);
      console.warn(
        `[reports] Unknown report kind "${kind}" — filing it as \`property\`. The server validates `
          + 'the reason against the target type, so a wrong type is a 400, not a mislabel. Add it to '
          + 'KIND_TO_TARGET in reportMapper.js.',
      );
    }
    return 'property';
  }
  return mapped;
}

/** Labels are keyed on (reason, targetType): four codes share names across vocabularies with different wording.
 * Derived from lib/reportReasons.js so it can't drift from the modal. */
const LABELS_BY_TARGET = {
  property: Object.fromEntries(LISTING_REPORT_REASONS),
  post: Object.fromEntries(SHARE_REPORT_REASONS),
  user: Object.fromEntries(OWNER_REPORT_REASONS),
  review: Object.fromEntries(REVIEW_REPORT_REASONS),
};

/** Every label flattened, as a fallback for target types from a newer server; listing wording wins collisions. */
export const REASON_LABELS = {
  ...LABELS_BY_TARGET.post,
  ...LABELS_BY_TARGET.user,
  ...LABELS_BY_TARGET.property,
};

/** Reason code → display text for the thing it was filed against. Falls back before it gives up. */
export const reasonLabel = (reason, targetType) =>
  LABELS_BY_TARGET[targetType]?.[reason] || REASON_LABELS[reason] || reason || '';


/** ISO instant → epoch ms. 0 for a missing date, so a sort never produces NaN. */
function epoch(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Statuses a report can still move out of. Mirrors `ReportStatuses.LIVE`. */
const LIVE_STATUSES = new Set(['open', 'reviewing']);

/** True if the server would accept a triage on this report. Terminal is terminal. */
export const canTriage = (report) => LIVE_STATUSES.has(report?.status);

/** One wire `Report` → one queue row. */
export function toViewModel(r) {
  if (!r) return null;
  return {
    id: r.id,
    kind: TARGET_TO_KIND[r.targetType] || r.targetType,
    targetId: r.targetId || '',
    // Not on the wire. The id is the honest fallback — see the module note on why a resolved title
    // would be a stale one.
    targetTitle: '',
    targetOwner: '',
    reportedBy: '',
    reason: r.reason || '',
    reasonLabel: reasonLabel(r.reason, r.targetType),
    details: r.details || '',
    status: r.status || 'open',
    // Not on the wire: the server keeps the moderator's words in the audit log, not on the row.
    actionTaken: '',
    at: epoch(r.createdAt),
    // No `handledAt` on the wire either — the audit entry carries when, and who.
    handledAt: 0,
  };
}

/** A `PageResponse<Report>` → the `{ items, total, page, size }` the queue reads. */
export function toViewModelPage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toViewModel).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? res?.number ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}

/** The reporter is absent: identity comes from the principal, or anyone could file under another's name. */
export function toReportCreate(report) {
  const out = {
    targetType: toTargetType(report?.kind),
    targetId: String(report?.targetId || ''),
    reason: report?.reason || '',
  };
  const details = String(report?.details || '').trim();
  if (details) out.details = details;
  return out;
}

/** `enforcement` is only sent when chosen: without it the report closes `actioned` with the content still up. */
export function toReportTriage(decision) {
  const status = decision?.status === 'resolved' ? 'dismissed' : decision?.status;
  const out = { status };
  const note = String(decision?.note || '').trim();
  if (note) out.note = note;
  if (decision?.enforcement) out.enforcement = decision.enforcement;
  return out;
}
