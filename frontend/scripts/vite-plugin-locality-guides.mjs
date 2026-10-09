/* A guide makes /locality/<slug> indexable before the area has listings, so each is also written to
   dist/locality/<slug>.html at build, as are the hub and the sitemap rows. */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRenderer, parseFrontmatter } from './vite-plugin-help-content.mjs';
import { esc, jsonLd, headTags, renderPage } from './vite-plugin-blog.mjs';

const VIRTUAL_ID = 'virtual:locality-guides';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const REQUIRED = ['name', 'title', 'description', 'updated', 'zone', 'tagline', 'lat', 'lng'];

const ZONES = {
  west: { label: 'West Pune', blurb: 'The IT corridor around Hinjawadi, Baner and Aundh, and settled Kothrud.' },
  east: { label: 'East Pune', blurb: 'Offices and malls along Nagar Road and Solapur Road, near the airport.' },
};

const hubCopy = (count) => ({
  title: 'Pune locality guides: where to rent or buy | Draazy',
  description: `Guides to ${count} popular Pune localities, from Hinjawadi and Baner in the west to Kharadi and Viman Nagar in the east: who each suits and what to check.`,
  heading: 'Find your part of Pune',
  intro: "Who each area suits, how you'll get around and what to check before you rent or buy.",
});

function compileGuides(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const { data, body } = parseFrontmatter(readFileSync(join(dir, file), 'utf-8'));
      const problems = [
        ...REQUIRED.filter((k) => !data[k]).map((k) => `missing "${k}"`),
        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && 'file name must be the locality slug',
        data.updated && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.updated)) && 'updated must be YYYY-MM-DD',
        data.zone && !ZONES[data.zone] && `zone must be one of ${Object.keys(ZONES).join(', ')}`,
        data.lat && !(Math.abs(Number(data.lat) - 18.55) < 0.3) && 'lat must be a Pune latitude',
        data.lng && !(Math.abs(Number(data.lng) - 73.85) < 0.3) && 'lng must be a Pune longitude',
      ].filter(Boolean);
      if (problems.length) throw new Error(`[localities] ${file}: ${problems.join('; ')}`);

      const title = String(data.title);
      const description = String(data.description);
      if (title.length > 60) console.warn(`[localities] ${file}: title is ${title.length} chars; search results show about 60`);
      if (description.length > 160) console.warn(`[localities] ${file}: description is ${description.length} chars; search results show about 160`);

      return {
        slug,
        name: String(data.name),
        title,
        seoTitle: title.length <= 51 ? `${title} | Draazy` : title,
        description,
        updated: String(data.updated),
        zone: String(data.zone),
        tagline: String(data.tagline),
        lat: Number(data.lat),
        lng: Number(data.lng),
        html: createRenderer([]).parse(body.trim()),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function guidePage(shell, guide, guides, siteUrl) {
  const url = `${siteUrl}/locality/${guide.slug}`;
  const others = guides.filter((g) => g.slug !== guide.slug);
  const head = headTags({
    title: guide.seoTitle,
    description: guide.description,
    url,
    image: `${siteUrl}/og-image.jpg`,
    type: 'article',
    extra: [jsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Place',
          name: `${guide.name}, Pune`,
          description: guide.description,
          url,
          geo: { '@type': 'GeoCoordinates', latitude: guide.lat, longitude: guide.lng },
          address: { '@type': 'PostalAddress', addressLocality: guide.name, addressRegion: 'Maharashtra', addressCountry: 'IN' },
          containedInPlace: { '@type': 'City', name: 'Pune' },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
            { '@type': 'ListItem', position: 2, name: 'Localities', item: `${siteUrl}/locality` },
            { '@type': 'ListItem', position: 3, name: guide.name, item: url },
          ],
        },
      ],
    })],
  });
  const body = `<main class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
<nav aria-label="Breadcrumb" class="mb-4 text-xs text-gray-500"><a href="/">Home</a> › <a href="/locality">Localities</a> › ${esc(guide.name)}</nav>
<article>
<p class="text-[11px] font-semibold uppercase tracking-widest text-teal-300">Pune locality guide</p>
<h1 class="mt-2 text-[1.65rem] font-extrabold leading-tight text-white sm:text-4xl">${esc(guide.name)}</h1>
<p class="mt-3 text-base leading-relaxed text-gray-400">${esc(guide.description)}</p>
<p class="mt-4"><a href="/listings?loc=${guide.slug}">See homes in ${esc(guide.name)}</a></p>
<div class="doc-prose mt-7">${guide.html}</div>
</article>
${others.length ? `<nav aria-label="Other Pune localities" class="mt-12"><h2 class="text-lg font-bold text-white">Other Pune localities</h2><ul>${others.map((g) => `<li><a href="/locality/${g.slug}">${esc(g.name)}</a></li>`).join('')}</ul></nav>` : ''}
</main>`;
  return renderPage(shell, head, body);
}

