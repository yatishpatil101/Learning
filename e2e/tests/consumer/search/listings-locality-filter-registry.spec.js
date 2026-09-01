import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Listings "Localities" filter — canonical-registry search.

   Regression guard for the bug where the filter's Localities search only knew
   the ~15 listing-derived seed localities, so typing any other Pune locality
   (e.g. "Kalyani Nagar", "Wagholi") returned "No matches". The fix merges the
   full canonical registry (src/data/localities.js, 37 curated + community) into
   the filter options — searchable offline in list view, no Maps SDK required —
   and layers live Google Places suggestions on top via asyncSearch. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');

test('registry-only localities are searchable and selectable in the filter', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor();

  const group = filters(page).locator('.filter-group:has(h4:has-text("Localities"))').first();
  await group.locator('.pn-dropdown__trigger').first().click();
  await expect(page.locator('.pn-dropdown__menu--portal')).toBeVisible();

  // "Kalyani Nagar" is in the canonical registry but NOT in the seed collection
  // — before the fix this yielded "No matches".
  await page.locator('.pn-dropdown__menu--portal input').first().fill('Kalyani');
  const option = page.locator('.pn-dropdown__menu--portal [role="option"]', { hasText: 'Kalyani Nagar' }).first();
  await expect(option).toBeVisible();
  await option.click();

  // Selection applies; the chip shows the friendly name (not a raw slug).
  await expect(group.locator('.pn-dropdown__trigger')).toContainText('Kalyani Nagar');
  await expect(page.locator('.af-chip', { hasText: 'Kalyani Nagar' }).first()).toBeVisible();

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant).toEqual([]);
});
