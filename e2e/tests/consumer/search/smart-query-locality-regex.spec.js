import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Locality names like `N.I.B.M.` and `Kharadi (Bypass)` must not be compiled as RegExp: a lone `(` throws in the
   keystroke handler. The registry is stubbed so a green run does not depend on live data containing one. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* `.` would match the `x` in "xibm"; the parenthesis is the one that throws. Both are realistic —
   an abbreviation and a bracketed qualifier are how Indian localities are actually written. */
const REGISTRY = [
  { slug: 'nibm-road', name: 'N.I.B.M. Road', city: 'Pune' },
  { slug: 'kharadi-bypass', name: 'Kharadi (Bypass)', city: 'Pune' },
  { slug: 'baner', name: 'Baner', city: 'Pune' },
];

test('a locality name with regex punctuation is matched as text, not compiled as a pattern', async ({ page }) => {
  // Scoped to the API path: a looser glob also fulfils source-module requests with JSON, which blanks the whole app.
  await page.route('**/api/localities', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(REGISTRY),
  }));

  const thrown = trackErrors(page);

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings?deal=buy`);

  const field = page.locator('.lst-search-field').first();
  await expect(field).toBeVisible({ timeout: 15000 });
  await field.fill('2 bhk in kharadi');
  await page.getByRole('button', { name: 'Smart search' }).first().click();

  /* The chip is the evidence the query resolved: an uncaught SyntaxError leaves the bar looking
     idle, which is indistinguishable from "nothing matched" without this. */
  await expect(page.locator('.af-chip', { hasText: /Kharadi/i }).first()).toBeVisible({ timeout: 10000 });
  expect(thrown, thrown.join('\n')).toEqual([]);

  // `N.I.B.M.` unescaped is `N?I?B?M?` — it must not claim a query that merely looks alike.
  await field.fill('2 bhk in nxixbxm road');
  await page.getByRole('button', { name: 'Smart search' }).first().click();
  await expect(page.locator('.af-chip', { hasText: /N\.I\.B\.M\./i })).toHaveCount(0);
  expect(thrown, thrown.join('\n')).toEqual([]);
});
