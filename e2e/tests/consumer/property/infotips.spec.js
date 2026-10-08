import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const SALE_FLAT = 'p5013';      // 1 BHK Flat, Baner (buy)
// No approved rent Flat is safe here; this approved rental exercises the same tip tiles.
const RENT_HOME = 'p5015';      // 4 BHK Row House, Wakad (rent, approved).
const COMMERCIAL = 'p5101';     // Office Space (buy)

function relevant(errors) {
  return errors.filter((e) => !/favicon|leaflet|tile|net::ERR|unsplash|maptiler|openstreetmap/i.test(e));
}

/* Seed consent and disable smooth scrolling because late reflow or animated hover scrolling closes
   fixed tips before Playwright can read them. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
    const noSmoothScroll = () => {
      const s = document.createElement('style');
      s.textContent = 'html { scroll-behavior: auto !important; }';
      document.head.appendChild(s);
    };
    if (document.head) noSmoothScroll();
    else document.addEventListener('DOMContentLoaded', noSmoothScroll);
  });
});

async function gotoProp(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function expectTip(page, locator, expectSub) {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded();
  await el.hover();
  const tip = page.locator('.dz-tip[role="tooltip"]');
  await expect(tip).toBeVisible({ timeout: 3000 });
  const txt = (await tip.innerText()).toLowerCase();
  if (expectSub) expect(txt, `tip copy for "${expectSub}"`).toContain(expectSub.toLowerCase());
  // aria-describedby is wired to the tooltip while it is shown
  await expect(page.locator('[data-tip][aria-describedby]').first()).toBeVisible();
  // dismisses on mouse-out
  await page.mouse.move(2, 2);
  await expect(tip).toBeHidden({ timeout: 3000 });
}

test('SALE: Key Details, tag, floor plan, price + location tiles reveal tips', async ({ page }) => {
  const errors = trackErrors(page);

  await gotoProp(page, SALE_FLAT);
  await expectTip(page, page.locator('.detail-card'), 'bhk');
  await expectTip(page, page.locator('.tag'));                       // status/trust tag
  /* The neutral Area row exists to say the basis is unstated, not to invent carpet/built-up splits
     from one figure. */
  await expectTip(page, page.locator('text=Area Breakdown').locator('..').getByText('Area', { exact: true }), 'not said whether');

  await page.getByRole('tab', { name: /Price Insights/i }).click();
  await expectTip(page, page.locator('text=Stamp duty'), 'tax');

  await page.getByRole('tab', { name: /Location/i }).click();
  await expectTip(page, page.locator('text=Commute to work'), 'drive time');

  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});

test('RENT: rent-detail tiles reveal deal-appropriate tips', async ({ page }) => {
  const errors = trackErrors(page);

  await gotoProp(page, RENT_HOME);
  await expectTip(page, page.locator('.detail-card'), 'bhk');

  await page.getByRole('tab', { name: /Rent Details/i }).click();
  await expectTip(page, page.locator('.detail-card').filter({ hasText: 'Deposit' }), 'refundable');
  await expectTip(page, page.locator('.detail-card').filter({ hasText: 'Lock-in' }), 'minimum time');

  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});

test('COMMERCIAL: Key Details + tag reveal tips', async ({ page }) => {
  const errors = trackErrors(page);

  await gotoProp(page, COMMERCIAL);
  await expectTip(page, page.locator('.detail-card'), 'square feet');
  await expectTip(page, page.locator('.tag'));

  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});
