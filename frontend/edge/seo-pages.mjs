/* Edge rendering for the API-backed public pages (functions/property, functions/society, functions/sitemaps).
   Pure string work so it runs in Node tests and Pages Functions alike; the handlers only do the I/O. */
import { esc, headTags, jsonLd, renderPage } from '../scripts/seo-html.mjs';
import { listingHead, listingPrice, listingTitle, propertyPath, societyHead } from '../src/lib/listingSeo.js';
import { fmtArea } from '../src/lib/format.js';
import { GUIDE_LOCALITIES, guideSlugFor } from '../src/lib/guideLocalities.js';

export const SITE = 'https://draazy.com';

/* Pages does not apply public/_headers to a Function's response. Kept identical to its `/*` block by
   scripts/check-csp.mjs. */
export const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'sha256-ZXdSxc/Anc08bj274JFX2HAdiHdWoQmZxe3rCLP4Fvk=' 'sha256-AWm4GprHDLo6r2wqq30FxD6yP5RlUPqJBnQSQzVkY6w=' 'wasm-unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com https://www.googletagmanager.com https://us-assets.i.posthog.com https://sdk.cashfree.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https: https://i.ytimg.com; connect-src 'self' https://images.unsplash.com https://maps.googleapis.com https://maps.gstatic.com https://places.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://us.i.posthog.com https://us-assets.i.posthog.com https://sandbox.cashfree.com https://payments-test.cashfree.com https://api.cashfree.com https://payments.cashfree.com; frame-src 'self' blob: https://sandbox.cashfree.com https://api.cashfree.com https://www.youtube-nocookie.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self' https://sandbox.cashfree.com https://api.cashfree.com; frame-ancestors 'none'",
};

// `data-shell=""` lets src/lib/usePageHead.js drop it when the reader navigates in-app to another page.
export const NOINDEX = '<meta data-shell="" name="robots" content="noindex" />';
const HTTPS = /^https:\/\//;
const sentence = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : '');
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
export const crumbs = (site, trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site}${path}` })),
});
const amenityFeature = (list) => list?.length && { amenityFeature: list.map((a) => ({ '@type': 'LocationFeatureSpecification', name: sentence(a), value: true })) };
const facts = (rows) => {
  const items = rows.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<li><span class="text-gray-400">${esc(k)}:</span> ${esc(v)}</li>`);
  return items.length ? `<ul class="mt-6 space-y-1 text-sm text-gray-300">${items.join('')}</ul>` : '';
};
const listSection = (title, items) => (items?.length
  ? `<section class="mt-8"><h2 class="text-xl font-bold text-white">${esc(title)}</h2><ul class="mt-3 list-disc pl-5 text-sm text-gray-300">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`
  : '');
// The trail's last entry is the page itself, so the visible breadcrumb links stop before it.
export const page = (trail, ...parts) => `<main class="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
<nav aria-label="Breadcrumb" class="text-sm text-gray-400">${trail.slice(0, -1).map(([name, path]) => `<a href="${esc(path)}">${esc(name)}</a>`).join(' › ')}</nav>
<h1 class="mt-4 text-3xl font-extrabold leading-tight text-white sm:text-4xl">${esc(trail.at(-1)[0])}</h1>
${parts.filter(Boolean).join('\n')}
</main>`;

/** Unknown or not public: the app draws its own "not found" over this shell. */
export const notFoundPage = (shell) => ({ status: 404, html: shell.replace('</head>', () => `    ${NOINDEX}\n  </head>`) });

function residenceType(type) {
  const t = String(type || '').toLowerCase();
  if (/flat|apartment|studio|penthouse/.test(t)) return 'Apartment';
  if (/villa/.test(t)) return 'SingleFamilyResidence';
  if (/house/.test(t)) return 'House';
  return null;
}

function floorSize(area, unit) {
  if (!area) return null;
  const code = { sqft: 'FTK', sqm: 'MTK', sqyd: 'YDK', acre: 'ACR', hectare: 'HAR' }[unit || 'sqft'];
  return { '@type': 'QuantitativeValue', value: Number(area), ...(code ? { unitCode: code } : { unitText: unit }) };
}

