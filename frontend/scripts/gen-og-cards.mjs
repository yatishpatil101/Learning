/* Run by hand and commit the JPEGs: Cloudflare's Pages build has no Playwright browser, so this cannot run in CI;
   it borrows Chromium from the e2e install (cd e2e; npm ci; npx playwright install chromium). */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './vite-plugin-help-content.mjs';
import { TOPICS } from './vite-plugin-blog.mjs';
import { esc } from './seo-html.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const MAX_BYTES = 60 * 1024;
const { chromium } = createRequire(import.meta.url)(join(root, '../e2e/node_modules/playwright-core'));

const b64 = (file) => readFileSync(join(root, 'public', file)).toString('base64');
const fontFace = (file, range) => `@font-face{font-family:Outfit;font-weight:800;src:url(data:font/woff2;base64,${b64(file)}) format('woff2');unicode-range:${range}}`;
const CSS = `
${fontFace('fonts/outfit-800-1.woff2', 'U+0100-02BA,U+20A0-20C0')}
${fontFace('fonts/outfit-800-2.woff2', 'U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2212')}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;position:relative;overflow:hidden;background:#0f0f1a;font-family:Outfit,sans-serif;font-weight:800;color:#f4f4f8}
.glow{position:absolute;right:-160px;top:-60px;width:760px;height:760px;background:radial-gradient(circle,rgba(20,184,166,.16),transparent 62%)}
.mark{position:absolute;right:90px;top:190px;width:250px;height:250px}
.brand{position:absolute;left:85px;top:84px;font-size:36px}
.label{position:absolute;left:85px;top:196px;font-size:24px;letter-spacing:.16em;text-transform:uppercase;color:#2dd4bf}
.title{position:absolute;left:85px;top:244px;width:720px;line-height:1.08;text-wrap:balance}
.url{position:absolute;left:85px;bottom:70px;font-size:28px;color:#2dd4bf}`;

const readPages = (dir, pick) => (existsSync(dir) ? readdirSync(dir) : [])
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ slug: f.slice(0, -3), data: parseFrontmatter(readFileSync(join(dir, f), 'utf-8')).data }))
  .map(pick)
  .filter(Boolean);

const wanted = {
  blog: readPages(join(root, 'src/content/blog'), ({ slug, data }) => (data.draft === true ? null : { slug, label: TOPICS[data.topic] || 'Guide', title: String(data.title) })),
  locality: readPages(join(root, 'src/content/localities'), ({ slug, data }) => ({ slug, label: 'Locality guide', title: String(data.title) })),
};

const html = ({ label, title }) => {
  const size = title.length <= 36 ? 76 : title.length <= 50 ? 64 : 52;
  return `<!doctype html><style>${CSS}</style><body><div class="glow"></div>
<img class="mark" src="data:image/png;base64,${b64('icon-512.png')}" alt="">
<div class="brand">Draazy</div><div class="label">${esc(label)}</div>
<div class="title" style="font-size:${size}px">${esc(title)}</div><div class="url">draazy.com</div></body>`;
};

async function shoot(page, card) {
  await page.setContent(html(card));
  await page.evaluate(() => document.fonts.ready);
  for (const quality of [82, 72, 62, 52, 42]) {
    const jpeg = await page.screenshot({ type: 'jpeg', quality });
    if (jpeg.length <= MAX_BYTES) return jpeg;
  }
  throw new Error(`[og] ${card.title}: could not get the card under ${MAX_BYTES / 1024} KB`);
}

const todo = [];
for (const [kind, cards] of Object.entries(wanted)) {
  const dir = join(root, 'public/og', kind);
  mkdirSync(dir, { recursive: true });
  const slugs = new Set(cards.map((c) => c.slug));
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.jpg') && !slugs.has(f.slice(0, -4))) { rmSync(join(dir, f)); console.log(`removed og/${kind}/${f}`); }
  }
  for (const card of cards) {
    const file = join(dir, `${card.slug}.jpg`);
    if (force || !existsSync(file)) todo.push({ ...card, file, name: `og/${kind}/${card.slug}.jpg` });
  }
}

if (todo.length) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    for (const card of todo) {
      const jpeg = await shoot(page, card);
      writeFileSync(card.file, jpeg);
      console.log(`${card.name} ${(jpeg.length / 1024).toFixed(1)} KB`);
    }
  } finally {
    await browser.close();
  }
}
console.log(`og cards: ${todo.length} drawn`);
