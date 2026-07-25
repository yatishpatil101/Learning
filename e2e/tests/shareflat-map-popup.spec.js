import { test, expect } from '@playwright/test';

/* Share-flat "Map view" popup. Clicking a locality bubble no longer shows a bare
   count — it previews the actual posts there (up to 3), each as an actionable row:
   identity + budget/meta, a verified tick, a primary action (Express interest /
   Message / Request-Join), a Save toggle, and a clickable body that opens the full
   post. A footer opens the whole locality in the list.

   There is no detail route for share-flat posts, so "view details / go to posting"
   switches to the list, narrows to that locality, and scrolls to + flashes the card
   (data-sf-id anchor). These tests guard that functional wiring. */

const openMap = async (page, url) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'Map' }).click();
  // Map view now opens on the "focus your map" gate — pick the first area to
  // unlock the bubble map (mirrors the Listings map gate).
  await page.locator('[data-sf-area]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-sf-area]').first().click();
  await page.locator('.map-pin').first().waitFor({ timeout: 20000 });
  await page.locator('.map-pin').first().click();
  await page.locator('.pn-sp-row').first().waitFor({ timeout: 10000 });
};

test('flatmate bubble previews posts with interest, save and view-details actions', async ({ page }) => {
  await openMap(page, '/share-flat');

  // Actionable rows, not just a count.
  expect(await page.locator('.pn-sp-row').count()).toBeGreaterThan(0);
  await expect(page.locator('.pn-sp-cta').first()).toBeVisible();
  await expect(page.locator('.pn-sp-save').first()).toBeVisible();
  await expect(page.locator('.pn-sp-all')).toBeVisible();

  // Save toggles on.
  const save = page.locator('.pn-sp-save').first();
  await save.click();
  await expect(save).toHaveClass(/is-saved/);
});

test('clicking a post row opens it in the list and highlights the card', async ({ page }) => {
  await openMap(page, '/share-flat');
  await page.locator('.pn-sp-rowmain').first().click();

  // Switched to the list view: the anchored card is present and flashed.
  const card = page.locator('[data-sf-id]').first();
  await expect(card).toBeVisible();
  await expect(page.locator('.sf-flash')).toHaveCount(1);
  // Map is gone (we left map view).
  await expect(page.locator('.gm-style')).toHaveCount(0);
});

test('"open in list" footer switches to the list filtered to that locality', async ({ page }) => {
  await openMap(page, '/share-flat');
  await page.locator('.pn-sp-all').click();
  await expect(page.locator('.gm-style')).toHaveCount(0);
  await expect(page.locator('[data-sf-id]').first()).toBeVisible();
});

test('group bubble previews groups with a join/request action', async ({ page }) => {
  await openMap(page, '/share-flat?view=groups');
  await expect(page.locator('.pn-sp-row').first()).toBeVisible();
  // Group action reads Join or Request (never the flatmate "Interest").
  await expect(page.locator('.pn-sp-cta').first()).toHaveText(/Join|Request|Full/);
});
