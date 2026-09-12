/**
 * Lead Note Service — the owner's private annotations on their inbox.
 *
 * ## What a lead note is
 *
 * The Requests inbox is a lightweight lead desk. Against any row — a number request, a photo
 * request, a document request, a flatmate enquiry — the owner can jot a private note and set a
 * follow-up date. Nobody else ever sees either field: not the buyer the note is about, not staff,
 * not admin. That privacy is the whole feature, and it is why the store is caller-scoped rather
 * than property-scoped.
 *
 * ## Keyed by lead, not by row id
 *
 * A note hangs off a `leadKey` the client mints — `'number:<contactRequestId>'`,
 * `'photo:<photoRequestId>'`, `'documents:<buyerMobile>|<propertyId>'`, `'flatmate:<requestId>'` —
 * because a "lead" is not one row. The same buyer asking for the number, then photos, then papers
 * is one conversation the owner is tracking, and the document lead in particular has no single row
 * to point at. The server never parses a key; it stores the string and enforces uniqueness per
 * caller. That keeps the vocabulary of what counts as a lead entirely on this side, which is right,
 * because it is a UI concern.
 *
 * ## Shape
 *
 * Both providers return the server's row, so no call site can tell which one it is talking to:
 *
 *   { leadKey, note, followUpAt, updatedAt }
 *
 *   note        null when the owner set only a follow-up date
 *   followUpAt  null when they wrote only a note; never both null (the row would not exist)
 *   updatedAt   what the localStorage version also called `updatedAt`; the panel shows it
 *
 * ## Whole annotation in, not a patch
 *
 * `save` takes the complete annotation, but the two controls in the sheet edit one field each. The
 * merge therefore happens at the call site, which holds the current value — see `EnquiriesPanel`.
 * That is not a convenience: JSON cannot distinguish "field omitted" from "field cleared to null",
 * so a partial write has no way to express *clearing* the follow-up date, and every encoding that
 * fixes it costs more than merging one object.
 *
 * ## Clearing is a write
 *
 * An annotation with neither field is not stored as a blank row — the row is deleted, and `save`
 * resolves to `null`. There is deliberately no `remove`: the owner clears a note by emptying it,
 * which is the same gesture as editing it, and a second verb would be a second way to say one
 * thing.
 *
 * This replaced `lib/leadNotes.js`, which kept annotations in localStorage under
 * `draazyLeadNotes:<ownerDigits>`. That store was per-browser, so an owner who answered enquiries
 * on their phone and their laptop kept two disjoint sets of notes and neither was wrong — which is
 * the worst shape a CRM field can have.
 */
import { createProvider } from './config.js';

const provider = createProvider('leadNote');

/**
 * Every annotation the caller has written, as an array.
 *
 * Unpaged, and unpaged on purpose: the inbox needs the whole set at once because it indexes them by
 * `leadKey` to decorate rows, so a page boundary would silently blank the notes on some rows and
 * not others. The ceiling that makes this safe is enforced server-side on write.
 *
 * @returns {Promise<Array<{leadKey: string, note: ?string, followUpAt: ?string, updatedAt: string}>>}
 */
export const myLeadNotes = async () => (await provider()).myLeadNotes();

/**
 * Write one annotation, or clear it.
 *
 * @param {string} leadKey the client-minted lead identity; see the module note
 * @param {{note?: ?string, followUpAt?: ?string}} annotation the *whole* annotation, not a patch
 * @returns {Promise<?object>} the stored row, or `null` when the annotation was empty and the row
 *   was therefore deleted. Callers must handle `null` — it is the normal result of clearing a note,
 *   not a failure.
 */
export const saveLeadNote = async (leadKey, annotation) => (await provider()).saveLeadNote(leadKey, annotation);
