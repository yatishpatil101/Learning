import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeBody, routeBodies, routePage, withStaticUrls } from './vite-plugin-route-heads.mjs';
import { ROUTE_HEADS } from '../src/data/routeHeads.js';

const shell = `<!doctype html><html><head>
    <title>Shell</title>
    <meta name="description" content="shell" />
    <meta property="og:title" content="shell" />
  </head><body><div id="root"></div></body></html>`;

const page = routePage(shell, '/services/rent-agreement', ROUTE_HEADS['/services/rent-agreement']);
assert.equal(page.match(/<title[ >]/g).length, 1, 'shell title replaced, not duplicated');
assert.match(page, /<title data-shell="Shell">Online Rent Agreement in Pune/);
assert.match(page, /<link data-shell="" rel="canonical" href="https:\/\/draazy.com\/services\/rent-agreement" \/>/);
assert.match(page, /"@type":"Service".*"provider":\{"@id":"https:\/\/draazy.com\/#organization"\}/);
assert.match(page, /"@type":"BreadcrumbList".*"name":"Services","item":"https:\/\/draazy.com\/services"/);
assert.match(routePage(shell, '/emi-calculator', ROUTE_HEADS['/emi-calculator']), /"@type":"WebApplication"/);
assert.doesNotMatch(routePage(shell, '/plans', ROUTE_HEADS['/plans']), /ld\+json/);

for (const [path, head] of Object.entries(ROUTE_HEADS)) routePage(shell, path, head);
assert.throws(() => routePage(shell, '/x', { title: 'x'.repeat(61), description: 'd' }), /title is 61 chars/);

const bodies = routeBodies(JSON.parse(readFileSync(new URL('../src/i18n/locales/en/services.json', import.meta.url), 'utf-8')));
for (const [path, { body, faq }] of Object.entries(bodies)) {
  assert.ok(ROUTE_HEADS[path], `${path} has a route head`);
  assert.match(body, /<h1 [^>]*>\S/, `${path} has an h1`);
  assert.doesNotMatch(body, /undefined|\{\{/, `${path} renders only real copy`);
  if (faq) assert.ok(Object.keys(faq).length >= 4, `${path} FAQ`);
}
const ra = routePage(shell, '/services/rent-agreement', ROUTE_HEADS['/services/rent-agreement'], bodies['/services/rent-agreement']);
assert.match(ra, /"@graph":\[\{"@type":"Service".*\{"@type":"FAQPage","mainEntity":\[\{"@type":"Question"/);
assert.match(ra, /<div id="root"><main [^>]*>\n<h1 [^>]*>Online Rent Agreement/);
assert.doesNotMatch(bodies['/services/interior-renovation'].body, /2,500\+|4\.8★/);

const graphOf = (path) => {
  const html = routePage(shell, path, ROUTE_HEADS[path], bodies[path]);
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((m) => JSON.parse(m[1])['@graph']);
};
const node = (path, type) => graphOf(path).find((n) => n['@type'] === type);
assert.equal(node('/about', 'AboutPage').mainEntity['@id'], 'https://draazy.com/#organization');
assert.equal(node('/how-verification-works', 'FAQPage').mainEntity.length, 6);
const compareTypes = graphOf('/compare/nobroker').map((n) => n['@type']);
assert.ok(compareTypes.includes('WebPage') && compareTypes.includes('FAQPage'), 'compare: WebPage + FAQPage');
for (const t of ['Product', 'Review', 'AggregateRating']) assert.ok(!compareTypes.includes(t), `compare carries no ${t}`);
assert.equal(node('/tools', 'ItemList').itemListElement.length, 4);
for (const path of Object.keys(ROUTE_HEADS).filter((p) => p.startsWith('/tools/'))) {
  assert.ok(node(path, 'WebApplication')?.isAccessibleForFree, `${path} WebApplication`);
  assert.ok(node(path, 'FAQPage')?.mainEntity.length >= 3, `${path} FAQ`);
}

const home = homeBody(JSON.parse(readFileSync(new URL('../src/i18n/locales/en/home.json', import.meta.url), 'utf-8')));
assert.equal(home.faq.length, 5);
assert.doesNotMatch(home.body, /undefined|\{\{/);
assert.match(home.body, /href="\/locality"/);
const homePage = routePage(shell, '/', ROUTE_HEADS['/'], home);
assert.match(homePage, /<link data-shell="" rel="canonical" href="https:\/\/draazy.com\/" \/>/);
assert.match(homePage, /"@graph":\[\{"@type":"FAQPage","mainEntity":\[\{"@type":"Question","name":"Does Draazy charge any brokerage\?"/);

const skeleton = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf-8');
const sitemap = withStaticUrls(skeleton);
assert.equal(sitemap.match(/<url>/g).length, Object.keys(ROUTE_HEADS).length);
assert.match(sitemap, /<urlset [^>]*>\n {2}<url><loc>https:\/\/draazy.com\/<\/loc><\/url>\n {2}<url><loc>https:\/\/draazy.com\/listings<\/loc>/);
assert.equal(withStaticUrls(sitemap), sitemap, 'idempotent');

console.log('vite-plugin-route-heads: ok');
