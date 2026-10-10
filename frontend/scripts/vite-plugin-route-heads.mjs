/* Prerendered shell per static route, plus the readable copy of the service pages and home,
   so crawlers and link previews see the right page without JavaScript. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { esc, headTags, jsonLd, renderPage } from './seo-html.mjs';
import { ROUTE_HEADS, SITE_DESCRIPTION } from '../src/data/routeHeads.js';
import { TRUST_PAGES } from '../src/data/trustPages.js';
import { COMPARE_NOBROKER } from '../src/data/compareNobroker.js';
import { compareBody } from './compare-body.mjs';
import { toolBodies, toolsItemList } from './tools-body.mjs';

const SITE = 'https://draazy.com';
const ORG = { '@id': `${SITE}/#organization` };
const PUNE = { '@type': 'City', name: 'Pune' };

function schemaFor(head, url) {
  const name = head.title.split(' | ')[0];
  if (head.schema === 'Service') {
    return { '@type': 'Service', name, description: head.description, url, provider: ORG, areaServed: PUNE };
  }
  if (head.schema === 'WebApplication') {
    return {
      '@type': 'WebApplication', name, description: head.description, url,
      applicationCategory: 'FinanceApplication', operatingSystem: 'Any', isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' }, publisher: ORG,
    };
  }
  if (head.schema === 'AboutPage') {
    return {
      '@type': 'AboutPage', name, description: head.description, url, inLanguage: 'en-IN',
      isPartOf: { '@id': `${SITE}/#website` }, about: ORG, mainEntity: ORG,
    };
  }
  if (head.schema === 'ItemList') return toolsItemList(SITE);
  if (head.schema === 'WebPage') {
    return {
      '@type': 'WebPage', name, description: head.description, url, inLanguage: 'en-IN',
      isPartOf: { '@id': `${SITE}/#website` }, publisher: ORG,
    };
  }
  return null;
}

const breadcrumbList = (trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});

const vals =  (o) => Object.values(o || {});
const section = (title, inner, sub) => `<section class="mt-10"><h2 class="text-2xl font-bold text-white">${esc(title)}</h2>`
  + `${sub ? `<p class="mt-2 text-sm text-gray-400">${esc(sub)}</p>` : ''}${inner}</section>`;
const cards = (list, t = 'name', d = 'desc') => `<ul class="mt-4 space-y-3">${vals(list).map((x) => `<li><h3 class="font-bold text-white">${esc(x[t])}</h3><p class="text-sm text-gray-400">${esc(x[d])}</p></li>`).join('')}</ul>`;
const bullets = (list) => `<ul class="mt-4 list-disc pl-5 text-sm text-gray-300">${vals(list).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const faqSection = (title, faq) => section(title, `<dl class="mt-4 space-y-4">${vals(faq).map((f) => `<dt class="font-medium text-white">${esc(f.q)}</dt><dd class="text-sm text-gray-400">${esc(f.a)}</dd>`).join('')}</dl>`);
const main = (top, accent, sub, ...parts) => `<main class="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
<h1 class="text-3xl font-extrabold leading-tight text-white sm:text-5xl">${esc(top)} <span class="gradient-text">${esc(accent)}</span></h1>
${sub ? `<p class="mt-5 max-w-2xl text-base text-gray-300 sm:text-lg">${esc(sub)}</p>` : ''}
${parts.filter(Boolean).join('\n')}
</main>`;

/* Hub card order and targets mirror the SERVICES table in src/pages/consumer/Services.jsx. */
const HUB_CARDS = [
  ['rentAgreement', '/services/rent-agreement'], ['buyHome', '/listings?deal=buy'], ['rentHome', '/listings?deal=rent'],
  ['localityInsights', '/locality/baner'], ['homeLoans', '/home-loans'], ['propertyLegal', '/services/property-legal'],
  ['packersMovers', '/services/packers-movers'], ['interior', '/services/interior-renovation'], ['valuation', '/services/property-valuation'],
];

