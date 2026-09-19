/* Not a spec: it asserts nothing and is wired into no project. Run `node property-shots.mjs <label>` against
   two checkouts, with a dev server on $SHOT_BASE, and diff the 390px PNGs by eye. */
import { chromium } from '@playwright/test';

const BASE = process.env.SHOT_BASE || 'http://localhost:5199';
const LABEL = process.argv[2] || 'after';
const SLUG = process.env.SHOT_SLUG || 'p5013'; // a buy — renders the EMI line and the EMI tile

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  baseURL: BASE,
});
const page = await ctx.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
  } catch { /* storage unavailable — the cookie bar just stays up */ }
});

await page.goto(`/property/${SLUG}`);
await page.locator('[role="tablist"]:has(.dz-detail-tab)').waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);

await page.screenshot({ path: `shots/${LABEL}-01-fold.png` });
await page.screenshot({ path: `shots/${LABEL}-02-full.png`, fullPage: true });

// The section carrying the title, not `.dz-ph-main` — that class only exists on the "after"
// side, and `section.fade-in` matches the gallery first.
const header = page.locator('section').filter({ has: page.locator('h1') }).first();
await header.screenshot({ path: `shots/${LABEL}-03-header.png` });

const tabs = page.locator('[role="tablist"]:has(.dz-detail-tab) [role="tab"]');
for (let index = 0; index < await tabs.count(); index += 1) {
  const tab = tabs.nth(index);
  const name = (await tab.innerText()).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await tab.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/${LABEL}-04-${name || index + 1}.png`, fullPage: true });
}

await browser.close();