/** `p` is the anonymous `GET /properties/{id}` body (PropertyResponse.java). */
export function propertyPage(shell, p, { pathname, search = '', site = SITE }) {
  const l = { bhk: p.bhk, type: p.propertyType, deal: p.deal, locality: p.locality, price: p.price, area: p.area, areaUnit: p.areaUnit };
  const path = propertyPath({ id: p.id, slug: p.slug, ...l });
  // `path` is plain ASCII, so the raw pathname compares without decoding (a malformed escape cannot throw).
  if (pathname !== path) return { status: 301, location: `${path}${search}` };

  const url = `${site}${path}`;
  const name = listingTitle(l);
  const price = listingPrice(l);
  const { title, description } = listingHead(l);
  const live = p.status === 'approved' && p.dealStatus !== 'closed';
  const rent = p.deal === 'rent';
  const images = [...new Set([p.coverImage, ...(p.images || [])].filter((s) => HTTPS.test(s || '')))];
  const image = images[0] || `${site}/og-image.jpg`;
  const kind = residenceType(p.propertyType);
  const size = kind && floorSize(p.area, p.areaUnit);
  const society = p.societySlug && p.societyName && [p.societyName, `/society/${p.societySlug}`];
  const trail = [['Home', '/'], [rent ? 'Rent' : 'Buy', `/listings?deal=${rent ? 'rent' : 'buy'}`], [p.locality || 'Pune', p.localitySlug ? `/locality/${p.localitySlug}` : '/listings'],
    ...(society ? [society] : []), [name, path]];

  const listing = {
    '@type': 'RealEstateListing',
    '@id': `${url}#listing`,
    url,
    name,
    description: (p.description || description).slice(0, 500),
    ...(day(p.createdAt) && { datePosted: day(p.createdAt) }),
    ...(images.length && { image: images.slice(0, 6) }),
    ...(price && {
      offers: {
        '@type': 'Offer',
        price: Number(p.price),
        priceCurrency: 'INR',
        availability: `https://schema.org/${live ? 'InStock' : 'SoldOut'}`,
        businessFunction: `http://purl.org/goodrelations/v1#${rent ? 'LeaseOut' : 'Sell'}`,
        ...(rent && { priceSpecification: { '@type': 'UnitPriceSpecification', price: Number(p.price), priceCurrency: 'INR', unitText: 'MONTH' } }),
      },
    }),
    mainEntity: {
      '@type': kind || 'Place',
      name,
      address: { '@type': 'PostalAddress', ...(p.locality && { addressLocality: p.locality }), addressRegion: 'Maharashtra', addressCountry: 'IN' },
      // Rounded to about 100 m: a crawler needs the neighbourhood, not the owner's door.
      ...(p.lat != null && p.lng != null && { geo: { '@type': 'GeoCoordinates', latitude: +Number(p.lat).toFixed(3), longitude: +Number(p.lng).toFixed(3) } }),
      ...(kind && Number(p.bhk) > 0 && { numberOfBedrooms: Number(p.bhk) }),
      ...(size && { floorSize: size }),
      ...amenityFeature(p.amenities),
      ...(society && { containedInPlace: { '@type': 'ApartmentComplex', name: society[0], url: `${site}${society[1]}` } }),
    },
  };
  const video = HTTPS.test(p.video || '') && {
    '@type': 'VideoObject',
    name: `Video tour: ${name}`,
    description,
    contentUrl: p.video,
    thumbnailUrl: image,
    ...(day(p.createdAt) && { uploadDate: day(p.createdAt) }),
  };

  const head = headTags({
    title, description, url, image, type: 'website',
    extra: [
      ...(live ? [] : [NOINDEX]),
      jsonLd({ '@context': 'https://schema.org', '@graph': [listing, crumbs(site, trail), video].filter(Boolean) }),
    ],
  });
  const guide = guideSlugFor(p);
  const floor = p.floor != null && p.floor !== '' ? `${p.floor}${p.totalFloors ? ` of ${p.totalFloors}` : ''}` : '';
  const body = page(trail,
    price && `<p class="mt-3 text-2xl font-bold text-white">${esc(price)}</p>`,
    !live && '<p class="mt-3 text-sm text-amber-300">This home is no longer available.</p>',
    facts([
      ['Area', fmtArea(p.area, p.areaUnit)],
      ['Furnishing', sentence(p.furnishing)],
      ['Floor', floor],
      ['Deposit', rent && Number(p.deposit) > 0 ? `₹${Number(p.deposit).toLocaleString('en-IN')}` : ''],
      ['Society', p.societyName],
      ['Locality', p.locality && `${p.locality}, Pune`],
    ]),
    p.description && `<section class="mt-8"><h2 class="text-xl font-bold text-white">About this home</h2><p class="mt-3 text-sm text-gray-300">${esc(p.description)}</p></section>`,
    listSection('Amenities', (p.amenities || []).map(sentence)),
    guide && `<p class="mt-6 text-sm"><a href="/locality/${guide}">Read the ${GUIDE_LOCALITIES[guide]} locality guide</a></p>`,
    '<p class="mt-8 text-sm text-gray-400">Listed by the owner on Draazy. You pay no brokerage.</p>');
  return { status: 200, html: renderPage(shell, head, body) };
}

