import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import localityGuidesPlugin from './vite-plugin-locality-guides.mjs';

const root = mkdtempSync(join(tmpdir(), 'dz-loc-'));
try {
  mkdirSync(join(root, 'src/content/localities'), { recursive: true });
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), `<!doctype html><html><head>
    <title>Shell</title>
    <meta name="description" content="shell" />
  </head><body><div id="root"></div></body></html>`);
  writeFileSync(join(root, 'dist/sitemap.xml'), '<urlset>\n</urlset>');
  const extra = (zone) => `zone: ${zone}\ntagline: A line.\nlat: 18.55\nlng: 73.78\n`;
  writeFileSync(join(root, 'src/content/localities/baner.md'), `---\nname: Baner\ntitle: Living in Baner\ndescription: About Baner.\nupdated: 2026-10-09\n${extra('west')}---\n## Who it suits\nFamilies.`);
  writeFileSync(join(root, 'src/content/localities/wakad.md'), `---\nname: Wakad\ntitle: Living in Wakad\ndescription: About Wakad.\nupdated: 2026-10-08\n${extra('west')}---\nx`);

  const plugin = localityGuidesPlugin({ root });
  plugin.configResolved({ build: { outDir: 'dist' } });
  plugin.writeBundle();

  const page = readFileSync(join(root, 'dist/locality/baner.html'), 'utf-8');
  assert.match(page, /<title data-shell="Shell">Living in Baner \| Draazy<\/title>/);
  assert.match(page, /<link data-shell="" rel="canonical" href="https:\/\/draazy.com\/locality\/baner" \/>/);
  assert.ok(!page.includes('name="robots"'), 'a guide page is indexable');
  assert.match(page, /"@type":"Place"/);
  assert.match(page, /<h2 id="who-it-suits">Who it suits<\/h2>/);
  assert.match(page, /href="\/locality\/wakad"/, 'links to the other guides');
  assert.match(page, /"geo":\{"@type":"GeoCoordinates","latitude":18.55,"longitude":73.78\}/);

  const hub = readFileSync(join(root, 'dist/locality.html'), 'utf-8');
  assert.match(hub, /<link data-shell="" rel="canonical" href="https:\/\/draazy.com\/locality" \/>/);
  assert.match(hub, /"@type":"ItemList"/);
  assert.match(hub, /<h2[^>]*>West Pune<\/h2>[\s\S]*href="\/locality\/baner"[\s\S]*href="\/locality\/wakad"/);

  const sitemap = readFileSync(join(root, 'dist/sitemap.xml'), 'utf-8');
  assert.match(sitemap, /<loc>https:\/\/draazy.com\/locality<\/loc><lastmod>2026-10-09<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/draazy.com\/locality\/baner<\/loc><lastmod>2026-10-09<\/lastmod>/);
  plugin.writeBundle();
  assert.equal(readFileSync(join(root, 'dist/sitemap.xml'), 'utf-8').match(/\/locality\/baner</g).length, 1, 'sitemap injection is idempotent');

  writeFileSync(join(root, 'src/content/localities/Bad.md'), '---\nname: Bad\nzone: north\nlat: 19.9\n---\nx');
  assert.throws(() => plugin.writeBundle(), /Bad\.md: missing "title"; missing "description"; missing "updated"; missing "tagline"; missing "lng"; file name.*; zone must be one of west, east; lat must be a Pune latitude/);

  console.log('vite-plugin-locality-guides: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
