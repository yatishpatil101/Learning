/* Route handlers do the I/O; the render functions are pure so the Node self-check covers them. */
import { esc, headTags, jsonLd, renderPage } from '../scripts/seo-html.mjs';
import { NOINDEX, SITE, crumbs, edgePage, fetchShell, headersFor, htmlResponse, notFoundPage, page } from './seo-pages.mjs';
import { listingPrice, listingTitle, propertyPath } from '../src/lib/listingSeo.js';
import { fmtArea } from '../src/lib/format.js';
import {
  LANDING_BHKS, LANDING_PLACES, MIN_INDEXABLE, PUNE, bhkMatches, flatmateCopy, flatmatePath, isIndexable, isWomenOnly, landingCopy, landingPath,
  landingQuery, listingsUrl, parseFlatmateLanding, parseLanding,
} from '../src/lib/landingPages.js';

const LISTED = 20;
const FEED_PAGE = 50;
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
const section = (title, inner) => `<section class="mt-8"><h2 class="text-xl font-bold text-white">${esc(title)}</h2>${inner}</section>`;
const linkList = (items) => `<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">${items.map(([href, text]) => `<li>${link(href, text)}</li>`).join('')}</ul>`;
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const toQuery = (params) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => [].concat(v).forEach((x) => q.append(k, x)));
  return q.toString();
};

export const landingApiPath = (target) => `/properties?${toQuery({ ...landingQuery(target), size: LISTED, page: 0 })}`;

