/* Mirrors `Property.requestRecheck` / `Property.clearRecheck` server-side. Kept pure so
   `list-property/submit.js` can share the logic without importing a data layer. */

/** Two rules are copied from the server deliberately, because a client that is *more permissive* than the server
 * passes tests the real thing would fail. */
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

// Must match `Property.OWNERSHIP_REVIEW_ITEM` server-side.
export const OWNERSHIP_REVIEW_ITEM = 'Ownership documents';

/** The owner asked for the badge from their document vault and it is not granted yet. */
export const seeksOwnershipBadge = (listing) => Boolean(listing?.ownershipRequestedAt && !listing.ownershipVerified);

/** The re-check queue holds this listing only for the badge request — no edit to approve. */
export const onlySeeksOwnershipBadge = (listing) => Boolean(listing?.recheckPending)
  && String(listing.recheckReason || '').trim() === OWNERSHIP_REVIEW_ITEM;
