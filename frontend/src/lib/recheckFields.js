/**
 * Pure helpers for the listing re-check lifecycle.
 *
 * Mirrors `Property.requestRecheck` / `Property.clearRecheck` server-side
 * (Q14). Kept neutral so both the mock store (`lib/mockApi/properties.js`) and
 * the live submission path (`list-property/submit.js`) can share the same logic
 * without either side importing from mock infrastructure.
 */

/**
 * Returns the three re-check fields to merge onto a listing record.
 *
 * Two rules are copied from the server deliberately, because a mock that is
 * *more permissive* than the server passes tests the real thing would fail:
 *  - the reason accumulates field names rather than replacing them (two edits
 *    before a moderator looks must leave the moderator both fields, not just
 *    the last one), and
 *  - `requestedAt` is set once and never refreshed, so queue age is honest and
 *    an owner editing their price daily cannot keep resetting their own place in
 *    the queue.
 */
export function requestRecheckFields(prev = {}, fields = []) {
  const merged = [...new Set([
    ...String(prev.recheckReason || '').split(/,\s*/).filter(Boolean),
    ...fields,
  ])];
  if (!merged.length) return {};
  return {
    recheckPending: true,
    recheckReason: merged.join(', '),
    recheckRequestedAt: prev.recheckRequestedAt || new Date().toISOString(),
  };
}

/** Mirror of `Property.clearRecheck` — a moderator has looked. Idempotent. */
export const clearedRecheckFields = () => ({
  recheckPending: false,
  recheckReason: '',
  recheckRequestedAt: '',
});
