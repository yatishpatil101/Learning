/**
 * HTTP lead-note provider — the live counterpart to `providers/mock/leadNoteProvider.js`.
 *
 * No mapper module alongside this one: the server's `LeadNoteResponse` was designed against this
 * seam and the field names already match, so a mapper here would be a file of identity functions.
 * The one shape difference worth naming is that `followUpAt` and `updatedAt` arrive as ISO strings
 * rather than epoch millis — the localStorage version stored numbers. Nothing is converted here,
 * because both of the panel's consumers (`FollowUpChip`, the sheet's date input) go through helpers
 * that already accept either, and a conversion in this file would be a second place for the two
 * representations to disagree.
 *
 * Nothing in this file names an owner. The store is caller-scoped, derived from the token, which is
 * what lets both calls take no owner argument — and is also the fix for the bug that motivated the
 * move: the localStorage keys were built from `myMobile()`, so the notes lived per-browser.
 */
import { get, put } from '../../http.js';

/**
 * Epoch millis → ISO-8601, because the two are not interchangeable on the wire even though every
 * *reader* in this app treats them as if they were.
 *
 * `LeadSheet` produces `new Date(v).getTime()` — a number — and the server's field is an `Instant`,
 * which Jackson reads a bare JSON number into as epoch **seconds**. So a millisecond value posted
 * raw lands about fifty thousand years out. Measured, not assumed: the endpoint answers
 * `400 bad_request` — "followUpAt is too far from today to be a date anyone meant to pick" — so the
 * service's own range guard catches it rather than storing the nonsense. That guard is why this is
 * a failed save the owner sees a toast for, rather than a corrupt row nobody notices; it is not a
 * reason to skip the conversion, because without it no follow-up date can ever be saved at all.
 *
 * Converted here rather than in the sheet because this is the only layer that owes the server a
 * representation; the sheet's number is fine everywhere else, including the mock store, which is
 * where it has always been kept.
 *
 * Strings pass through untouched — a caller echoing a row back from a previous read is already
 * sending ISO, and re-parsing it would be a second place for the formats to disagree.
 */
const toInstant = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(v).toISOString();
  return v;
};

/**
 * Every annotation the caller owns.
 *
 * A bare array, not a page envelope — the endpoint is unpaged by design (the inbox indexes the
 * whole set by `leadKey`), so there is nothing to unwrap.
 */
export async function myLeadNotes() {
  return (await get('/me/lead-notes')) || [];
}

/**
 * Upsert one annotation, or clear it.
 *
 * `PUT` rather than `PATCH`, and the body is the whole annotation: JSON cannot distinguish an
 * omitted field from one cleared to null, so a partial write could never clear a follow-up date.
 * The merge happens at the call site, which is the only place that holds the current value.
 *
 * The key is URL-encoded because it is a client-minted string containing `:` and `|`
 * (`'documents:<buyerMobile>|<propertyId>'`), neither of which may travel raw in a path segment.
 *
 * Returns `null` on `204`, which is the server saying the annotation was empty and the row has been
 * deleted. That is a normal outcome — an owner clearing a note — and not an error, so it is handed
 * back rather than thrown. `http.request` already maps 204 to null; this is only naming it.
 */
export async function saveLeadNote(leadKey, { note = null, followUpAt = null } = {}) {
  return put(`/me/lead-notes/${encodeURIComponent(leadKey)}`, { note, followUpAt: toInstant(followUpAt) });
}