/* ServiceLanding pages (legal, packers, home loans). Stat strips are left out: plan 6.5 lists them as unbacked. */
const landing = (p, extra = '') => ({
  faq: p.faq,
  body: main(p.titleTop, p.titleAccent, p.subtitle,
    section(p.servicesHeading, cards(p.service), p.servicesSub),
    extra,
    section(p.trustHeading, cards(p.trust, 't', 'd')),
    p.step && section('How it works', cards(p.step, 't', 'd')),
    faqSection('Frequently asked questions', p.faq)),
});
const standalone = (p) => ({
  faq: p.faq,
  body: main(p.heroTitle1, p.heroTitleAccent, p.heroSubtitle,
    section(p.servicesTitle, cards(p.service), p.servicesSub),
    section(p.howItWorks, cards(p.step, 't', 'd')),
    faqSection(p.faqTitle, p.faq)),
});
const trust = (p) => ({
  faq: p.faq,
  body: main(p.top, p.accent, p.intro,
    ...p.sections.map((s) => section(s.title,
      (s.body || []).map((t) => `<p class="mt-3 text-sm text-gray-300">${esc(t)}</p>`).join('')
      + (s.list ? bullets(s.list) : '')
      + (s.links ? `<p class="mt-3 text-sm">${s.links.map(([l, to]) => `<a href="${esc(to)}" class="font-bold text-white">${esc(l)}</a>`).join(' &middot; ')}</p>` : ''))),
    p.faq && faqSection('Frequently asked questions', p.faq)),
});

/* Only copy each page actually renders, read from the same locale file, so the HTML never says more than the screen. */
export function routeBodies({ services: s }) {
  const ra = s.ra;
  return {
    '/services': {
      body: main(s.hub.heroTitle1, s.hub.heroTitleAccent, s.hub.heroSubtitle,
        section(s.hub.ourServices, `<ul class="mt-4 space-y-3">${HUB_CARDS.map(([k, to]) => `<li><a href="${esc(to)}" class="font-bold text-white">${esc(s.hub.card[k].name)}</a><p class="text-sm text-gray-400">${esc(s.hub.card[k].desc)}</p></li>`).join('')}</ul>`, s.hub.ourServicesSub),
        section(s.hub.howItWorksTitle, cards(s.hub.step, 't', 'd'), s.hub.howItWorksSub)),
    },
    '/services/rent-agreement': {
      faq: ra.assist.faq,
      body: main(ra.hero.title1, ra.hero.titleAccent, ra.hero.subtitle,
        `<ol class="mt-6 space-y-2 text-sm text-gray-300">${[1, 2, 3].map((n) => `<li><strong class="text-white">${esc(ra.hero[`step${n}Title`])}</strong>: ${esc(ra.hero[`step${n}Desc`])}</li>`).join('')}</ol>`,
        section(ra.docs.title, [['ownerTitle', 'docOwner'], ['tenantTitle', 'docTenant'], ['otherTitle', 'docOther']]
          .map(([t, list]) => `<h3 class="mt-6 font-bold text-white">${esc(ra.docs[t])}</h3>${bullets(ra.docs[list])}`).join(''), ra.docs.subtitle),
        section(ra.cost.title, `<p class="mt-4 text-sm text-gray-300">${esc(ra.cost.formula)}</p>`, ra.cost.subtitle),
        section(ra.assist.title, cards(ra.assist.item)),
        faqSection(ra.assist.faqTitle, ra.assist.faq)),
    },
    '/services/property-legal': landing(s.legal,
      section(s.legal.regProcessTitle, cards(s.legal.timeline, 't', 'd'), s.legal.regProcessSub)
      + section(s.legal.docsNeeded, bullets(s.legal.doc))),
    '/services/packers-movers': landing(s.packers),
    '/home-loans': landing(s.homeLoans),
    '/services/interior-renovation': standalone(s.interior),
    '/services/property-valuation': standalone(s.valuation),
    '/compare/nobroker': compareBody(COMPARE_NOBROKER),
    ...toolBodies(),
  '/about': trust(TRUST_PAGES['/about']),
    '/how-verification-works': trust(TRUST_PAGES['/how-verification-works']),
  };
}

