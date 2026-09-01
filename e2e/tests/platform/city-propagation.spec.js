import { test, expect } from '@playwright/test';

/* City selection must propagate across the app. Pune has inventory + a locality registry;
   other cities can be toggled live in admin but have no data yet, so they must show an
   honest city-aware presentation and never leak Pune localities or listings.

   SCOPE, after the mock retirement (D256). Four of this file's six tests drove a *second*,
   no-inventory city by writing `live: true` into the `puneNestDB_v5` roster and firing
   `punenest-settings-change` — reaching past the app into the mock store to manufacture a
   city the seed does not contain. Precisely: the `puneNestDB_v5` key still exists (`boot.js`
   seeds it unconditionally, and will until `lib/mockApi.js`'s last two below-seam importers
   go), but nothing *reads* the roster out of it any more — `providers/mock/cityProvider.js`
   was the only reader and it is deleted. So the write still lands and changes nothing, which
   is the worse failure: the tests do not error, they assert about a city that never launches.
   There is no honest way to keep them in this lane either, since it runs with no backend at
   all and so cannot ask a real API to launch a city.

   What survives are the two assertions that never needed the mock: the default city renders
   its own inventory, and a coming-soon city is a waitlist prompt rather than a destination.
   Both are pure client-side city behaviour and pass on the seeded catalogue alone.

   The four propagation assertions are NOT retired as ideas — they belong in the live lane,
   where a city can actually be toggled through the admin API. Until they are ported there,
   cross-city leakage is uncovered; that gap is deliberate and recorded here rather than
   papered over by a test asserting against a store the app no longer reads. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Pune (has inventory) shows the full home experience', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
  await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
});

test('picking a "coming soon" city and cancelling leaves the shopper on their city', async ({ page }) => {
  await page.goto(`${BASE}/`);
  const pill = page.getByRole('button', { name: /^City: / }).first();
  await pill.click();
  await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: /Mumbai/ }).click();

  // A coming-soon city is a waitlist prompt, not a destination.
  const modal = page.getByRole('heading', { name: /Join the Mumbai waitlist/i });
  await expect(modal).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Cancel is a true no-op: no city switch, no waitlist banner, nothing persisted.
  await expect(modal).toHaveCount(0);
  await expect(pill).toHaveAttribute('aria-label', 'City: Pune');
  await expect(page.getByText(/isn't live in/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
  expect(await page.evaluate(() => localStorage.getItem('puneNestCity'))).not.toBe('Mumbai');
});
