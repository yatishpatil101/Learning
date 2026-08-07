/**
 * `Report` (wire) ↔ the view models the report modal and the ops queue use.
 *
 * Three vocabularies to reconcile, and each one has a wrong answer that ships silently because the
 * mock store accepts whatever it is handed.
 *
 * ## 1. `kind` → `targetType`, and the flatmates bug
 *
 * The client says "kind", the wire says "targetType", and they are not just renamed:
 *
 * | Client `kind` | Wire `targetType` | Reason set |
 * |---|---|---|
 * | `listing` | `property` | `LISTING_REPORT_REASONS` |
 * | `user` | `user` | `OWNER_REPORT_REASONS` |
 * | `share` | **`post`** | `SHARE_REPORT_REASONS` |
 *
 * **`Flatmates.jsx` passed `kind='user'` with `SHARE_REPORT_REASONS`.** The server validates the
 * reason *against* the target type — `FOR_USER` is
 * `impersonation|fraud|brokerage|abuse|spam|fakelistings|other`, and `filled` is not something you
 * can say about a person — so every flatmate report would have been a 400. On mocks it stored fine
 * and landed in the ops queue under the wrong tab. Fixed at the call site; the mapping table here
 * is what makes the mistake impossible to repeat silently, because an unknown kind now warns.
 *
 * ## 2. Status
 *
 * | Queue | Server | |
 * |---|---|---|
 * | `open` | `open` | ✅ |
 * | — | `reviewing` | ops picked it up; the queue has no such state |
 * | `resolved` | — | **does not exist server-side** |
 * | `actioned` | `actioned` | ✅ |
 * | `dismissed` | `dismissed` | ✅ |
 *
 * `resolved` was the queue's word for "reviewed, no action needed", which is what `dismissed`
 * means. It is translated on the way *out* (a triage of `resolved` sends `dismissed`) rather than
 * on the way in, so the queue never displays a status the server did not actually record.
 *
 * **Terminal is terminal.** `actioned` and `dismissed` cannot move. The queue's "Reopen" button
 * would 409, so `canTriage` exists to let the UI stop offering it rather than fail on click.
 *
 * ## 3. The denormalised display fields are gone
 *
 * The mock froze a snapshot of the target at report time — `targetTitle`, `targetOwner`,
 * `ownerMobile`, `reportedBy`, `url`. The contract declares none of them, deliberately: three are
 * joins the admin UI can make for itself, and **`reporterId` is withheld on purpose** — "the queue
 * tells a moderator what was complained about and why, not who complained: naming the reporter to
 * every member of ops is how a complaint becomes a reprisal".
 *
 * So they degrade rather than being invented:
 *
 * - `targetTitle` → the bare `targetId`. A moderator can click through; a fabricated title would be
 *   a *stale* title, which is worse than an id — the listing may have been edited since.
 * - `targetOwner`, `reportedBy` → empty. Not unknown-and-fetchable: deliberately not sent.
 * - `reasonLabel` → resolved locally from `REASON_LABELS`, because it is presentation text that
 *   belongs with the vocabulary the client already ships.
 */

/** Client `kind` → wire `targetType`. */
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

/**
 * Map a client kind onto a wire target type.
 *
 * An unknown kind warns once and falls through to `property` rather than throwing: a report is a
 * safety signal and losing one to a client-side typo is worse than filing it under the wrong tab.
 * The warning is what stops that being permanent.
 */
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

/**
 * Every reason label the three modal vocabularies ship, flattened.
 *
 * One table rather than three, because a label is looked up by key alone once the report is in the
 * queue — the queue does not know which modal produced it. Keys are unique across the three sets
 * except where they genuinely mean the same thing (`spam`, `broker`, `fake`, `other`).
 */
export const REASON_LABELS = {
  // listing
  sold: 'Already sold or rented out',
  fake: 'Fake photos or misleading info',
  unavailable: 'Owner not responding / unreachable',
  pricing: 'Overpriced / incorrect price',
  spam: 'Spam or duplicate listing',
  broker: 'Posted by a broker / not the owner',
  // user
  impersonation: 'Fake or impersonated profile',
  fraud: 'Suspected fraud or scam',
  brokerage: 'Asked for brokerage / advance payment',
  abuse: 'Abusive or offensive behaviour',
  fakelistings: 'Posting fake listings',
  // post (flatmates)
  filled: 'Already filled / no longer available',
  inappropriate: 'Inappropriate or offensive content',
  other: 'Something else',
};

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
    reasonLabel: REASON_LABELS[r.reason] || r.reason || '',
    details: r.details || '',
    status: r.status || 'open',
    // Mock-only free text: the server keeps the moderator's words in the audit log, not on the row.
    actionTaken: '',
    at: epoch(r.createdAt),
    // No `handledAt` on the wire either — the audit entry carries when, and who.
    handledAt: 0,
  };
}

/** A `PageResponse<Report>` → the `{ items, total, page, size }` both providers return. */
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
 * The modal's report → `ReportCreate`.
 *
 * Note what is absent: the reporter. The contract does not carry one — identity comes from the
 * principal, because "a body field naming the reporter would let anyone file a complaint under
 * somebody else's name, which turns an abuse queue into an abuse vector". Also absent are the
 * denormalised target fields and `url`, none of which the schema declares.
 */
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

/**
 * A queue decision → `ReportTriage`.
 *
 * `resolved` is the queue's word for "reviewed, no action needed", which is what the server calls
 * `dismissed`. Translated here rather than displayed, so the queue never shows a state the server
 * did not record.
 */
export function toReportTriage(decision) {
  const status = decision?.status === 'resolved' ? 'dismissed' : decision?.status;
  const out = { status };
  const note = String(decision?.note || '').trim();
  if (note) out.note = note;
  return out;
}
