/**
 * HTTP saved provider — the live counterpart to `providers/mock/savedProvider.js`.
 *
 * `GET /me/saved` returns `PropertySummary` rows, which is the same payload the search and detail
 * endpoints return, so this reuses `propertyMapper.toViewModelList` rather than growing a second
 * mapper for the same shape. A `savedMapper.js` here would be a copy of one that already exists,
 * and the failure mode of a copy is that only one of the two gets fixed.
 *
 * Both writes are `204 No Content` and idempotent server-side, so there is no body to unwrap and a
 * repeated call is not an error.
 *
 * **`propertyId` must be the listing's UUID, not the token it is routed by.** Both write paths bind
 * `@PathVariable UUID propId` (`SavedPropertyController:53,61`), and `propertyMapper` sets a view
 * model's `id` to `slug || uuid` because the UI puts it in `/property/:id`. Those are different
 * strings for every curated listing, so passing `id` here answers **400** — and because the heart
 * is optimistic, the only visible symptom is that it fills for one frame and then un-fills. This
 * docblock previously described the writes as idempotent and 204, which is true and was never the
 * part in doubt; it said nothing about which of the two identifiers they take, and that omission is
 * what the bug was made of. `SavedContext.toggle` resolves the uuid before calling in.
 */
import { del, get, put, unwrapPage } from '../../http.js';
import { toViewModelList } from './propertyMapper.js';

export async function listSaved({ page = 0, size = 20 } = {}) {
  const res = await get('/me/saved', { page, size });
  // `total` is `totalElements` — the whole shortlist, not this page. Both the Saved page header and
  // the navbar badge read it, so the distinction is visible to the user.
  const { items, ...rest } = unwrapPage(res, { page, size });
  return { items: toViewModelList(res), ...rest };
}

export async function saveProperty(propertyId) {
  await put(`/me/saved/${encodeURIComponent(propertyId)}`);
}

export async function unsaveProperty(propertyId) {
  await del(`/me/saved/${encodeURIComponent(propertyId)}`);
}
