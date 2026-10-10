/** Rows pass through untouched (the server's `ContentItem` is the console's shape); `undefined` is stripped from
 * write bodies because absent means "leave alone" and explicit null means "clear" in a PATCH. */
import { get, post, patch } from '../../http.js';

const BASE = '/admin/content';

/** Drop keys whose value is `undefined`; keep explicit nulls, which mean "clear this field". */
const defined = (body) => Object.fromEntries(
  Object.entries(body || {}).filter(([, v]) => v !== undefined),
);

export async function listContent(type, { archived, translations } = {}) {
  const rows = await get(`${BASE}/${encodeURIComponent(type)}`, { archived, translations });
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