/** `data` is the anonymous `GET /properties` page (PropertySearchResponse.java). */
export function landingPage(shell, target, data, { site = SITE } = {}) {
  const { deal, place, bhk } = target;
  const copy = landingCopy(target);
  const path = landingPath(deal, place.slug, bhk);
  const url = `${site}${path}`;
  const rows = (data.content || []).filter((r) => r.status === 'approved' && r.dealStatus !== 'closed').slice(0, LISTED);
  const total = data.totalElements ?? rows.length;
  const items = rows.map((r) => {
    const l = { id: r.id, slug: r.slug, bhk: r.bhk, type: r.propertyType, deal: r.deal, locality: r.locality, price: r.price };
    return { href: propertyPath(l), name: listingTitle(l), price: listingPrice(l), area: fmtArea(r.area, r.areaUnit) };
  });

  const dealName = deal === 'rent' ? 'Rent' : 'Buy';
  const trail = [['Home', '/'], [dealName, landingPath(deal)], ...(place === PUNE ? [] : [[place.name, landingPath(deal, place.slug)]]), ...(bhk ? [[`${bhk} BHK`, path]] : [])];
  const otherDeal = deal === 'rent' ? 'buy' : 'rent';
  const withHeading = [...trail.slice(0, -1), [copy.h1, path]];

  const itemList = items.length && {
    '@type': 'ItemList',
    '@id': `${url}#list`,
    name: copy.h1,
    numberOfItems: total,
    itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}${x.href}`, name: x.name })),
  };
  const head = headTags({
    title: copy.title, description: copy.description, url, image: `${site}/og-image.jpg`, type: 'website',
    extra: [
      ...(isIndexable(target, total) ? [] : [NOINDEX]),
      jsonLd({ '@context': 'https://schema.org', '@graph': [itemList, crumbs(site, trail)].filter(Boolean) }),
    ],
  });

  const count = total === 1 ? '1 home listed' : `${total} homes listed`;
  const places = LANDING_PLACES.filter((p) => p !== place).map((p) => [landingPath(deal, p.slug), p.name]);
  const body = page(withHeading,
    ...copy.intro.map((s) => `<p class="mt-3 text-base text-gray-300">${esc(s)}</p>`),
    section(total ? count : 'No homes listed right now', items.length
      ? `<ul class="mt-3 space-y-2 text-sm text-gray-300">${items.map((x) => `<li>${link(x.href, x.name)}${[x.price, x.area].filter(Boolean).map((s) => ` · ${esc(s)}`).join('')}</li>`).join('')}</ul>`
      : '<p class="mt-3 text-sm text-gray-400">New homes are added every day. Try the full search or look at another area.</p>'),
    section('Explore more', linkList([
      [listingsUrl(target), total > items.length ? `See all ${total} homes with more filters` : 'More filters'],
      ...(place === PUNE ? [] : [[`/locality/${place.slug}`, `${place.name} area guide`]]),
      [landingPath(otherDeal, place.slug, bhk), `Homes for ${otherDeal === 'rent' ? 'rent' : 'sale'} in ${copy.where}`],
      ...(place === PUNE ? [] : [[landingPath(deal, place.slug), 'All sizes'], ...LANDING_BHKS.map((n) => [landingPath(deal, place.slug, n), `${n} BHK`])]),
    ])),
    section(`${dealName} in other areas`, linkList([...(place === PUNE ? [] : [[landingPath(deal), 'All of Pune']]), ...places])));
  return { status: 200, html: renderPage(shell, head, body) };
}

const notFound = async (request, env) => htmlResponse(notFoundPage(await fetchShell(env, request)), headersFor(request));
const redirectTo = (request, path) => htmlResponse({ status: 301, location: `${path}${new URL(request.url).search}` }, headersFor(request));

/** `/rent/...` and `/buy/...`; `segments` is the catch-all's path array. */
export async function landingRoute({ request, env, deal, segments }) {
  const target = parseLanding(deal, [].concat(segments ?? []));
  if (!target) return notFound(request, env);
  const path = landingPath(deal, target.place.slug, target.bhk);
  if (new URL(request.url).pathname !== path) return redirectTo(request, path);
  return edgePage({ request, env, apiPath: landingApiPath(target), render: (shell, data) => landingPage(shell, target, data) });
}

export const flatmateApiPath = ({ women, place }, size = FEED_PAGE) => `/flatmates/feed?${toQuery({ tab: 'move-in', ...(women ? { gender: 'female' } : { locality: place.name }), size, page: 0 })}`;

/* The women-only filter also admits hosts open to anyone, so the strict subset is picked out here. */
const flatmateRows = (target, data) => {
  const content = data.content || [];
  return target.women ? content.filter(isWomenOnly) : content;
};
const flatmateCount = (target, data) => (target.women ? flatmateRows(target, data).length : data.totalElements ?? flatmateRows(target, data).length);

function flatmateItem(row, place) {
  // Rooms carry seatsTotal too, so room fields are tested first (same order as flatmateProvider).
  if (!(row.roomType || row.roomKind) && (row.members || row.seatsTotal != null)) {
    const seats = Number(row.seatsOpen) > 0 ? `${row.seatsOpen} ${row.seatsOpen === 1 ? 'seat' : 'seats'} open` : '';
    return { href: `/flatmates/group/${encodeURIComponent(row.id)}`, name: row.title || `Flat share in ${row.locality || place.name}`, facts: [Number(row.perHead) > 0 && `${rupees(row.perHead)}/month each`, seats] };
  }
  return {
    href: `/flatmates/room/${encodeURIComponent(row.id)}`,
    name: row.title || `${row.roomType || 'Room'} in ${row.locality || place.name}`,
    facts: [Number(row.budget) > 0 && `${rupees(row.budget)}/month`, row.roomType, row.homeTypeLabel],
  };
}

/** Only what the anonymous GET /flatmates/feed page already shows: no names, no contact. */
export function flatmatePage(shell, target, data, { site = SITE } = {}) {
  const copy = flatmateCopy(target);
  const path = flatmatePath(target);
  const url = `${site}${path}`;
  const rows = flatmateRows(target, data).slice(0, LISTED);
  const total = flatmateCount(target, data);
  const items = rows.map((r) => flatmateItem(r, target.place));
  const trail = [['Home', '/'], ['Flatmates', '/flatmates'], [target.women ? 'Women-only' : target.place.name, path]];

  const itemList = items.length && {
    '@type': 'ItemList',
    '@id': `${url}#list`,
    name: copy.h1,
    numberOfItems: total,
    itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}${x.href}`, name: x.name })),
  };
  const head = headTags({
    title: copy.title, description: copy.description, url, image: `${site}/og-image.jpg`, type: 'website',
    extra: [
      ...(total >= MIN_INDEXABLE.flatmates ? [] : [NOINDEX]),
      jsonLd({ '@context': 'https://schema.org', '@graph': [itemList, crumbs(site, trail)].filter(Boolean) }),
    ],
  });
  const places = LANDING_PLACES.filter((p) => p !== target.place).map((p) => [`/flatmates/${p.slug}`, p.name]);
  const body = page([...trail.slice(0, -1), [copy.h1, path]],
    ...copy.intro.map((s) => `<p class="mt-3 text-base text-gray-300">${esc(s)}</p>`),
    section(total ? `${total} ${total === 1 ? 'post' : 'posts'} live` : 'No posts live right now', items.length
      ? `<ul class="mt-3 space-y-2 text-sm text-gray-300">${items.map((x) => `<li>${link(x.href, x.name)}${x.facts.filter(Boolean).map((s) => ` · ${esc(s)}`).join('')}</li>`).join('')}</ul>`
      : '<p class="mt-3 text-sm text-gray-400">Hosts and flatmates post every week. Open the full board or look at another area.</p>'),
    section('Explore more', linkList([
      ['/flatmates', 'All flatmate posts'],
      ...(target.women ? [] : [[`/locality/${target.place.slug}`, `${target.place.name} area guide`]]),
      ...(target.women ? [] : [['/flatmates/women-only-pune', 'Women-only flats and rooms']]),
      ...places,
    ])));
  return { status: 200, html: renderPage(shell, head, body) };
}

/** `/flatmates/<slug>`: one segment, so it never shadows `/flatmates/:kind/:id`. */
export async function flatmateRoute({ request, env, slug }) {
  const target = parseFlatmateLanding(slug);
  if (!target) return notFound(request, env);
  const path = flatmatePath(target);
  if (new URL(request.url).pathname !== path) return redirectTo(request, path);
  return edgePage({ request, env, apiPath: flatmateApiPath(target), render: (shell, data) => flatmatePage(shell, target, data) });
}

const usable = (api) => api.status === 200 && api.data;

/** Rows for sitemaps/landing.xml: every landing URL over its threshold, or null when the API could not answer.
    One search per area and deal (up to 100 rows, counted by BHK here) keeps the whole sitemap at 39 API calls. */
export async function landingSitemapRows(get) {
  const rows = [];
  for (const deal of ['rent', 'buy']) {
    const city = await get(`/properties?${toQuery({ deal, size: 1 })}`);
    if (!usable(city)) return null;
    if (isIndexable({ bhk: null }, city.data.totalElements)) rows.push([landingPath(deal), null]);
    for (const place of LANDING_PLACES) {
      const res = await get(`/properties?${toQuery({ deal, localities: place.slug, size: 100 })}`);
      if (!usable(res)) return null;
      const content = res.data.content || [];
      if (isIndexable({ bhk: null }, res.data.totalElements)) rows.push([landingPath(deal, place.slug), null]);
      for (const bhk of LANDING_BHKS) {
        if (isIndexable({ bhk }, content.filter((r) => bhkMatches({ deal }, bhk, r)).length)) rows.push([landingPath(deal, place.slug, bhk), null]);
      }
    }
  }
  for (const target of [{ women: true, place: PUNE }, ...LANDING_PLACES.map((place) => ({ women: false, place }))]) {
    const res = await get(flatmateApiPath(target, target.women ? FEED_PAGE : 1));
    if (!usable(res)) return null;
    if (flatmateCount(target, res.data) >= MIN_INDEXABLE.flatmates) rows.push([flatmatePath(target), null]);
  }
  return rows;
}
