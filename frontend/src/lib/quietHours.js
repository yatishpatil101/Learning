/* Quiet hours: pure logic over a preferences document, deliberately kept out of the store.
   Deciding whether a clock time falls inside a window reads nothing and writes nothing, so a home
   next to the persistence layer would tie every caller to a storage module it has no other reason
   to import. Callers pass the document they already hold — the one the service resolved, which on a
   live account is the window the user set on whichever device they set it on. */

/**
 * Whether `at` falls inside the user's quiet-hours window. Handles windows that wrap past midnight
 * (e.g. 22:00 → 07:00). Non-critical alerts are suppressed while this is true.
 *
 * `prefs` is required rather than defaulted to a stored document: a default read would be the local
 * device's copy, which is the stale answer the caller was trying to avoid by fetching in the first
 * place, and it would apply silently to any caller that simply forgot its argument.
 *
 * @param {{ quietHours?: { enabled?: boolean, start?: string, end?: string } }} prefs
 * @param {Date} [at]
 */
export const inQuietHours = (prefs, at = new Date()) => {
  const q = prefs && prefs.quietHours;
  if (!q || !q.enabled) return false;
  const toMin = (s) => {
    const [h, m] = String(s || '').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const now = at.getHours() * 60 + at.getMinutes();
  const start = toMin(q.start);
  const end = toMin(q.end);
  // An empty window (start === end) suppresses nothing. The alternative reading — that it suppresses
  // everything — turns a half-finished settings edit into a silent inbox.
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
};
