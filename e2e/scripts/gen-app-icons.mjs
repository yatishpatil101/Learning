#!/usr/bin/env node
/**
 * gen-app-icons.mjs — rasterise the Draazy mark into the PWA PNG icons.
 *
 * Lives here (not frontend/scripts) because it needs Playwright's bundled
 * Chromium to rasterise, and Playwright is only installed in e2e/. There is no
 * `sharp` in the tree and this runs about twice a year, so adding an image
 * dependency to the frontend for it would be the wrong trade.
 *
 * The path below MUST stay identical to src/components/brand/LogoMark.jsx and
 * the inline favicon in index.html. Three copies is the cost of not shipping a
 * build step for a single 200-byte path.
 *
 * Usage:  cd e2e && node scripts/gen-app-icons.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public');

/* Geometry mirrors src/components/brand/LogoMark.jsx. PROFILE is the outlined
   rounded-D — outer contour plus counter in one path, knocked out by evenodd, so
   the ink tile shows through the counter and no mask is needed. DOOR is the panel
   floating inside it, drawn inset and stroked with a round join to round its
   corners (see the component for why). */
const PROFILE =
  'M17 8 H32 A24 24 0 0 1 32 56 H17 A5 5 0 0 1 12 51 V13 A5 5 0 0 1 17 8 Z '
  + 'M17.5 12.5 H32 A19.5 19.5 0 0 1 32 51.5 H17.5 A1 1 0 0 1 16.5 50.5 V13.5 A1 1 0 0 1 17.5 12.5 Z';
const DOOR = 'M23.2 19.45 L30.7 23.17 V40.83 L23.2 44.55 Z';
const DOOR_ROUND = 4;
/* Art bounding box, NOT 0..64 — the mark is 44x48 inside the grid. Centring off
   0..64 would push it right and down by a couple of units at every size. */
const ART = { x0: 12, y0: 8, x1: 56, y1: 56 };
const INK = '#0f0d1a';
const TEAL = '#14b8a6';

/* `scale` is the art HEIGHT as a share of the tile. 0.62 leaves the optical
   padding a rounded-square launcher icon needs; the earlier 0.72 was measured
   against a 0..64 box rather than the art's real 44x48, so the mark rendered
   almost edge to edge. The maskable icon drops to 0.46: Android crops maskable
   icons to arbitrary shapes and only guarantees the centre 80% circle, so
   anything larger risks losing the door aperture on a circular launcher. */
const ICONS = [
  { file: 'icon-192.png', size: 192, radius: 0.22, scale: 0.62 },
  { file: 'icon-512.png', size: 512, radius: 0.22, scale: 0.62 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, scale: 0.46 },
];

const svg = ({ size, radius, scale }) => {
  // Fit the art's HEIGHT to `scale` of the tile, then centre both axes on the
  // art's midpoint so the optical padding is even.
  const k = (scale * 64) / (ART.y1 - ART.y0);
  const tx = 32 - (k * (ART.x0 + ART.x1)) / 2;
  const ty = 32 - (k * (ART.y0 + ART.y1)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="${64 * radius}" fill="${INK}"/>
    <g transform="translate(${tx} ${ty}) scale(${k})">
      <path fill="${TEAL}" fill-rule="evenodd" d="${PROFILE}"/>
      <path fill="${TEAL}" stroke="${TEAL}" stroke-width="${DOOR_ROUND}" stroke-linejoin="round" d="${DOOR}"/>
    </g>
  </svg>`;
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();

for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block}</style>${svg(icon)}`,
  );
  await page.locator('svg').screenshot({ path: join(OUT, icon.file), omitBackground: true });
  console.log(`✔ ${icon.file}  ${icon.size}x${icon.size}`);
}

await browser.close();
