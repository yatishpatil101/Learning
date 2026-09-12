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
import {
  LISTING_REPORT_REASONS,
  SHARE_REPORT_REASONS,
  OWNER_REPORT_REASONS,
  SOCIETY_REPORT_REASONS,
} from '../../../lib/reportReasons.js';

/**
 * Client `kind` → wire `targetType`.
 *
 * The five `society_*` entries are the society hub's five UGC surfaces. The client has always
 * called them by the bare word — `societyMod.js` has shipped `REPORT_TYPES` as
 * `contribution|reply|review|question|answer|board` since the hub was browser-only — so the bare
 * word is what arrives here, and the prefixed form is what the wire wants.
 *
 * `review` is in that client list and is deliberately **not** prefixed: a society review is
 * reported as an ordinary `review` and taken down through `PATCH /reviews/{id}/status`. It was
 * already mapped above and stays there.
 */
const KIND_TO_TARGET = {
  listing: 'property',
  property: 'property',
  user: 'user',
  review: 'review',
  share: 'post',
  post: 'post',
  contribution: 'society_contribution',
  reply: 'society_reply',
  question: 'society_question',
  answer: 'society_answer',
  board: 'society_board',
  society_contribution: 'society_contribution',
  society_reply: 'society_reply',
  society_question: 'society_question',
  society_answer: 'society_answer',
  society_board: 'society_board',
};

/** Wire `targetType` → client `kind`, for rendering the queue's tabs. */
const TARGET_TO_KIND = {
  property: 'listing',
  user: 'user',
  review: 'review',
  post: 'share',
  society_contribution: 'contribution',
  society_reply: 'reply',
  society_question: 'question',
  society_answer: 'answer',
  society_board: 'board',
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
 * Reason code → the words the reporter actually read, indexed by what they were reporting.
 *
 * This used to be one flat table, hand-copied from the three modal vocabularies, with a note
 * claiming the colliding keys "genuinely mean the same thing". They do not, and the table was wrong
 * in two separate ways because of it.
 *
 * *Wrong by drift:* `abuse` was written here as "Abusive or offensive behaviour" while the modal
 * offered "Abusive or harassing behaviour", and `fakelistings` as "Posting fake listings" against
 * the modal's "Listings are fake or unavailable". A moderator filtering the queue and a reporter
 * filing the complaint were reading different words for one code. Two copies of a vocabulary drift;
 * that is what copies do.
 *
 * *Wrong by design:* four codes are shared across vocabularies **under different wording**, because
 * they describe different things. `spam` from an owner is a stream of irrelevant messages, on a
 * listing a duplicate listing, on a flatmate post a duplicate post. A flat table has to pick one,
 * so a spammy flatmate post was labelled "Spam or duplicate listing" in the ops queue — the wrong
 * noun for what the reporter clicked. Same for `fake`, `broker` and `unavailable`.
 *
 * The label is therefore a function of `(reason, targetType)`, exactly as validity is — see
 * `ReportReasons.java`, which rejects a reason that is not legal for the target type. `toViewModel`
 * has the target type in hand, so there is no reason to resolve on the code alone.
 *
 * Derived from `lib/reportReasons.js`. It cannot drift from the modal any more, because it *is* the
 * modal's data.
 */
const LABELS_BY_TARGET = {
  property: Object.fromEntries(LISTING_REPORT_REASONS),
  post: Object.fromEntries(SHARE_REPORT_REASONS),
  user: Object.fromEntries(OWNER_REPORT_REASONS),
  /* Spelled out rather than left to the flattened fallback below. `ReportReasons.FOR_REVIEW` is
     `fake`/`abuse`/`other`, and all three collide with vocabularies whose wording is about a
     listing or a person: a review reported as `fake` would otherwise read "Fake photos or
     misleading info", which is the wrong noun for a review and the exact class of mislabelling
     this table was restructured to remove. There is no modal to derive these from — reviews are
     reported from the review card, not a picker — so they are written out here. */
  review: {
    fake: 'Fake or dishonest review',
    abuse: 'Abusive or offensive review',
    other: 'Something else',
  },
  /* One vocabulary, five entries. The wire keeps the kinds apart so a moderator knows which table
     the id indexes; the words a reporter picked are the same either way, so pointing all five at
     the one list is the honest mapping rather than a shortcut. Spelling them out beats a prefix
     test here because this object is also read by key. */
  society_contribution: Object.fromEntries(SOCIETY_REPORT_REASONS),
  society_reply: Object.fromEntries(SOCIETY_REPORT_REASONS),
  society_question: Object.fromEntries(SOCIETY_REPORT_REASONS),
  society_answer: Object.fromEntries(SOCIETY_REPORT_REASONS),
  society_board: Object.fromEntries(SOCIETY_REPORT_REASONS),
};

/**
 * Every label, flattened — the fallback only, never the first choice.
 *
 * One caller needs it: an unrecognised target type — a code shipped by a newer server than this
 * bundle — lands here rather than rendering a raw code at a moderator. Every target type the
 * client knows about has its own entry above.
 *
 * Listing wording wins the collisions, because listings are the overwhelming majority of the queue
 * and it is the least surprising default. Society wording is spread first, so it loses every
 * collision but still contributes the one code it holds alone — `personal`, which no other
 * vocabulary has a word for and which would otherwise render as the bare code. Anything that can
 * name its target type should not be reading this.
 */
export const REASON_LABELS = {
  ...LABELS_BY_TARGET.society_contribution,
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
 *
 * `enforcement` is the verb the server actually executes — `hide_content` takes the listing down,
 * `suspend_account` archives the user. Omitting it is not a neutral default: the report closes as
 * `actioned` while the reported thing stays up, which is the worst of both outcomes, because the
 * queue then *reads* as handled. Absent means `none` on the server, so it is only ever sent when
 * the moderator picked an action.
 */
export function toReportTriage(decision) {
  const status = decision?.status === 'resolved' ? 'dismissed' : decision?.status;
  const out = { status };
  const note = String(decision?.note || '').trim();
  if (note) out.note = note;
  if (decision?.enforcement) out.enforcement = decision.enforcement;
  return out;
}
