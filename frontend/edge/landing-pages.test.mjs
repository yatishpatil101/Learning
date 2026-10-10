// node edge/landing-pages.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { flatmateApiPath, flatmatePage, flatmateRoute, landingApiPath, landingPage, landingRoute, landingSitemapRows } from './landing-pages.mjs';
import { sitemapXml } from './seo-pages.mjs';
import {
  LANDING_PLACES, PUNE, TAGLINES, isIndexable, isWomenOnly, landingCopy, landingPath, landingQuery, listingsUrl, parseFlatmateLanding, parseLanding,
} from '../src/lib/landingPages.js';

const SHELL = '<!doctype html><html><head><title>Draazy</title><meta name="description" content="App" /></head><body><div id="root"></div></body></html>';
const ldOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const row = (n, over = {}) => ({
  id: `3f2a9c1e-7b4d-4e8a-9f10-${String(n).padStart(12, '0')}`, propertyType: 'Apartment', deal: 'rent', bhk: 2, price: 30000 + n, area: 900, areaUnit: 'sqft',
  locality: 'Baner', localitySlug: 'baner', status: 'approved', dealStatus: 'active', ...over,
});
const rows = (n, over) => Array.from({ length: n }, (_, i) => row(i + 1, over));
const baner = (deal, bhk) => parseLanding(deal, bhk ? ['baner', `${bhk}-bhk`] : ['baner']);

