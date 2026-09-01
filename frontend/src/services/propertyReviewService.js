/**
 * Property verification — the owner↔ops case file behind a listing's approval.
 *
 * Seven operations over one record: open the case, read it, talk in its thread, mark the other
 * side's messages read, tick a checklist line, and decide it; plus the staff queue of every open
 * case.
 *
 *   GET   /properties/{id}/verification            the case file
 *   POST  /properties/{id}/verification            open it (idempotent)
 *   POST  /properties/{id}/verification/messages   post to the thread
 *   POST  /properties/{id}/verification/read       mark the other side's messages read
 *   PATCH /properties/{id}/verification/checklist  tick one line (staff/admin)
 *   POST  /properties/{id}/verification/decision   approve or reject (staff/admin)
 *   GET   /admin/property-reviews                  the queue, paged (staff/admin)
 *   GET   /me/property-reviews                     the same queue, my listings only (any owner)
 *
 * Not to be confused with `verificationService.js`, which is the *identity* badge — one person's
 * Aadhaar check. This is the *listing* case file. They share a word and nothing else: different
 * table, different permission, different question. The domain is named `propertyReview` after the
 * table rather than after the desk, so the two cannot be confused at an import site.
 *
 * Nor with `reviewService.js`, which owns the consumer star-ratings on a listing. That module
 * already exports a `listPropertyReviews(propertyId, opts)` meaning "this listing's public
 * reviews", which is why the queue read below is `listPropertyReviewQueue` — two same-named
 * exports with incompatible signatures is a trap that only shows up at the import site, and only
 * sometimes.
 *
 * ## Why the case file is not just `properties.status`
 *
 * `properties.status` is the listing's public visibility. This row is the record behind it — who
 * reviewed it, against which checklist, what was said, and when it was decided. Approving a listing
 * must not erase the reason it was approved, which is why a decision writes both, in one call. The
 * desk this replaces made two: `decideReview` then `setListingStatus`, and nothing kept them
 * agreeing when the second one failed.
 *
 * ## Identity is a session fact, not an argument
 *
 * The mock took `from`/`who` on every write. The server derives both from the principal, so nothing
 * here does — a caller can no longer post the owner's reply as ops, or clear the wrong side's
 * unread flag, by passing the wrong string.
 *
 * ## Ids are UUIDs
 *
 * These routes parse `{id}` as a UUID, and `propertyMapper` sets a listing's `id` to `slug || id`
 * with the real key on `uuid`. Pass `listing.uuid || listing.id`, or the live listings — the ones
 * with slugs — are exactly the ones that 404.
 */
import { createProvider } from './config.js';
import { isInternal, readUser } from '../lib/auth.js';

const provider = createProvider('propertyReview');

/** The case file, or `null` if this listing has never been submitted. */
export async function getPropertyReview(propertyId) {
  return (await provider()).getPropertyReview(propertyId);
}

/** Open the case file, or return the existing one. Idempotent — safe to call on modal open. */
export async function startPropertyReview(propertyId) {
  return (await provider()).startPropertyReview(propertyId);
}

/** Post to the thread. Returns the updated case file, not just the new message. */
export async function addPropertyReviewMessage(propertyId, body) {
  return (await provider()).addPropertyReviewMessage(propertyId, body);
}

/** Mark the *other* side's messages read. Which side that is comes from the session. */
export async function markPropertyReviewRead(propertyId) {
  return (await provider()).markPropertyReviewRead(propertyId);
}

/**
 * Tick one checklist line, or untick it. Staff only. Returns the updated case file.
 *
 * The line is addressed by its **text**, not by an id: the checklist is seeded server-side from a
 * fixed per-deal list and the column is `updatable = false`, so the text is the key. The mock's
 * `d_index2`-style ids were local inventions and do not survive.
 *
 * One line per call, deliberately. The console ticks items one at a time as the reviewer works
 * through them, so a whole-list write would make every tick a last-write-wins race against a second
 * reviewer on the same case.
 *
 * An owner cannot tick their own listing's checklist even if they are staff (403) — the ticks are
 * what the colleague who *can* approve it reads before deciding.
 *
 * @param item the exact checklist text, e.g. `'Electricity bill'`; an unknown one is a 404
 * @param pass `true` to tick, `false` to untick
 */
export async function setPropertyReviewChecklistItem(propertyId, item, pass) {
  return (await provider()).setPropertyReviewChecklistItem(propertyId, item, pass);
}

/**
 * Approve or reject, as staff.
 *
 * One call moves the case, the listing's public status, and posts the sentence that tells the owner
 * what happened — so it must not be paired with a separate `setListingStatus`. An owner cannot
 * decide their own listing (403), and an unrecognised `decision` throws rather than defaulting to
 * a rejection.
 *
 * @param decision `approve` or `reject`
 * @param note     free text; on a rejection this is the reason the owner is shown
 */
export async function decidePropertyReview(propertyId, decision, note) {
  return (await provider()).decidePropertyReview(propertyId, decision, note);
}

/** The staff queue — every case file, newest touched first. Paged; there is no server-side filter. */
export async function listPropertyReviewQueue(params) {
  return (await provider()).listPropertyReviewQueue(params);
}

/**
 * The owner's own queue — my listings' case files, newest touched first.
 *
 * One page answers a whole dashboard. Reach for this rather than `getPropertyReview` per card: most
 * listings have no case file, so the per-card version is mostly 404s, and the row carries the
 * `unread` count a card would otherwise have to fetch the whole thread to compute.
 *
 * Rows carry no listing detail — join them to the listings the screen is already holding, by
 * `propertyId`.
 */
export async function listMyPropertyReviews(params) {
  return (await provider()).listMyPropertyReviews(params);
}

/**
 * Messages from the other side that the reader has not seen yet.
 *
 * Replaces `properties-admin.js#reviewUnread(id, who)`, and is a plain derivation over a case file
 * the caller already has rather than a seventh operation — the count is a property of the thread,
 * so asking a provider for it would be a second round trip for an answer that is already in hand.
 * It lives here, not in a mapper, because it reads the seam's view model and is true of either
 * provider.
 *
 * The mock's `who` argument does **not** survive. Which side the reader is on is a session fact
 * everywhere else in this seam — the server assigns `from` by comparing sender to owner, and no
 * write here takes a side — so accepting one on the only side-aware export would leave a screen
 * holding a local "am I ops?" variable, which is precisely the thing that gets reused one day for a
 * decision that is not about display.
 */
export function unreadFrom(caseFile) {
  const theirs = isInternal(readUser()) ? 'owner' : 'ops';
  const messages = Array.isArray(caseFile?.messages) ? caseFile.messages : [];
  return messages.filter((m) => m.from === theirs && !m.read).length;
}
