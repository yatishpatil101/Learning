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