function hubPage(shell, guides, siteUrl) {
  const url = `${siteUrl}/locality`;
  const copy = hubCopy(guides.length);
  const head = headTags({
    title: copy.title,
    description: copy.description,
    url,
    image: `${siteUrl}/og-image.jpg`,
    type: 'website',
    extra: [jsonLd({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: copy.heading,
      description: copy.description,
      url,
      inLanguage: 'en-IN',
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: guides.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: `${g.name}, Pune`, url: `${siteUrl}/locality/${g.slug}` })),
      },
    })],
  });
  const zones = Object.entries(ZONES).map(([id, zone]) => {
    const inZone = guides.filter((g) => g.zone === id);
    return `<section class="mt-10"><h2 class="text-xl font-bold text-white">${esc(zone.label)}</h2><p class="mt-1 text-sm text-gray-400">${esc(zone.blurb)}</p><ul class="mt-4">${inZone.map((g) => `<li class="mt-4"><h3 class="text-base font-bold text-white"><a href="/locality/${g.slug}">${esc(g.name)}</a></h3><p class="mt-1 text-sm text-gray-400">${esc(g.tagline)}</p></li>`).join('')}</ul></section>`;
  });
  const body = `<main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-12">
<p class="text-[11px] font-semibold uppercase tracking-widest text-teal-300">Pune locality guides</p>
<h1 class="mt-3 text-[1.85rem] font-extrabold leading-tight text-white sm:text-5xl">${esc(copy.heading)}</h1>
<p class="mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-400 sm:text-lg">${esc(copy.intro)}</p>
${zones.join('\n')}
</main>`;
  return renderPage(shell, head, body);
}

/** @param {{ root?: string, siteUrl?: string }} [options] */
export default function localityGuidesPlugin(options = {}) {
  const root = options.root || process.cwd();
  const siteUrl = (options.siteUrl || 'https://draazy.com').replace(/\/$/, '');
  const contentDir = join(root, 'src/content/localities');
  let outDir = join(root, 'dist');

  return {
    name: 'vite-plugin-locality-guides',
    configResolved(config) {
      outDir = resolve(root, config.build?.outDir || 'dist');
    },
    configureServer(server) {
      server.watcher.on('all', (_event, file) => {
        if (!file.replace(/\\/g, '/').includes('/src/content/localities/')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const guides = compileGuides(contentDir);
      return `export const guides = ${JSON.stringify(guides)};\n`
        + `export const zones = ${JSON.stringify(ZONES)};\n`
        + `export const hub = ${JSON.stringify(hubCopy(guides.length))};\n`;
    },
    writeBundle() {
      const shellFile = join(outDir, 'index.html');
      if (!existsSync(shellFile)) return;
      const shell = readFileSync(shellFile, 'utf-8');
      const guides = compileGuides(contentDir);

      mkdirSync(join(outDir, 'locality'), { recursive: true });
      writeFileSync(join(outDir, 'locality.html'), hubPage(shell, guides, siteUrl), 'utf-8');
      for (const guide of guides) {
        writeFileSync(join(outDir, 'locality', `${guide.slug}.html`), guidePage(shell, guide, guides, siteUrl), 'utf-8');
      }

      const sitemap = join(outDir, 'sitemap.xml');
      if (!existsSync(sitemap)) return;
      const xml = readFileSync(sitemap, 'utf-8');
      if (xml.includes('/locality/')) return;
      const latest = guides.map((g) => g.updated).sort().at(-1);
      const urls = [
        `  <url><loc>${siteUrl}/locality</loc><lastmod>${latest}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
        ...guides.map((g) => `  <url><loc>${siteUrl}/locality/${g.slug}</loc><lastmod>${g.updated}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
      ];
      writeFileSync(sitemap, xml.replace('</urlset>', `${urls.join('\n')}\n</urlset>`), 'utf-8');
    },
  };
}
