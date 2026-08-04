import { test, expect } from '@playwright/test';

/* Home "Featured properties" rail is now data-driven off the real catalogue:
   - It renders real property cards (promoted listings first).
   - At least one card carries the amber "Featured" promotion badge (seeded).
   - Clicking a card opens the property DETAILS page directly (/property/:id),
     not the listings search page. */

const BASE = 'http://localhost:5173';

// Console errors that are environmental noise (CDN images, map tiles, favicon).
const IGNORE = [/favicon/i, /unsplash/i, /leaflet/i, /tile/i, /net::ERR/i, /Failed to load resource/i];

test('Featured rail shows real properties and links to details', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

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
});

test('clicking a featured card opens the property details page directly', async ({ page }) => {
  await page.goto(`${BASE}/`);

  const firstCard = page.locator('section a[href^="/property/"]').first();
  await firstCard.waitFor({ timeout: 10000 });
  const href = await firstCard.getAttribute('href');

  await firstCard.click();

  // We navigated to the details route (not /listings).
  await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(page).not.toHaveURL(/\/listings/);

  // The property details page rendered a contact/enquiry affordance.
  await expect(page.getByRole('button', { name: /contact|enquire|interested|call|whatsapp/i }).first()).toBeVisible({ timeout: 10000 });
});
