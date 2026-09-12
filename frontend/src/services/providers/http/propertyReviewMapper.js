/**
 * `PropertyReview` (wire) ↔ the view model the verification desk and the owner's listing card use.
 *
 * The mock this replaces lives in `lib/data/properties-admin.js` under `db.propertyReviews[id]`. It
 * and the server disagree about almost every field name, and about two things that are not renames
 * at all. Both are set out below, because the second kind is where a mapper quietly invents facts.
 *
 * ## 1. Renames — mechanical, and the wire wins
 *
 * | Mock | Wire | |
 * |---|---|---|
 * | `propId` | `propertyId` | |
 * | `docs[]` | `checklist[]` | and see §3 |
 * | `messages[].text` | `messages[].body` | |
 * | `messages[].from === 'admin'` | `messages[].from === 'ops'` | |
 * | `messages[].at` (epoch ms) | `messages[].at` (ISO-8601) | `fmtAgo` accepts both; the mock
 *   normalises up, following `contactProvider`/`reviewProvider` |
 * | `decision.{type,reason,at}` | `status` + `notes` + `decidedAt` + `reviewer` | |
 *
 * The seam speaks the **wire** vocabulary rather than the mock's, deliberately. A seam that spoke
 * `admin`/`text`/`docs` would keep the mock's words alive after the mock itself is deleted, and the
 * next reader would have no way to tell which of the two vocabularies the server actually uses.
 *
 * `title`, `locality`, `price` and `deal` are on the mock's case file and not on the wire. That is
 * correct and nothing is lost: they are a frozen snapshot of the listing taken when the case was
 * opened, and every screen that renders the case file is already holding the live listing. A
 * snapshot would be a *stale* title — the same argument `reportMapper` makes for dropping
 * `targetTitle`.
 *
 * ## 2. The status vocabulary is smaller, and one of the missing values was load-bearing
 *
 * | Mock | Wire | |
 * |---|---|---|
 * | `pending` | `pending` | the state a fresh case opens in |
 * | `in_review` | — | the mock set this on open; the server just stays `pending` |
 * | `clarification` | — | **the mock set this whenever ops posted a message** |
 * | `approved` | `approved` | |
 * | `rejected` | `rejected` | |
 *
 * `clarification` was the mock's way of saying "the ball is in the owner's court", and it was
 * derived — `addReviewMessage` flipped the case to it on any ops message. It is not translated to
 * anything here, because the fact behind it survives in a better form: the thread carries `from`
 * and `read` per message, so "waiting on the owner" is *the last message is from ops and unread*,
 * which is both the same fact and a fact the server can be asked about. Mapping it to a status
 * would re-derive in the browser something the thread already states.
 *
 * ## 3. The checklist is read-only here, and that is a real capability loss
 *
 * The mock's `docs[]` entry is `{ id, name, status, note }` with a four-value status and a free-text
 * note, written by `setDocStatus` / `setDocVerified` from the doc-viewer modal. The wire entry is
 * `{ item, pass }` — a label and a boolean — and **there is no endpoint that sets it**.
 *
 * So per-document verify/reject/annotate has no live counterpart. It is not mapped to anything
 * plausible-looking: a `pass` boolean synthesised from a four-value status would render controls
 * that appear to work and persist nothing. The desk reads the checklist and decides the case as a
 * whole; the per-document verdict is an open decision recorded against D217, not an oversight.
 */

/** `null`/`undefined`-safe array read — every list on this wire shape is optional. */
const list = (xs) => (Array.isArray(xs) ? xs : []);

/**
 * One thread message.
 *
 * `from` is clamped to the two values the contract defines rather than trusted verbatim. The server
 * assigns it by comparing the sender's id to the listing's owner — it is the one field on this
 * record the client could not compute for itself — so on a well-formed response the clamp never
 * fires. It exists to keep the enum closed: a screen switching on this value should not have to
 * consider a third case that the wire cannot produce.
 *
 * `internal` is staff-only and defaults to false, which is the safe direction twice over: an owner's
 * copy never contains an internal message at all (the server filters them), and a response from
 * before this field existed reads as "ordinary message" rather than silently marking owner
 * correspondence as staff-only.
 */
const toMessage = (m) => ({
  id: String(m?.id ?? ''),
  from: m?.from === 'owner' ? 'owner' : 'ops',
  body: m?.body ?? '',
  at: m?.at ?? null,
  read: Boolean(m?.read),
  internal: Boolean(m?.internal),
});

/** One checklist line. `pass` is a boolean on the wire; anything falsy reads as not yet passed. */
const toChecklistItem = (c) => ({ item: c?.item ?? '', pass: Boolean(c?.pass) });

/**
 * Wire `PropertyReview` → the case-file view model.
 *
 * `decidedAt` doubles as "has this been decided", which is why it is kept as a nullable timestamp
 * rather than folded into a boolean: the desk renders *when*, not *whether*.
 */
export function toCaseFile(res) {
  if (!res) return null;
  return {
    propertyId: res.propertyId ?? '',
    status: res.status ?? 'pending',
    // A user **id**, despite the contract's javadoc calling it a "staff handle" — `decide()` writes
    // `actor.userId().toString()`. A "Reviewed by" column has to resolve it against the team
    // directory; rendered raw it is a UUID.
    reviewer: res.reviewer ?? null,
    checklist: list(res.checklist).map(toChecklistItem),
    messages: list(res.messages).map(toMessage),
    notes: res.notes ?? null,
    decidedAt: res.decidedAt ?? null,
  };
}

/**
 * Wire `PropertyReviewSummary` → one row of a verification queue, ops' or the owner's.
 *
 * The queue row carries no listing detail — not even a title — because both queues page over case
 * files, not over listings. The caller joins it to the listing it is already showing.
 * `updatedAt` is the sort key the server orders by, so it is kept: a queue that cannot show why it
 * is in the order it is in reads as arbitrary.
 *
 * `unread` is counted from whichever end served the row — the owner's unread messages on
 * `/admin/property-reviews`, ops' on `/me/property-reviews`. That is not a wrinkle to smooth over
 * here: both mean "messages waiting on me", which is the only thing either caller renders it as.
 */
export function toQueueRow(row) {
  return {
    propertyId: row?.propertyId ?? '',
    status: row?.status ?? 'pending',
    reviewer: row?.reviewer ?? null,
    unread: Number(row?.unread) || 0,
    decidedAt: row?.decidedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}
