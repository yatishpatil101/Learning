/* Mirrors `Property.requestRecheck` / `Property.clearRecheck` server-side. Kept pure so
   `list-property/submit.js` can share the logic without importing a data layer. */

/* Two rules are copied from the server deliberately, because a client that is *more permissive*
   than the server passes tests the real thing would fail: the reason accumulates field names rather
   than replacing them, and `requestedAt` is set once so daily edits cannot reset queue age. */
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
