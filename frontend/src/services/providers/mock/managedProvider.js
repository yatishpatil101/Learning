/**
 * Mock managed-property provider — the offline counterpart to
 * `providers/http/managedProvider.js`, and the default the app runs on with no backend.
 *
 * It wraps the existing `lib/data/managedProperty.js` store (the per-user `puneNestManagedProps:`
 * key the HTML prototype used) and hands back the same shapes the http provider does, so the owner
 * hub reads one object from either. Two adjustments, both about the *interface* rather than the
 * data:
 *
 * 1. **Everything is async.** The store is synchronous; the seam is not, and cannot be — the live
 *    side is a network call. Wrapping here rather than making callers branch is the whole point of
 *    the seam.
 * 2. **`publishManaged` returns one shape.** The store returns either a freshly-minted listing
 *    object or a bare `{ id, already: true }` marker depending on which path it took, and the two
 *    have almost nothing in common. Both are normalised to `{ id, already, record }`, which is what
 *    the http provider reconstructs on its side too.
 */
import {
  getManagedProps, getManagedProp, registerManagedProp, updateManagedProp,
  deleteManagedProp, publishManagedProp, ensureManagedForListing as bridgeListing,
} from '../../../lib/data/managedProperty.js';

/** The caller's managed records, newest first (the store unshifts, so insertion order is enough). */
export async function listManaged() {
  return getManagedProps();
}

/** One record, or null. Null rather than a throw is the shape several owner surfaces branch on. */
export async function getManaged(id) {
  return getManagedProp(id);
}

/** Register a new private record; resolves to the created record. */
export async function registerManaged(data) {
  return registerManagedProp(data);
}

/** Partial update; resolves to the updated record, or null when the id is unknown. */
export async function updateManaged(id, changes) {
  return updateManagedProp(id, changes);
}

/** Hard delete. The listing it may have spawned is untouched. */
export async function deleteManaged(id) {
  deleteManagedProp(id);
}

/**
 * Publish into the pending-review flow.
 *
 * The store's two return shapes are collapsed here: a first publish yields the new listing, a
 * repeat yields `{ id, already: true }`. Callers only ever need the listing id and whether anything
 * actually happened, so that is what they get — and it is the same object the live provider builds.
 */
export async function publishManaged(id) {
  const res = publishManagedProp(id);
  if (!res) return null;
  return { id: res.id || '', already: !!res.already, record: getManagedProp(id) };
}

/** Bridge a listing the owner already posted to a managed record. Idempotent in the store. */
export async function ensureManagedForListing(listing) {
  return bridgeListing(listing);
}
