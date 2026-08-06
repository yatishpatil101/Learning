/**
 * Mock saved provider — the localStorage counterpart to `providers/http/savedProvider.js`.
 *
 * Storage stays where it was (`pnSavedProps:<mobile>`, a bare array of ids in `lib/store`), so the
 * React app and the older HTML prototype still share a shortlist. What changes is the *shape on the
 * way out*: the seam returns property view models, because that is what `GET /me/saved` returns.
 * Resolving ids to properties therefore happens here rather than in the page, which is the whole
 * point — a call site must not be able to tell which provider answered it.
 *
 * The previous version of this file also wrapped saved searches, plans, boosts and service orders.
 * Those had no consumers and belong to four other backend controllers; they were removed rather
 * than carried forward. See `services/savedService.js` for the reasoning.
 */
import { getProperty } from '../../../lib/mockApi.js';
import { getSavedProps, toggleSavedProp } from '../../../lib/store.js';

/** Mirrors the server's page default so paging behaves identically on mocks. */
const DEFAULT_SIZE = 20;

/**
 * The shortlist as property view models.
 *
 * Ids that no longer resolve are dropped rather than returned as holes: a saved listing can
 * legitimately be archived later, and one dead id must not blank the page or render an empty card.
 * `total` counts the resolved rows, so it agrees with what the user can actually see.
 */
export async function listSaved({ page = 0, size = DEFAULT_SIZE } = {}) {
  // `getSavedProps` appends on save, so the raw array is oldest-first. The server returns
  // newest-first; reverse here so "most recently saved" means the same thing on both providers.
  const ids = [...getSavedProps()].reverse();
  const resolved = (await Promise.all(ids.map((id) => getProperty(id)))).filter(Boolean);
  const start = page * size;
  return {
    items: resolved.slice(start, start + size),
    total: resolved.length,
    page,
    size,
  };
}

/**
 * `toggleSavedProp` is the only primitive the store exposes, so the idempotent set/clear the
 * contract requires is expressed as "toggle only if that would move it the right way". Without the
 * membership check, saving something already saved would silently *remove* it — the exact bug a
 * double-tap or a retry would produce.
 */
export async function saveProperty(propertyId) {
  if (!getSavedProps().includes(propertyId)) toggleSavedProp(propertyId);
}

export async function unsaveProperty(propertyId) {
  if (getSavedProps().includes(propertyId)) toggleSavedProp(propertyId);
}
