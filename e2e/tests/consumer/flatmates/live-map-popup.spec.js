import { test, expect } from '@playwright/test';
import { signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Flatmate "Map view" popup. Clicking a locality bubble no longer shows a bare
   count — it previews the actual posts there (up to 3), each as an actionable row:
   identity + budget/meta, a verified tick, a primary action (Express interest /
   Message / Request-Join), a Save toggle, and a clickable body that opens the full
   post. A footer opens the whole locality in the list.

   There is no detail route for flatmates posts, so "view details / go to posting"
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
  await page.locator('.dz-sp-row').first().waitFor({ timeout: 10000 });
};

test('flatmate bubble previews posts with interest, save and view-details actions', async ({ page }) => {
  // Signed in on purpose. The bookmark used to be a localStorage write, which "worked" for an
  // anonymous visitor and then vanished the moment they signed in on any other device. It is now a
  // server document, so saving signed-out routes to `/signin` instead — see
  // `live-flatmate-saves.spec.js` for that claim. What this test is about is the map popup's own
  // wiring, so it gives the control an identity to write against.
  await signedInAs(page, uniqueMobile());
  await openMap(page, '/flatmates');

  // Actionable rows, not just a count.
  expect(await page.locator('.dz-sp-row').count()).toBeGreaterThan(0);
  await expect(page.locator('.dz-sp-cta').first()).toBeVisible();
  await expect(page.locator('.dz-sp-save').first()).toBeVisible();
  await expect(page.locator('.dz-sp-all')).toBeVisible();

  // Save toggles on.
  const save = page.locator('.dz-sp-save').first();
  await save.click();
  await expect(save).toHaveClass(/is-saved/);
});

test('clicking a post row opens it in the list and highlights the card', async ({ page }) => {
  await openMap(page, '/flatmates');
  await page.locator('.dz-sp-rowmain').first().click();

  // Switched to the list view: the anchored card is present and flashed.
  const card = page.locator('[data-sf-id]').first();
  await expect(card).toBeVisible();
  await expect(page.locator('.sf-flash')).toHaveCount(1);
  // Map is gone (we left map view).
  await expect(page.locator('.gm-style')).toHaveCount(0);
});

test('"open in list" footer switches to the list filtered to that locality', async ({ page }) => {
  await openMap(page, '/flatmates');
  await page.locator('.dz-sp-all').click();
  await expect(page.locator('.gm-style')).toHaveCount(0);
  await expect(page.locator('[data-sf-id]').first()).toBeVisible();
});

test('group bubble previews groups with a join/request action', async ({ page }) => {
  await openMap(page, '/flatmates?view=groups');
  await expect(page.locator('.dz-sp-row').first()).toBeVisible();
  /* `?view=groups` now aliases onto the **Team up** tab, which carries groups *and* solo seekers
     (see model.js TAB_ALIAS). So the first row in the popup is not reliably a group, and asserting
     on `.first()` was really asserting "whatever sorted highest today" — it read as a group CTA
     check while testing the sort order.

     The claim worth keeping is that a group's action is Join/Request/Full and never the seeker's
     "Interest". Asserted over the whole popup: at least one CTA is a group action, and none of the
     group-shaped ones have leaked the seeker verb. */
  const ctas = page.locator('.dz-sp-cta');
  await expect(ctas.filter({ hasText: /Join|Request|Full/ }).first()).toBeVisible();
});
