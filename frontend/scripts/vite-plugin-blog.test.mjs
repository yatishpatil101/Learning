import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import blogPlugin from './vite-plugin-blog.mjs';

const root = mkdtempSync(join(tmpdir(), 'dz-blog-'));
try {
  mkdirSync(join(root, 'src/content/blog'), { recursive: true });
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), `<!doctype html><html><head>
    <title>Shell</title>
    <meta name="description" content="shell" />
    <meta property="og:title" content="shell" />
    <meta name="twitter:card" content="summary_large_image" />
  </head><body><div id="root"></div></body></html>`);
  writeFileSync(join(root, 'dist/sitemap.xml'), '<urlset>\n</urlset>');
  writeFileSync(join(root, 'src/content/blog/first-post.md'), `---
title: First "post" </script>
description: About renting in Pune.
published: 2026-10-01
updated: 2026-10-05
topic: renting
---
## Heading
Body with a [link](javascript:alert(1)) costing $' and $&.`);
  writeFileSync(join(root, 'src/content/blog/rent-report.md'), `---
title: Rent report
description: Rents by area.
published: 2026-10-03
topic: renting
dataset: /data/rent-report.csv
period: 2026-Q4
license: https://creativecommons.org/licenses/by/4.0/
---
## Table
| Area | Rent |
| --- | --- |
| Baner | 30000 |`);
  mkdirSync(join(root, 'public/og/blog'), { recursive: true });
  writeFileSync(join(root, 'public/og/blog/first-post.jpg'), 'x');
  writeFileSync(join(root, 'src/content/blog/later-draft.md'), '---\ntitle: Draft\ndescription: d\npublished: 2026-10-08\ntopic: buying\ndraft: true\n---\nx');

  const plugin = blogPlugin({ root });
  plugin.configResolved({ command: 'build', build: { outDir: 'dist' } });
  plugin.writeBundle();

  const post = readFileSync(join(root, 'dist/blog/first-post.html'), 'utf-8');
  assert.equal(post.match(/<title[ >]/g).length, 1, 'shell title replaced, not duplicated');
  assert.equal(post.match(/name="description"/g).length, 1);
  assert.equal(post.match(/og:title/g).length, 1);
  assert.match(post, /<title data-shell="Shell">First &quot;post&quot; &lt;\/script&gt; \| Draazy<\/title>/);
  assert.match(post, /<link data-shell="" rel="canonical" href="https:\/\/draazy.com\/blog\/first-post" \/>/);
  assert.match(post, /"@type":"BlogPosting"/);
  assert.match(post, /"author":\{"@type":"Organization","name":"Draazy Editorial Team","url":"https:\/\/draazy.com\/about"/);
  assert.match(post, /"publisher":\{"@type":"Organization","@id":"https:\/\/draazy.com\/#organization"/);
  assert.match(post, /"datePublished":"2026-10-01","dateModified":"2026-10-05"/);
  assert.match(post, /By <a href="\/about">Draazy Editorial Team<\/a> · Updated <time datetime="2026-10-05">5 October 2026<\/time>/);
  assert.match(post, /og:image" content="https:\/\/draazy.com\/og\/blog\/first-post.jpg"/, 'uses the generated card');
  assert.match(post, /og:image:width" content="1200"[\s\S]*og:image:height" content="630"[\s\S]*og:image:alt" content="First &quot;post&quot;/);
  assert.match(post, /twitter:image" content="https:\/\/draazy.com\/og\/blog\/first-post.jpg"/);
  assert.ok(!post.includes('"@type":"Dataset"'), 'no dataset without frontmatter');
  assert.ok(!post.includes('Download the data'));

  const report = readFileSync(join(root, 'dist/blog/rent-report.html'), 'utf-8');
  assert.match(report, /og:image" content="https:\/\/draazy.com\/og-image.jpg"/, 'falls back to the site default');
  assert.match(report, /"datePublished":"2026-10-03","dateModified":"2026-10-03"/, 'dateModified falls back to published');
  assert.match(report, /"@type":"Dataset","name":"Rent report"/);
  assert.match(report, /"temporalCoverage":"2026-Q4","license":"https:\/\/creativecommons.org\/licenses\/by\/4.0\/"/);
  assert.match(report, /"distribution":\{"@type":"DataDownload","encodingFormat":"text\/csv","contentUrl":"https:\/\/draazy.com\/data\/rent-report.csv"\}/);
  assert.match(report, /"isAccessibleForFree":true/);
  assert.match(report, /<a href="\/data\/rent-report.csv" download>Download the data \(CSV\)<\/a>/);
  assert.match(report, /<table>[\s\S]*<td>Baner<\/td>/, 'GFM tables render');
  assert.ok(!/"headline":"[^"]*<\/script>/.test(post), 'JSON-LD cannot close its script tag');
  assert.match(post, /<div id="root"><main[\s\S]*<h2 id="heading">Heading<\/h2>/);
  assert.match(post, /<a href="#">link<\/a>/, 'unsafe link neutralised');
  assert.ok(post.includes('costing $&#39; and $&amp;.'), '$ in post text is not a replacement pattern');
  assert.match(post, /<title data-shell="Shell">/);
  assert.match(post, /<meta data-shell="shell" name="description"/);
  assert.match(post, /<link data-shell="" rel="canonical"/);
  assert.ok(!existsSync(join(root, 'dist/blog/later-draft.html')), 'drafts are not published');

  const index = readFileSync(join(root, 'dist/blog.html'), 'utf-8');
  assert.match(index, /href="\/blog\/first-post"/);
  assert.match(index, /"@type":"Blog"/);

  const sitemap = readFileSync(join(root, 'dist/sitemap.xml'), 'utf-8');
  assert.match(sitemap, /<loc>https:\/\/draazy.com\/blog<\/loc><lastmod>2026-10-05<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/draazy.com\/blog\/first-post<\/loc><lastmod>2026-10-05<\/lastmod>/);
  assert.ok(!sitemap.includes('later-draft'));
  plugin.writeBundle();
  assert.equal(readFileSync(join(root, 'dist/sitemap.xml'), 'utf-8').match(/\/blog<\/loc>/g).length, 1, 'sitemap injection is idempotent');

  writeFileSync(join(root, 'src/content/blog/Bad_Name.md'), '---\ntitle: t\ntopic: gossip\n---\nx');
  assert.throws(() => plugin.writeBundle(), /Bad_Name\.md: missing "description"; missing "published"; file name.*; topic must be one of/);

  console.log('vite-plugin-blog: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
