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
 */
import { del, get, put } from '../../http.js';
import { toViewModelList } from './propertyMapper.js';

export async function listSaved({ page = 0, size = 20 } = {}) {
  const res = await get('/me/saved', { page, size });
  return {
    items: toViewModelList(res),
    // `totalElements` counts the whole shortlist, not the page — the number the Saved page's
    // header and the navbar badge both read.
    total: res?.totalElements ?? 0,
    page: res?.number ?? page,
    size: res?.size ?? size,
  };
}

export async function saveProperty(propertyId) {
  await put(`/me/saved/${encodeURIComponent(propertyId)}`);
}

export async function unsaveProperty(propertyId) {
  await del(`/me/saved/${encodeURIComponent(propertyId)}`);
}
