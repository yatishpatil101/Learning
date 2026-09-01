/**
 * HTTP provider for the admin CMS - `/admin/content/{type}` and its four sub-routes.
 *
 * The rows are passed through almost untouched. There is no mapper here because the server's
 * `ContentItem` already *is* the shape the console renders: one flat record where the fields of
 * the other three types are null. Inventing a per-type view model would mean the page and the API
 * described the same row differently, and the whole point of moving the vocabulary to the server
 * was to stop that.
 *
 * The one thing this file does do is strip `undefined` from write bodies, because `undefined` and
 * `null` mean opposite things to a PATCH: absent is "leave alone", explicit null is "clear it".
 * `JSON.stringify` drops `undefined` keys anyway, so this is belt and braces - but relying on that
 * would make the distinction an accident of serialisation rather than a decision.
 */
import { get, post, patch } from '../../http.js';

const BASE = '/admin/content';

/** Drop keys whose value is `undefined`; keep explicit nulls, which mean "clear this field". */
const defined = (body) => Object.fromEntries(
  Object.entries(body || {}).filter(([, v]) => v !== undefined),
);

export async function listContent(type) {
  const rows = await get(`${BASE}/${encodeURIComponent(type)}`);
  return Array.isArray(rows) ? rows : [];
}

export async function createContent(type, body) {
  return post(`${BASE}/${encodeURIComponent(type)}`, defined(body));
}

export async function updateContent(type, id, body) {
  return patch(`${BASE}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, defined(body));
}

export async function archiveContent(type, id) {
  return post(`${BASE}/${encodeURIComponent(type)}/${encodeURIComponent(id)}/archive`);
}

export async function restoreContent(type, id) {
  return post(`${BASE}/${encodeURIComponent(type)}/${encodeURIComponent(id)}/restore`);
}
