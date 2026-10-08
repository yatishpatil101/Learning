import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Featured rail cards open the property details page (/property/:id) directly, not the listings search. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Featured rail shows real properties, and a card opens its details page directly', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto(`${BASE}/`);

  // Section heading is present and visible (renders after an async fetch).
  await expect(page.getByRole('heading', { name: 'Featured properties' })).toBeVisible();

  // Cards are links straight to the property details page.
  const cards = page.locator('section a[href^="/property/"]');
  await cards.first().waitFor({ timeout: 10000 });
  expect(await cards.count()).toBeGreaterThan(0);

  // Tiles carry the verified symbol (icon only) — no "Featured"/"Verified" text tags.
  await expect(page.locator('section span[title="Verified"]').first()).toBeVisible();

  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);

  const firstCard = cards.first();
  const href = await firstCard.getAttribute('href');

  await firstCard.click();

  // We navigated to the details route (not /listings).
  await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(page).not.toHaveURL(/\/listings/);

  await expect(page.getByRole('button', { name: /contact owner/i }).first()).toBeVisible({ timeout: 10000 });
});
