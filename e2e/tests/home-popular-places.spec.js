import { test, expect } from '@playwright/test';

/* Clicking a "Popular:" place chip on the home hero should route to the Listings
   page with that place applied as an ACTIVE locality filter (not just a hidden
   text query) — visible chip, checked sidebar checkbox, and filtered results. */

const BASE = 'http://localhost:5173';

test('clicking "Baner" routes to listings with Baner as an active locality filter', async ({ page }) => {
  await page.goto(`${BASE}/`);

  await page.getByRole('button', { name: 'Baner', exact: true }).click();

  // Routed to listings with the locality carried on the URL.
  await expect(page).toHaveURL(/\/listings\?deal=buy&loc=Baner/);

  // Shown as a removable "Active filters" chip (the Localities filter is now a
  // dropdown, so the chip is the presentation-agnostic source of truth).
  await expect(page.getByRole('button', { name: /Remove filter Baner/i })).toBeVisible();
});

test('a rent place ("Viman Nagar") carries the rent deal + locality filter', async ({ page }) => {
  await page.goto(`${BASE}/`);

  await page.getByRole('button', { name: 'Viman Nagar', exact: true }).click();

  await expect(page).toHaveURL(/\/listings\?deal=rent&loc=Viman(%20|\+)Nagar/);
  await expect(page.getByRole('button', { name: /Remove filter Viman Nagar/i })).toBeVisible();
});

test('results are actually filtered to the selected place', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Baner', exact: true }).click();

  await expect(page.getByRole('button', { name: /Remove filter Baner/i })).toBeVisible();
  // Every rendered property card names the selected locality.
  const cards = page.locator('a[href^="/property/"]');
  await cards.first().waitFor({ timeout: 10000 });
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(cards.nth(i)).toContainText(/Baner/i);
  }
});
