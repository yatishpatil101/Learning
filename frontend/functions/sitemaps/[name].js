import { apiGet, headersFor, propertySitemapRow, sitemapXml, societySitemapRow } from '../../edge/seo-pages.mjs';
import { landingSitemapRows } from '../../edge/landing-pages.mjs';

const SOURCES = {
  'properties.xml': { path: '/properties?size=100&page=', toRow: propertySitemapRow },
  'societies.xml': { path: '/societies?hasListings=true&size=100&page=', toRow: societySitemapRow },
  'landing.xml': { rows: (env, request) => landingSitemapRows((path) => apiGet(env, request, path)) },
};
// ponytail: 50 pages of 100 rows each; split into numbered sitemaps if the catalogue outgrows 5,000.
const MAX_PAGES = 50;

async function pagedRows(source, env, request) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const api = await apiGet(env, request, `${source.path}${page}`);
    if (api.status !== 200 || !api.data) return null;
    rows.push(...(api.data.content || []).map(source.toRow).filter(Boolean));
    if (page + 1 >= (api.data.totalPages || 0)) break;
  }
  return rows;
}

export async function onRequestGet({ request, env, params, waitUntil }) {
  const source = SOURCES[params.name];
  const headers = headersFor(request);
  if (!source) return new Response('Not found', { status: 404, headers });

  const cache = globalThis.caches?.default;
  // Keyed on the path alone: a query string must not buy a fresh 50-page crawl of the API.
  const key = new Request(new URL(new URL(request.url).pathname, request.url));
  const hit = cache && await cache.match(key);
  if (hit) return hit;

  const rows = await (source.rows ? source.rows(env, request) : pagedRows(source, env, request));
  // A partial sitemap would tell crawlers the missing URLs are gone; a 503 asks them to come back.
  if (!rows) return new Response('Sitemap unavailable', { status: 503, headers: { 'Retry-After': '3600', ...headers } });

  const response = new Response(sitemapXml(rows), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...headers },
  });
  if (cache) waitUntil(cache.put(key, response.clone()));
  return response;
}
