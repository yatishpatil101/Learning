/**
 * Property verification — the owner↔ops case file behind a listing's approval.
 *
 *   GET   /properties/{id}/verification            the case file: checklist, thread, decision
 *   POST  /properties/{id}/verification            open it (201, idempotent — an existing case comes
 *                                                  back as-is)
 *   POST  /properties/{id}/verification/messages   post to the thread (201)
 *   POST  /properties/{id}/verification/read       mark the *other* side's messages read (204)
 *   PATCH /properties/{id}/verification/checklist  tick one checklist line (staff/admin)
 *   POST  /properties/{id}/verification/decision   approve or reject (staff/admin)
 *   GET   /admin/property-reviews                  the queue, paged (staff/admin)
 *
 * Replaces the `db.propertyReviews` half of `lib/data/properties-admin.js`. Field-by-field shape
 * differences — and the two capabilities that do not survive — are in `propertyReviewMapper.js`.
 *
 * ## `{id}` is the UUID, never the slug
 *
 * Every route here binds the path variable through `Ids.parseUuid`, so a slug is not a lookup miss,
 * it is a parse failure that surfaces as a plain 404. `propertyMapper` sets a listing's `id` to
 * `slug || id` and stashes the real key on `uuid`, which means the obvious `listing.id` is the
 * *wrong* argument for exactly the listings that have a slug — i.e. the live ones. Callers pass
 * `listing.uuid || listing.id`. This is the same trap that produced a run of 404s against
 * `/finalization/p5015/status`; it is called out here because the failure looks like "no such case
 * file" rather than like a bad id.
 *
 * ## Access is participant-or-staff, and a stranger gets 404
 *
 * The owner and the ops desk share one thread and one set of endpoints; the server decides which
 * side the caller is on from the session, which is why nothing here takes a `who`/`from` argument
 * the way the mock's `addReviewMessage(id, 'admin', text)` and `markReviewRead(id, 'admin')` did.
 * A caller who is neither participant nor staff is answered **404, not 403** — a 403 would confirm
 * that the listing exists and is under review, which is not a fact this API tells strangers.
 *
 * ## Two vocabularies for one decision
 *
 * The request says `approve` / `reject`; the resulting case status reads `approved` / `rejected`.
 * The verb is the instruction, the adjective is the record. The mock used the adjective for both,
 * so `decideReview(id, 'approved')` sent straight through would be a 400 — hence the translation in
 * `decidePropertyReview` rather than at the call sites, where it would have to be repeated.
 */
