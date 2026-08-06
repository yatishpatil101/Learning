/**
 * Saved Service — the caller's property shortlist (the heart on a card).
 *
 * ## Why this is only about saved *properties*
 *
 * The mock provider this replaces bundled five unrelated things behind one name: saved properties,
 * saved searches, subscription plans, listing boosts and service orders. On the server those are
 * five different controllers (`SavedPropertyController`, `SavedSearchController`, `PlansController`,
 * `BoostsController`, `ServiceCatalogController`), so carrying the bundle into the live layer would
 * have pinned five backend slices behind one provider — none of them shippable until all of them
 * were. The other four had no consumers at all and were dropped rather than migrated.
 *
 * ## Shape
 *
 * `listSaved` returns **full property view models**, not ids:
 *
 *   { items, total, page, size }
 *
 * That mirrors `GET /me/saved`, which returns `PropertySummary` rows. It also removes an N+1 the
 * mock forced — the Saved page used to read a list of ids and then fetch each property separately,
 * so a shortlist of thirty cost thirty-one requests. The server already knows which properties
 * these are, so it sends them.
 *
 * ## Why there is no `isSaved(id)`
 *
 * The obvious signature is the wrong one. `isSaved` is asked once per card, and a results page
 * renders thirty cards — as a per-call round trip that is thirty requests to draw thirty hearts.
 * Membership is answered from the set that `SavedContext` loads once and holds in memory, so the
 * question never reaches the network. Use `useSaved()` from `context/SavedContext.jsx`, not this
 * module, anywhere a heart is drawn.
 *
 * Writes are idempotent on both providers: saving something already saved is a no-op, not an error,
 * so a double-tap cannot desynchronise the UI from the server.
 */
import { createProvider } from './config.js';

const provider = createProvider('saved');

/**
 * The shortlist, newest save first.
 *
 * @param {{page?: number, size?: number}} [opts]
 * @returns {Promise<{items: object[], total: number, page: number, size: number}>}
 */
export const listSaved = (opts) => provider().listSaved(opts);

/** Add to the shortlist. Idempotent. */
export const saveProperty = (propertyId) => provider().saveProperty(propertyId);

/** Remove from the shortlist. Idempotent. */
export const unsaveProperty = (propertyId) => provider().unsaveProperty(propertyId);