const faqPage = (faq) => ({
  '@type': 'FAQPage',
  mainEntity: vals(faq).map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

/* Footer "Explore" and "Company" links, so the home page's crawlable copy reaches the content hubs. */
const HOME_LINKS = [
  ['Buy property', '/listings?deal=buy'], ['Rent property', '/listings?deal=rent'], ['Flatmates', '/flatmates'],
  ['Browse societies', '/societies'], ['Services', '/services'], ['EMI calculator', '/emi-calculator'],
  ['Locality guides', '/locality'], ['Blog', '/blog'], ['Help centre', '/help'],
];

/* Only home sections that render regardless of the city's stock: hero heading, Why Draazy, owner CTA, FAQ. */
export function homeBody({ home: h }) {
  const faq = Object.keys(h.faq).filter((k) => /^q\d+$/.test(k)).map((k) => ({ q: h.faq[k], a: h.faq[`a${k.slice(1)}`] }));
  const why = [{ name: h.why.heroTitle, desc: h.why.heroBody }, ...[1, 2, 3].map((n) => ({ name: h.why[`row${n}Title`], desc: h.why[`row${n}Body`] }))];
  const link = ([label, to]) => `<li><a href="${esc(to)}" class="text-sm text-gray-300">${esc(label)}</a></li>`;
  return {
    faq,
    body: main('Find Your Dream Home in', 'Pune', SITE_DESCRIPTION,
      section(`${h.why.headingLine1} ${h.why.headingLine2}`, cards(why)),
      section(`${h.cta.headingLead} ${h.cta.headingHighlight}`, `<p class="mt-4 text-sm text-gray-300">${esc(h.cta.body)}</p>`
        + `<p class="mt-4"><a href="/list-property" class="font-bold text-white">${esc(h.cta.listFree)}</a></p>`),
      section('Explore', `<ul class="mt-4 space-y-2">${HOME_LINKS.map(link).join('')}</ul>`),
      faqSection(h.faq.title, faq)),
  };
}

export function routePage(shell, path, head, { body = '', faq } = {}) {
  if (head.title.length > 60) throw new Error(`[route-heads] ${path}: title is ${head.title.length} chars; keep it to 60`);
  if (head.description.length > 160) throw new Error(`[route-heads] ${path}: description is ${head.description.length} chars; keep it to 160`);
  const url = `${SITE}${path}`;
  const crumbs = head.schema === 'Service' && breadcrumbList([['Home', `${SITE}/`], ['Services', `${SITE}/services`], [head.title.split(' | ')[0], url]]);
  const graph = [schemaFor(head, url), faq && faqPage(faq), crumbs].filter(Boolean);
  const extra = graph.length ? [jsonLd({ '@context': 'https://schema.org', '@graph': graph })] : [];
  const tags = headTags({ ...head, url, image: `${SITE}/og-image.jpg`, type: 'website', extra });
  return renderPage(shell, tags, body);
}

/* public/sitemap.xml is an empty <urlset>; each prerender plugin adds its own pages. No lastmod: a build date
   would claim every static page changed on each deploy. */
export function withStaticUrls(xml) {
  if (xml.includes(`<loc>${SITE}/</loc>`)) return xml;
  const urls = Object.keys(ROUTE_HEADS).map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n');
  return xml.replace(/<urlset[^>]*>/, (open) => `${open}\n${urls}`);
}

export default function routeHeadsPlugin() {
  let outDir;
  let root;
  return {
    name: 'draazy-route-heads',
    apply: 'build',
    configResolved(c) { root = c.root; outDir = resolve(c.root, c.build.outDir); },
    writeBundle() {
      const shellFile = join(outDir, 'index.html');
      if (!existsSync(shellFile)) return;
      const shell = readFileSync(shellFile, 'utf-8');
      const bodies = routeBodies(JSON.parse(readFileSync(join(root, 'src/i18n/locales/en/services.json'), 'utf-8')));
      for (const [path, head] of Object.entries(ROUTE_HEADS)) {
        if (path === '/') continue;
        const file = join(outDir, `${path}.html`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, routePage(shell, path, head, bodies[path]), 'utf-8');
      }
      const sitemap = join(outDir, 'sitemap.xml');
      if (existsSync(sitemap)) writeFileSync(sitemap, withStaticUrls(readFileSync(sitemap, 'utf-8')), 'utf-8');
    },
    /* closeBundle, not writeBundle: every other prerender plugin and the spa-fallback's 404.html copy read
       dist/index.html as the bare shell during writeBundle, and must not inherit home's content and canonical. */
    closeBundle() {
      const shellFile = join(outDir, 'index.html');
      if (!existsSync(shellFile)) return;
      const home = homeBody(JSON.parse(readFileSync(join(root, 'src/i18n/locales/en/home.json'), 'utf-8')));
      writeFileSync(shellFile, routePage(readFileSync(shellFile, 'utf-8'), '/', ROUTE_HEADS['/'], home), 'utf-8');
    },
  };
}