// Guides stay the single source for the place list and taglines.
const guideDir = new URL('../src/content/localities/', import.meta.url);
const guides = readdirSync(guideDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
assert.deepEqual(LANDING_PLACES.map((p) => p.slug).sort(), guides);
for (const p of LANDING_PLACES) {
  const md = readFileSync(new URL(`${p.slug}.md`, guideDir), 'utf8');
  assert.equal(md.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1], p.name, `${p.slug} name`);
  assert.equal(md.match(/^tagline:\s*["']?(.+?)["']?\s*$/m)?.[1], TAGLINES[p.slug], `${p.slug} tagline`);
}

// Parsing
assert.deepEqual(parseLanding('rent', ['pune']), { deal: 'rent', place: PUNE, bhk: null });
assert.equal(parseLanding('buy', ['baner', '2-bhk']).bhk, 2);
for (const bad of [[], ['nowhere'], ['baner', '5-bhk'], ['baner', '0-bhk'], ['baner', '2'], ['baner', '2-bhk', 'x'], ['pune', '2-bhk']]) {
  assert.equal(parseLanding('rent', bad), null, bad.join('/'));
}
assert.equal(parseLanding('lease', ['baner']), null);
assert.equal(landingPath('rent', 'baner', 2), '/rent/baner/2-bhk');
assert.equal(landingPath('buy'), '/buy/pune');
assert.deepEqual(parseFlatmateLanding('women-only-pune'), { women: true, place: PUNE });
assert.equal(parseFlatmateLanding('baner').place.name, 'Baner');
assert.equal(parseFlatmateLanding('nowhere'), null);

// Copy, queries, thresholds
assert.equal(landingCopy(baner('rent')).h1, 'Flats and homes for rent in Baner, Pune');
assert.equal(landingCopy(baner('buy', 3)).h1, '3 BHK flats for sale in Baner, Pune');
assert.equal(landingCopy(parseLanding('rent', ['pune'])).h1, 'Flats and homes for rent in Pune');
assert.equal(landingCopy(baner('rent')).intro.length, 2);
assert.deepEqual(landingQuery(baner('buy', 2)), { deal: 'buy', localities: ['baner'], bhks: ['2'], rank: 'relevance' });
assert.deepEqual(landingQuery(baner('rent', 4)).bhks, ['4plus'], 'rent 4 BHK is the app 4+ filter');
assert.deepEqual(landingQuery(parseLanding('rent', ['pune'])), { deal: 'rent', rank: 'relevance' });
assert.equal(listingsUrl(baner('rent', 2)), '/listings?deal=rent&loc=baner&bhks=2');
assert.equal(landingApiPath(baner('rent', 2)), '/properties?deal=rent&localities=baner&bhks=2&rank=relevance&size=20&page=0');
assert.ok(!isIndexable(baner('rent'), 4) && isIndexable(baner('rent'), 5));
assert.ok(!isIndexable(baner('rent', 2), 2) && isIndexable(baner('rent', 2), 3));

// Landing page render
const lived = landingPage(SHELL, baner('rent'), { content: rows(6), totalElements: 6 });
assert.equal(lived.status, 200);
assert.ok(lived.html.includes('<link data-shell="" rel="canonical" href="https://draazy.com/rent/baner" />'));
assert.ok(!lived.html.includes('noindex'), 'six homes clear the area threshold');
assert.ok(lived.html.includes('Flats and homes for rent in Baner, Pune</h1>'));
assert.ok(lived.html.includes('href="/locality/baner"') && lived.html.includes('href="/buy/baner"') && lived.html.includes('href="/rent/baner/2-bhk"'));
assert.ok(lived.html.includes('href="/listings?deal=rent&amp;loc=baner"'));
const [list, crumbs] = ldOf(lived.html)['@graph'];
assert.equal(list['@type'], 'ItemList');
assert.equal(list.itemListElement.length, 6);
assert.ok(list.itemListElement[0].url.startsWith('https://draazy.com/property/2-bhk-apartment-for-rent-baner-'));
assert.deepEqual(crumbs.itemListElement.map((c) => c.name), ['Home', 'Rent', 'Baner']);
const thin = landingPage(SHELL, baner('rent'), { content: rows(4), totalElements: 4 });
assert.ok(thin.html.includes('name="robots" content="noindex"'), 'four homes are below the area threshold');
const bhkPage = landingPage(SHELL, baner('rent', 2), { content: rows(3), totalElements: 3 });
assert.ok(!bhkPage.html.includes('noindex'), 'three 2 BHK homes clear the BHK threshold');
assert.deepEqual(ldOf(bhkPage.html)['@graph'][1].itemListElement.map((c) => c.name), ['Home', 'Rent', 'Baner', '2 BHK']);
const empty = landingPage(SHELL, baner('buy'), { content: [], totalElements: 0 });
assert.ok(empty.html.includes('noindex') && empty.html.includes('No homes listed right now'));
assert.ok(!ldOf(empty.html)['@graph'].some((n) => n['@type'] === 'ItemList'));
const closed = landingPage(SHELL, baner('rent'), { content: [...rows(2), row(9, { dealStatus: 'closed' })], totalElements: 3 });
assert.equal(ldOf(closed.html)['@graph'][0].itemListElement.length, 2, 'closed deals are not listed');
const many = landingPage(SHELL, baner('rent'), { content: rows(25), totalElements: 25 });
assert.equal(ldOf(many.html)['@graph'][0].itemListElement.length, 20, 'at most 20 listed');
assert.ok(many.html.includes('See all 25 homes'));
const xss = landingPage(SHELL, baner('rent'), { content: [row(1, { locality: '</script><script>alert(1)</script>' })], totalElements: 1 });
assert.ok(!xss.html.includes('<script>alert(1)'));

// Flatmate page render
const room = (n, over = {}) => ({ id: `r${n}`, title: `Room ${n}`, roomType: 'Private room', budget: 9000, locality: 'Baner', gender: 'any', owner: 'Secret Name', ownerMobile: '9999999999', ...over });
const group = (n, over = {}) => ({ id: `g${n}`, title: `Group ${n}`, locality: 'Baner', policy: 'any', perHead: 8000, seatsOpen: 1, seatsTotal: 3, members: [], ...over });
const baFm = parseFlatmateLanding('baner');
const women = parseFlatmateLanding('women-only-pune');
assert.equal(flatmateApiPath(baFm), '/flatmates/feed?tab=move-in&locality=Baner&size=50&page=0');
assert.equal(flatmateApiPath(women, 1), '/flatmates/feed?tab=move-in&gender=female&size=1&page=0');
assert.ok(isWomenOnly(room(1, { gender: 'female' })) && isWomenOnly(group(1, { policy: 'women' })) && !isWomenOnly(room(1)));
const fm = flatmatePage(SHELL, baFm, { content: [room(1, { seatsTotal: 1, seatsOpen: 1 }), room(2), group(3)], totalElements: 3 });
assert.ok(!fm.html.includes('noindex'));
assert.ok(fm.html.includes('href="/flatmates/room/r1"') && fm.html.includes('href="/flatmates/group/g3"'), 'a room with seats is still a room');
assert.ok(fm.html.includes('₹9,000/month'), 'a room keeps its budget');
assert.ok(!fm.html.includes('Secret Name') && !fm.html.includes('9999999999'), 'no personal data in the edge body');
assert.ok(flatmatePage(SHELL, baFm, { content: [room(1), room(2)], totalElements: 2 }).html.includes('noindex'));
const womenFm = flatmatePage(SHELL, women, { content: [room(1, { gender: 'female' }), room(2), room(3, { gender: 'female' }), group(4, { policy: 'women' }), group(5)], totalElements: 5 });
assert.ok(!womenFm.html.includes('noindex'), 'three strictly women-only posts');
assert.equal(ldOf(womenFm.html)['@graph'][0].itemListElement.length, 3);
assert.ok(flatmatePage(SHELL, women, { content: [room(1, { gender: 'female' }), room(2), room(3)], totalElements: 3 }).html.includes('noindex'), 'hosts open to anyone do not count');

// Sitemap rows
const getter = (over = () => null) => async (path) => {
  const forced = over(path);
  if (forced) return forced;
  const q = new URLSearchParams(path.split('?')[1]);
  if (path.startsWith('/flatmates/feed')) return { status: 200, data: { content: q.get('locality') === 'Baner' || q.get('gender') ? rows(3).map((r) => ({ ...r, gender: 'female', roomType: 'x' })) : [], totalElements: q.get('locality') === 'Baner' ? 3 : 0 } };
  if (q.get('localities') === 'baner' && q.get('deal') === 'rent') return { status: 200, data: { content: [...rows(3, { bhk: 2 }), ...rows(3, { bhk: 3 }), ...rows(2, { bhk: 1 })], totalElements: 8 } };
  if (!q.get('localities')) return { status: 200, data: { content: [], totalElements: q.get('deal') === 'rent' ? 40 : 2 } };
  return { status: 200, data: { content: [], totalElements: 0 } };
};
const calls = [];
const siteRows = await landingSitemapRows(async (p) => { calls.push(p); return getter()(p); });
assert.deepEqual(siteRows.map(([p]) => p), ['/rent/pune', '/rent/baner', '/rent/baner/2-bhk', '/rent/baner/3-bhk', '/flatmates/women-only-pune', '/flatmates/baner']);
assert.equal(calls.length, 39, 'API calls stay bounded');
assert.ok(sitemapXml(siteRows).includes('<loc>https://draazy.com/rent/baner/2-bhk</loc>'));
assert.equal(await landingSitemapRows(getter((p) => (p.includes('localities=wakad') ? { status: 500, data: null } : null))), null, 'an API failure is not a partial sitemap');

// Route handlers: 404, redirect, API 404, API down, ok
const env = { API_ORIGIN: 'https://api.example.com', ORIGIN_SHARED_SECRET: 's', ASSETS: { fetch: async () => new Response(SHELL) } };
const req = (path) => new Request(`https://draazy.com${path}`, { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
const realFetch = globalThis.fetch;
try {
  let apiCalls = 0;
  globalThis.fetch = async () => { apiCalls += 1; return new Response(JSON.stringify({ content: rows(6), totalElements: 6 }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const nf = await landingRoute({ request: req('/rent/nowhere'), env, deal: 'rent', segments: ['nowhere'] });
  assert.equal(nf.status, 404);
  assert.equal((await landingRoute({ request: req('/buy/baner/9-bhk'), env, deal: 'buy', segments: ['baner', '9-bhk'] })).status, 404);
  assert.equal(apiCalls, 0, 'unknown URLs never reach the API');
  const slash = await landingRoute({ request: req('/rent/baner/?x=1'), env, deal: 'rent', segments: ['baner', ''] });
  assert.equal(slash.status, 404, 'an empty segment is not a page');
  const up = await landingRoute({ request: req('/rent/baner'), env, deal: 'rent', segments: ['baner'] });
  assert.equal(up.status, 200);
  assert.equal(up.headers.get('X-Frame-Options'), 'DENY');
  assert.match(await up.text(), /ItemList/);
  const sandbox = await landingRoute({ request: new Request('https://sandbox.draazy.com/rent/baner'), env, deal: 'rent', segments: ['baner'] });
  assert.equal(sandbox.headers.get('X-Robots-Tag'), 'noindex');
  const flatNf = await flatmateRoute({ request: req('/flatmates/nowhere'), env, slug: 'nowhere' });
  assert.equal(flatNf.status, 404);
  const flatOk = await flatmateRoute({ request: req('/flatmates/baner'), env, slug: 'baner' });
  assert.equal(flatOk.status, 200);

  globalThis.fetch = async () => new Response('{}', { status: 404 });
  assert.equal((await landingRoute({ request: req('/rent/baner'), env, deal: 'rent', segments: ['baner'] })).status, 404);
  globalThis.fetch = async () => { throw new Error('down'); };
  const down = await landingRoute({ request: req('/rent/baner'), env, deal: 'rent', segments: ['baner'] });
  assert.equal(down.status, 200);
  assert.equal(await down.text(), SHELL, 'API down serves the bare shell');
} finally {
  globalThis.fetch = realFetch;
}

console.log('edge landing-pages: all checks passed');