import { ApiError, get, patch, post, unwrapPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { toCaseFile, toQueueRow } from './propertyReviewMapper.js';

const caseFilePath = (propertyId) => `/properties/${encodeURIComponent(propertyId)}/verification`;

/**
 * Read the case file, or `null` if this listing has never been submitted for verification.
 *
 * 404 is a normal answer here rather than an error: most listings have no case file, and the owner
 * dashboard asks about listings it cannot know the answer for in advance. It is collapsed to `null`
 * for the same reason `propertyProvider.getListing` collapses its 404 — "no case" and "not visible
 * to you" are the same fact from the caller's side, and both render the same empty state.
 *
 * The 404 is still a real 404: catching it does not unmake the request, so it remains in the
 * network log. Prefer `startPropertyReview` on any surface that would create the case anyway.
 */
export async function getPropertyReview(propertyId) {
  try {
    return toCaseFile(await get(caseFilePath(propertyId)));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Open the case file, or return the existing one — the live counterpart to `ensureReview`.
 *
 * Idempotent by contract: `property_reviews.property_id` is `UNIQUE` and the server does
 * `findByPropertyId(...).orElseGet(create)`, so a second submit answers with the existing row
 * rather than creating a parallel history. Note that it comes back **untouched** — re-submitting a
 * rejected listing does not reopen the case, it returns it still rejected. Reopening is a decision
 * nobody has taken yet; do not read idempotent as forgiving.
 *
 * That is what lets the desk call this on modal open instead of the mock's `ensureReview` +
 * `getReview` pair, and it is strictly better than a GET-then-POST: the two-call version races
 * itself when two operators open the same listing.
 *
 * The server seeds the checklist from the listing's deal type — three items for a rental, six for a
 * sale — so the checklist is a server fact, not something the client submits.
 */
export async function startPropertyReview(propertyId) {
  return toCaseFile(await post(caseFilePath(propertyId)));
}

/**
 * Post a message to the thread and return the updated case file.
 *
 * The server attributes the message from the session, so there is no sender argument. `attachments`
 * is accepted by the contract and **silently ignored** — there is no upload surface and no column
 * behind it — so it is not exposed here rather than being passed through to nowhere.
 *
 * Returning the whole case file (not just the new message) is what the server does, and it is the
 * useful answer: a decision taken between render and send is visible in the reply.
 */
export async function addPropertyReviewMessage(propertyId, body) {
  return toCaseFile(await post(`${caseFilePath(propertyId)}/messages`, { body }));
}

/**
 * Mark the other side's messages read. 204, so there is nothing to map.
 *
 * "The other side" is resolved server-side from the session — the mock's `who` argument is gone,
 * and with it the possibility of a screen clearing the wrong side's unread flag.
 */
export async function markPropertyReviewRead(propertyId) {
  await post(`${caseFilePath(propertyId)}/read`);
}

/**
 * Tick one checklist line, or untick it. Returns the updated case file.
 *
 * The line is addressed by its text. `property_review_checklist.item` is `updatable = false` and
 * the rows are seeded from a fixed per-deal list, so the text *is* the stable key — there is no id
 * on the wire to address it by. An unrecognised item is a 404, which is the useful answer: sending
 * a rent listing a buy-list item means the caller is holding the wrong checklist, not that the tick
 * failed.
 *
 * `pass` is coerced to a real boolean rather than passed through. The server's field is boxed so
 * that an omitted key is distinguishable from `false` at binding, and it collapses null to false —
 * but a screen passing an event object or `undefined` for a checkbox is a real mistake, and JSON
 * would carry it as far as the wire before anything noticed.
 *
 * PATCH, not PUT: one line per request. A whole-list write would make every tick a last-write-wins
 * race against a second reviewer working the same case, and the console genuinely does tick items
 * one at a time.
 */
export async function setPropertyReviewChecklistItem(propertyId, item, pass) {
  const body = { item, pass: Boolean(pass) };
  return toCaseFile(await patch(`${caseFilePath(propertyId)}/checklist`, body));
}

/**
 * Approve or reject, as staff. Returns the updated case file.
 *
 * One call, three effects: the case is decided, `properties.status` moves with it, and the thread
 * gets the sentence that tells the owner what happened. The listing status is **not** a separate
 * call — pairing this with `setListingStatus` the way the mock desk did now writes the same field
 * twice, and the second write is the one that can silently disagree.
 *
 * An unrecognised `decision` is refused here rather than defaulting. The obvious
 * `startsWith('approve') ? 'approve' : 'reject'` makes every typo, every `undefined`, and every
 * capitalised `Approve` into a **rejection** — the destructive, owner-visible, audit-logged side of
 * a two-way branch. The server already refuses anything that is not exactly `approve`/`reject` with
 * a 400; normalising here must not quietly remove that guard.
 *
 * It is thrown as the 400 `ApiError` the server would have sent, not a bare `Error`, so a caller
 * branching on `err.status` handles the local guard and the remote one identically — and gets the
 * mock provider's behaviour for free, which raises the same thing for the same input.
 *
 * @param decision `approve` or `reject` — or the mock's `approved`/`rejected`, normalised here
 * @param note     free text; on a rejection it becomes the reason the owner is shown, so a blank
 *                 one falls back to the server's generic sentence rather than an empty reason
 */
export async function decidePropertyReview(propertyId, decision, note) {
  const input = String(decision ?? '').toLowerCase();
  const approve = input.startsWith('approve');
  if (!approve && !input.startsWith('reject')) {
    throw new ApiError({
      code: 'bad_request',
      status: 400,
      message: 'decision must be approve or reject',
    });
  }
  const verb = approve ? 'approve' : 'reject';
  return toCaseFile(await post(`${caseFilePath(propertyId)}/decision`, { decision: verb, note }));
}

/**
 * The verification queue — every case file, newest activity first, paged.
 *
 * Rows carry no listing detail (see `toQueueRow`); the desk joins them to the listings it is
 * already showing.
 *
 * **There is no server-side filter.** `findAllByOrderByUpdatedAtDesc` takes a `Pageable` and
 * nothing else — no status, no reviewer, no date window — so a desk that wants "pending only" is
 * filtering a page, not the queue, and its count is a count of what it happened to fetch. No filter
 * argument is accepted here rather than one being quietly dropped on the way to the wire, which is
 * how a filtered-looking screen ends up showing unfiltered rows. Narrowing the queue is a backend
 * change (a `status` query parameter and a derived query), not a mapper change.
 *
 * `size` is clamped: Spring caps the page server-side anyway, and a silently truncated page is the
 * shape of bug where a count and a list disagree.
 */
export async function listPropertyReviewQueue({ page = 0, size = 20 } = {}) {
  const capped = Math.min(size, MAX_PAGE_SIZE);
  const res = await get('/admin/property-reviews', { page, size: capped });
  const unwrapped = unwrapPage(res, { page, size: capped });
  return { ...unwrapped, items: unwrapped.items.map(toQueueRow) };
}

/**
 * The same queue narrowed to the caller's own listings (D218).
 *
 * The owner dashboard's reason for existing: it needs a verification status and an unread badge on
 * every listing card at once, and the per-listing `getPropertyReview` above is a request each —
 * most of which 404, because most listings have no case file. One page answers the whole dashboard.
 *
 * No role guard on the server, and none needed: the query is scoped to the caller's id, so an owner
 * with no listings gets an empty page rather than a 403.
 *
 * `unread` here counts *ops'* messages the owner has not read — the mirror of the ops queue's
 * count. Both are "waiting on me" from opposite ends; see `toQueueRow`.
 */
export async function listMyPropertyReviews({ page = 0, size = 20 } = {}) {
  const capped = Math.min(size, MAX_PAGE_SIZE);
  const res = await get('/me/property-reviews', { page, size: capped });
  const unwrapped = unwrapPage(res, { page, size: capped });
  return { ...unwrapped, items: unwrapped.items.map(toQueueRow) };
}