/** `s` is the anonymous `GET /societies/{slug}` body (SocietyDetailResponse.java). */
export function societyPage(shell, s, { slug, search = '', site = SITE }) {
  // A merged-away slug answers with its survivor.
  if (s.slug && s.slug !== slug) return { status: 301, location: `/society/${s.slug}${search}` };

  const path = `/society/${s.slug}`;
  const url = `${site}${path}`;
  const { loc, where, title, description, thin } = societyHead(s);
  const trail = [['Home', '/'], ['Societies', '/societies'], ...(s.localitySlug ? [[loc, `/locality/${s.localitySlug}`]] : []), [s.name, path]];

  const complex = {
    '@type': 'ApartmentComplex',
    '@id': `${url}#society`,
    name: s.name,
    url,
    description,
    address: { '@type': 'PostalAddress', ...(loc && { addressLocality: loc }), addressRegion: 'Maharashtra', addressCountry: 'IN' },
    ...(s.lat != null && s.lng != null && { geo: { '@type': 'GeoCoordinates', latitude: Number(s.lat), longitude: Number(s.lng) } }),
    ...(s.units && { numberOfAccommodationUnits: { '@type': 'QuantitativeValue', value: s.units } }),
    ...amenityFeature(s.amenities),
    ...(s.localitySlug && { containedInPlace: { '@type': 'Place', name: where, url: `${site}/locality/${s.localitySlug}` } }),
  };
  const head = headTags({
    title, description, url, image: `${site}/og-image.jpg`, type: 'website',
    extra: [...(thin ? [NOINDEX] : []), jsonLd({ '@context': 'https://schema.org', '@graph': [complex, crumbs(site, trail)] })],
  });
  const body = page(trail,
    `<p class="mt-3 text-base text-gray-300">${esc(description)}</p>`,
    facts([['Builder', s.builder], ['Built', s.year], ['Towers', s.towers], ['Homes', s.units], ['RERA', s.rera]]),
    listSection('Amenities', (s.amenities || []).map(sentence)),
    s.homes?.length && `<section class="mt-8"><h2 class="text-xl font-bold text-white">Homes listed here</h2><ul class="mt-3 space-y-1 text-sm">${s.homes.map((h) => `<li><a href="/property/${esc(h.id)}">${esc(h.title || 'View home')}</a></li>`).join('')}</ul></section>`);
  return { status: 200, html: renderPage(shell, head, body) };
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `rows` are `[path, lastmod]` pairs; a null lastmod is left out. */
export const sitemapXml = (rows, site = SITE) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.map(([path, lastmod]) => `  <url><loc>${xmlEsc(`${site}${path}`)}</loc>${lastmod ? `<lastmod>${xmlEsc(lastmod)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;

/** A `GET /properties` row (PropertySummary.java) as a sitemap row; null when it should not be listed. */
export const propertySitemapRow = (r) => (r.status === 'approved' && r.dealStatus !== 'closed'
  ? [propertyPath({ id: r.id, slug: r.slug, bhk: r.bhk, type: r.propertyType, deal: r.deal, locality: r.locality }), day(r.createdAt)]
  : null);

/** A `GET /societies?hasListings=true` row (SocietyResponse.java). */
export const societySitemapRow = (r) => (r.slug ? [`/society/${r.slug}`, null] : null);

const ORIGIN = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/;

/** Anonymous API read through the origin gate, as functions/api/[[path]].js does. `{ status: 0 }` means unusable. */
export async function apiGet(env, request, path) {
  const origin = (env.API_ORIGIN || '').trim().replace(/\/+$/, '');
  const secret = (env.ORIGIN_SHARED_SECRET || '').trim();
  if (!ORIGIN.test(origin) || !secret) return { status: 0 };
  const headers = { Accept: 'application/json', 'X-Proxy-Auth': secret, 'X-Forwarded-Proto': 'https' };
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers['X-Forwarded-For'] = ip;
  try {
    const res = await fetch(`${origin}${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return { status: res.status, data: res.ok ? await res.json() : null };
  } catch {
    return { status: 0 };
  }
}

/** The SPA shell, the same file `_redirects` serves for these routes. */
export const fetchShell = async (env, request) => (await env.ASSETS.fetch(new URL('/404', request.url))).text();

/* vite.config.js noindexes non-production builds through `_headers`, which Functions never get, so the
   same rule is applied here by host. */
export const headersFor = (request) => (new URL(request.url).host === new URL(SITE).host
  ? SECURITY_HEADERS
  : { ...SECURITY_HEADERS, 'X-Robots-Tag': 'noindex' });

export function htmlResponse({ status, html, location }, headers = SECURITY_HEADERS) {
  if (location) return new Response(null, { status, headers: { Location: location, ...headers } });
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', ...headers },
  });
}

/** Shared by the property and society handlers: render from the API, or fall back to the bare shell. */
export async function edgePage({ request, env, apiPath, render }) {
  const [shell, api] = await Promise.all([fetchShell(env, request), apiGet(env, request, apiPath)]);
  const headers = headersFor(request);
  if (api.status === 404) return htmlResponse(notFoundPage(shell), headers);
  // Origin down or misconfigured: the app still works from the bare shell, so never fail the page.
  if (api.status !== 200 || !api.data) return htmlResponse({ status: 200, html: shell }, headers);
  return htmlResponse(render(shell, api.data, new URL(request.url)), headers);
}
