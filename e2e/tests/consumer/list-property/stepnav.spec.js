/* No identity badge is granted: the wizard has no identity gate, and granting one here would
   quietly assert the opposite of what `live-no-gate` proves. */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';

async function gotoFlow(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

async function advanceToStep2(page) {
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  /* `count()` does not retry, so guarding this click on it silently skips the choice against a
     portalled menu one frame from open (Select.jsx:178). Wait for the menu instead. */
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

test('StepNav shows the four labelled phases of a whole-place post', async ({ page }) => {
  await gotoFlow(page);
  const items = page.locator('.lp-steps__item');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText('Details');
  await expect(items.nth(1)).toContainText('Location');
  await expect(items.nth(2)).toContainText('Price');
  await expect(items.nth(3)).toContainText('Photos');
  // On step 1, Details is the active (current) step.
  await expect(page.locator('.lp-steps__item.is-active')).toContainText('Details');
});

/* A flatmate host answers location and room price on one short screen, so the rail must show the
   three phases that track actually has rather than a fourth the host will never reach. */
test('a flatmate post keeps its three phases', async ({ page }) => {
  await gotoFlow(page);
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await page.locator('.radio-pill', { hasText: 'Find a flatmate' }).first().click();
  const items = page.locator('.lp-steps__item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toContainText('Location & Price');
});

test('completed steps are clickable and navigate back', async ({ page, consoleErrors }) => {
  await gotoFlow(page);
  await advanceToStep2(page);

  // Step 1 is now a completed, clickable button; Step 2 is active.
  const done = page.locator('.lp-steps__item.is-done');
  await expect(done).toContainText('Details');
  await expect(done).toHaveJSProperty('tagName', 'BUTTON');
  await expect(page.locator('.lp-steps__item.is-active')).toContainText('Location');

  // Clicking the completed step jumps back to Step 1 (form details shown again).
  await done.click();
  await expect(page.getByText('Property details', { exact: true })).toBeVisible();
  await expect(page.locator('.lp-steps__item.is-active')).toContainText('Details');
  expect(consoleErrors).toHaveLength(0);
});

test('upcoming steps are not interactive', async ({ page }) => {
  await gotoFlow(page);
  // Photos is a future step on load — rendered as a non-button div.
  const todo = page.locator('.lp-steps__item.is-todo', { hasText: 'Photos' });
  await expect(todo).toHaveJSProperty('tagName', 'DIV');
});
