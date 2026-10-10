// node edge/seo-pages.test.mjs
import assert from 'node:assert/strict';
import { edgePage, propertyPage, propertySitemapRow, sitemapXml, societyPage, SECURITY_HEADERS } from './seo-pages.mjs';
import { listingHead, propertyHref, propertyKey, propertyPath } from '../src/lib/listingSeo.js';

const ID = '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b';
const SHELL = '<!doctype html><html><head><title>Draazy</title><meta name="description" content="App" /></head><body><div id="root"></div></body></html>';
const P = {
  id: ID, propertyType: 'Apartment', deal: 'rent', bhk: 2, price: 32000, area: 950, areaUnit: 'sqft',
  locality: 'Baner', localitySlug: 'baner', societyName: 'Green Acres', societySlug: 'green-acres-baner',
  status: 'approved', dealStatus: 'active', lat: 18.559123, lng: 73.786987, furnishing: 'semi-furnished',
  description: 'Sunny flat </script><script>alert(1)</script>', amenities: ['lift', 'gym'],
  coverImage: 'https://images.unsplash.com/a.jpg', images: ['https://images.unsplash.com/a.jpg', 'photos/x/y'], createdAt: '2026-10-01T10:00:00Z',
};
const PATH = `/property/2-bhk-apartment-for-rent-baner-${ID}`;
const ldOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

// URLs
assert.equal(propertyPath({ id: ID, bhk: 2, type: 'Apartment', deal: 'rent', locality: 'Baner' }), PATH);
assert.equal(propertyPath({ id: ID.toUpperCase(), bhk: 0, type: 'Independent House', deal: 'buy', locality: 'Viman Nagar' }), `/property/1-rk-independent-house-for-sale-viman-nagar-${ID}`);
assert.equal(propertyPath({ id: ID, bhk: null, type: 'Open Plot', deal: 'buy', locality: 'Wagholi' }), `/property/open-plot-for-sale-wagholi-${ID}`);
assert.equal(propertyPath({ id: 'p1', bhk: 2, type: 'Flat', deal: 'rent', locality: 'Baner' }), '/property/p1', 'demo ids stay bare');
assert.equal(propertyHref({ id: 'legacy-slug', uuid: ID, bhkNum: 2, type: 'Apartment', deal: 'rent', locality: 'Baner' }), PATH);
assert.equal(propertyHref({ id: 'p5010', uuid: ID, slug: 'p5010', bhkNum: 2, type: 'Apartment', deal: 'rent', locality: 'Baner' }), '/property/p5010', 'a hand-set slug is the URL');
assert.deepEqual(propertyPage(SHELL, { ...P, slug: 'p5010' }, { pathname: `/property/${ID}` }), { status: 301, location: '/property/p5010' });
assert.equal(propertyKey(PATH.slice(10)), ID);
assert.equal(propertyKey(ID), ID);
assert.equal(propertyKey('2bhk-baner-legacy'), '2bhk-baner-legacy');
assert.equal(listingHead({ ...P, type: P.propertyType }).title, '2 BHK Apartment for Rent in Baner, Pune: ₹32,000/month | Draazy');
assert.equal(listingHead({ ...P, type: P.propertyType }).description, '2 BHK Apartment for Rent in Baner, Pune: 950 sq.ft. at ₹32,000/month. Contact the owner directly on Draazy, with no brokerage.');

// Property page
assert.deepEqual(propertyPage(SHELL, P, { pathname: `/property/${ID}`, search: '?tab=amenities' }), { status: 301, location: `${PATH}?tab=amenities` });
const live = propertyPage(SHELL, P, { pathname: PATH });
assert.equal(live.status, 200);
assert.ok(live.html.includes(`<link data-shell="" rel="canonical" href="https://draazy.com${PATH}" />`));
assert.ok(live.html.includes('<meta property="og:image" content="https://images.unsplash.com/a.jpg" />'));
assert.ok(!live.html.includes('noindex'));
assert.ok(!live.html.includes('<script>alert(1)'), 'listing text is escaped in body and JSON-LD');
assert.ok(live.html.includes('<h1 class="mt-4 text-3xl font-extrabold leading-tight text-white sm:text-4xl">2 BHK Apartment for Rent in Baner</h1>'));
assert.ok(live.html.includes('<a href="/locality/baner">Baner</a> › <a href="/society/green-acres-baner">Green Acres</a>'));
const [listing, crumbs] = ldOf(live.html)['@graph'];
assert.equal(listing['@type'], 'RealEstateListing');
assert.equal(listing.offers.availability, 'https://schema.org/InStock');
assert.equal(listing.offers.priceSpecification.unitText, 'MONTH');
assert.deepEqual(listing.image, ['https://images.unsplash.com/a.jpg'], 'non-https keys dropped, duplicates merged');
assert.equal(listing.mainEntity['@type'], 'Apartment');
assert.deepEqual(listing.mainEntity.geo, { '@type': 'GeoCoordinates', latitude: 18.559, longitude: 73.787 });
assert.equal(listing.mainEntity.numberOfBedrooms, 2);
assert.equal(listing.mainEntity.floorSize.unitCode, 'FTK');
assert.deepEqual(crumbs.itemListElement.map((c) => c.name), ['Home', 'Rent', 'Baner', 'Green Acres', '2 BHK Apartment for Rent in Baner']);
assert.ok(live.html.includes('<a href="/locality/baner">Read the Baner locality guide</a>'));
assert.ok(!propertyPage(SHELL, { ...P, locality: 'Wagholi', localitySlug: 'wagholi' }, { pathname: PATH.replace('baner', 'wagholi') }).html.includes('locality guide'), 'no guide, no guide link');
const rented = propertyPage(SHELL, { ...P, status: 'rented', dealStatus: 'closed' }, { pathname: PATH });
assert.ok(rented.html.includes('<meta data-shell="" name="robots" content="noindex" />'));
assert.equal(ldOf(rented.html)['@graph'][0].offers.availability, 'https://schema.org/SoldOut');
assert.ok(rented.html.includes('no longer available'));

