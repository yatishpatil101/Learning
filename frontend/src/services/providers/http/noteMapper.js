/**
 * Wire → view-model translation for the note domain, and the one place `listing` becomes `property`.
 *
 * ## The vocabulary bridge
 *
 * Every note call site in this app says `listing`. The contract says `property` — as it does in
 * `/properties`, in `ReportTargetTypes`, in `PropertyResponse`. Both words are defensible and
 * neither is going to move, so the translation happens here, once, rather than at forty call sites
 * or by teaching the API a second client's noun.
 *
 * `toWireType` is deliberately a *whitelist* and not a `listing → property` string swap with a
 * pass-through default. A typo would otherwise sail through to the server, which refuses unknown
 * kinds with a 400 — a clear failure, but one raised a network round trip away from the mistake,
 * and only in live mode. Catching it here means the mock provider fails the same way.
 *
 * ## Shape
 *
 * The wire note is `{id, entityType, entityId, authorId, authorName, action, text, createdAt,
 * updatedAt}`; the view model is `{id, author, action, text, at, editedAt}` — the shape the
 * `InternalNote` widget and the Communication Log already render, which is also the shape the
 * localStorage store this replaces produced. Keeping it means the widget's markup did not have to
 * change along with its data source.
 *
 * `author` falls back to `authorId` because a byline with an ugly id in it is a fact; a blank
 * byline reads as "the system did this".
 *
 * `editedAt` is null when the note has never been corrected. The server sets `updatedAt` on insert
 * as well as on update, so "has this been edited?" is `updatedAt > createdAt` rather than
 * `updatedAt != null` — presence would mark every note as edited the moment it was written.
 */

/** The four kinds the server accepts, keyed by the word this app uses. */
const WIRE_TYPES = {
  listing: 'property',
  property: 'property',
  user: 'user',
  review: 'review',
  report: 'report',
};

/**
 * This app's word for an entity kind → the contract's word.
 *
 * @param {string} entityType
 * @returns {string} the wire word
 * @throws {Error} when the kind is not one of the four. Not an `ApiError`: nothing was sent.
 */
export function toWireType(entityType) {
  const wire = WIRE_TYPES[String(entityType || '').toLowerCase()];
  if (!wire) {
    throw new Error(
      `[note] unknown entity type "${entityType}". Expected one of: ${Object.keys(WIRE_TYPES).join(', ')}.`,
    );
  }
  return wire;
}

/**
 * One wire note → the view model the note surfaces render.
 *
 * @param {object} row an `InternalNote` from the contract
 * @returns {{id: string, entityType: string, entityId: string, author: string, action: string,
 *   text: string, at: string, editedAt: string|null}}
 */
export function toNote(row) {
  const at = row?.createdAt || null;
  const updated = row?.updatedAt || null;
  return {
    id: String(row?.id || ''),
    entityType: row?.entityType || '',
    entityId: row?.entityId || '',
    author: row?.authorName || row?.authorId || '',
    action: row?.action || '',
    text: row?.text || '',
    at,
    editedAt: updated && at && updated > at ? updated : null,
  };
}

/**
 * A bare array of wire notes → view models.
 *
 * The notes routes answer with an array rather than a page envelope, so there is no `content` to
 * unwrap and no truncation to warn about. Anything that is not an array becomes an empty list —
 * the widget's "no notes" state is a truthful thing to show when the shape is unrecognisable.
 *
 * @param {unknown} rows
 * @returns {object[]}
 */
export function toNotes(rows) {
  return (Array.isArray(rows) ? rows : []).map(toNote);
}
