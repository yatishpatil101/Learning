import { chromium } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Throwaway visual check for the mark: renders it big on light and dark so the
   shape can be eyeballed against the reference. Delete once the mark is signed
   off — gen-app-icons.mjs is the durable script. */
const MASK = 'M25 20 L16 12 V52 L25 44';
const OUTER = 'M12 8 H32 A24 24 0 0 1 32 56 H12 Z M23 19 H32 A13 13 0 0 1 32 45 H23 Z';
const LEAF = 'M16 12 L25 20 V44 L16 52 Z';

const one = (id) => `
  <svg width="300" height="300" viewBox="0 0 64 64" style="color:#14b8a6">
    <mask id="m${id}">
      <rect width="64" height="64" fill="#fff"/>
      <path d="${MASK}" fill="none" stroke="#000" stroke-width="2.4"
            stroke-linecap="butt" stroke-linejoin="miter"/>
    </mask>
    <g fill="currentColor" mask="url(#m${id})">
      <path fill-rule="evenodd" d="${OUTER}"/>
      <path d="${LEAF}"/>
    </g>
  </svg>`;

const html = `<style>body{margin:0;display:flex}
  div{padding:40px}.l{background:#F7F8F7}.d{background:#0f0d1a}</style>
  <div class="l">${one(1)}</div><div class="d">${one(2)}</div>`;

const dir = mkdtempSync(join(tmpdir(), 'logo-'));
const out = join(dir, 'mark.png');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 380 } });
await page.setContent(html);
writeFileSync(join(dir, 'page.html'), html);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