// Society page
const S = { slug: 'green-acres-baner', name: 'Green Acres', builder: 'Kolte Patil', localitySlug: 'baner', year: 2015, towers: 4, units: 320, amenities: ['pool'], listingCount: 3, forRent: 2, forSale: 1, homes: [{ id: ID, title: '2 BHK for rent' }] };
assert.deepEqual(societyPage(SHELL, S, { slug: 'old-name' }), { status: 301, location: '/society/green-acres-baner' });
const soc = societyPage(SHELL, S, { slug: S.slug });
assert.ok(soc.html.includes('<title data-shell="Draazy">Green Acres, Baner, Pune: Homes, Amenities &amp; Reviews | Draazy</title>'));
assert.ok(soc.html.includes('Green Acres in Baner, Pune by Kolte Patil, built in 2015. 2 homes for rent and 1 home for sale from owners, with no brokerage.'));
assert.ok(!soc.html.includes('noindex'));
assert.equal(ldOf(soc.html)['@graph'][0]['@type'], 'ApartmentComplex');
const thin = societyPage(SHELL, { slug: 'x', name: 'X', localitySlug: 'baner', listingCount: 0, homes: [] }, { slug: 'x' });
assert.ok(thin.html.includes('<meta data-shell="" name="robots" content="noindex" />'));
assert.ok(thin.html.includes('Facts, amenities and resident reviews on Draazy.'));

// Sitemaps
assert.deepEqual(propertySitemapRow({ ...P, propertyType: 'Apartment' }), [PATH, '2026-10-01']);
assert.equal(propertySitemapRow({ ...P, dealStatus: 'closed' }), null);
assert.ok(sitemapXml([[PATH, '2026-10-01'], ['/society/a&b', null]]).includes(`<url><loc>https://draazy.com${PATH}</loc><lastmod>2026-10-01</lastmod></url>\n  <url><loc>https://draazy.com/society/a&amp;b</loc></url>`));

// Handler flow: API 404 → real 404, API down → bare shell 200, both with the security headers.
const env = { API_ORIGIN: 'https://api.example.com', ORIGIN_SHARED_SECRET: 's', ASSETS: { fetch: async () => new Response(SHELL) } };
const request = new Request(`https://draazy.com${PATH}`, { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
const realFetch = globalThis.fetch;
const run = async (answer) => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return answer(); };
  const res = await edgePage({ request, env, apiPath: `/properties/${ID}`, render: (shell, p, url) => propertyPage(shell, p, { pathname: url.pathname }) });
  return { res, seen, html: await res.text() };
};
try {
  const gone = await run(() => new Response('{}', { status: 404 }));
  assert.equal(gone.res.status, 404);
  assert.ok(gone.html.includes('noindex'));
  assert.equal(gone.seen.url, `https://api.example.com/properties/${ID}`);
  assert.equal(gone.seen.init.headers['X-Proxy-Auth'], 's');
  assert.equal(gone.seen.init.headers['X-Forwarded-For'], '1.2.3.4');
  assert.equal(gone.res.headers.get('Content-Security-Policy'), SECURITY_HEADERS['Content-Security-Policy']);
  const down = await run(() => { throw new Error('connect'); });
  assert.equal(down.res.status, 200);
  assert.equal(down.html, SHELL);
  const ok = await run(() => Response.json(P));
  assert.equal(ok.res.status, 200);
  assert.match(ok.html, /RealEstateListing/);
  assert.equal(ok.res.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(ok.res.headers.get('X-Robots-Tag'), null, 'production is indexable');
  const sandbox = await edgePage({ request: new Request(`https://sandbox.draazy.com${PATH}`), env, apiPath: '/x', render: (shell, p, url) => propertyPage(shell, p, { pathname: url.pathname }) });
  assert.equal(sandbox.headers.get('X-Robots-Tag'), 'noindex', 'other hosts never get indexed');
} finally {
  globalThis.fetch = realFetch;
}

console.log('edge seo-pages: all checks passed');
