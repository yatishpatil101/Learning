import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Property-detail in-context info tips:
   - Hovering an option tile/tag/row reveals a role="tooltip" popover with plain-language copy.
   - The trigger carries data-tip + tabIndex (a11y) and gains aria-describedby while open.
   - Works for SALE, RENT and COMMERCIAL; the tip dismisses on mouse-out.
   - No console errors introduced. */

const SALE_FLAT = 'p5013';      // 1 BHK Flat, Baner (buy)
const RENT_HOME = 'p5015';      // 4 BHK Row House, Wakad (rent, approved). The catalogue
                                // has no approved rent *Flat* - p5018 and p5030 are both
                                // rent Flats but both are `pending` on purpose (they are the
                                // outreach-console and concierge fixtures). Any approved
                                // rental exercises the same tiles, so this reads the one that
                                // is safe to read.
const COMMERCIAL = 'p5101';     // Office Space (buy)

function relevant(errors) {
  return errors.filter((e) => !/favicon|leaflet|tile|net::ERR|unsplash|maptiler|openstreetmap/i.test(e));
}

async function gotoProp(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function expectTip(page, locator, expectSub) {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded();
  await el.hover();
  const tip = page.locator('.pn-tip[role="tooltip"]');
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
  await expectTip(page, page.locator('text=Carpet Area'), 'usable');

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
  await expectTip(page, page.locator('.detail-card'));
  await expectTip(page, page.locator('.tag'));

  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});
