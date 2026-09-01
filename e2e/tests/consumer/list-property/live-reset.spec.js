/**
 * The "Start over" control on the posting wizard, against the live backend.
 *
 * Converted from `reset.spec.js`. The draft this file reads and clears is `pnDraft:list-property`,
 * a genuine browser-side draft rather than a stand-in for the server, so it stays exactly as it
 * was — the wizard is meant to hold a half-finished form across a refresh without ever telling the
 * backend about it, and that is the claim.
 *
 * What the live run adds is the reload. "Start over" reloads the page, and the mock version
 * reloaded into a session it had written into localStorage itself, so "back into a fresh, still-
 * verified flow" was guaranteed by the fixture rather than tested. Here the reload re-authenticates
 * against the server, refetches entitlements, and has to land on the wizard again — if clearing the
 * draft ever took the session with it, or if the second load hit the listing-limit paywall, this
 * file is what notices.
 */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

// Register a real owner so the whole-place flow is shown. No Aadhaar badge — posting does not need one.
async function gotoFlow(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

test('Start over control is present on the step header', async ({ page }) => {
  await gotoFlow(page);
  await expect(page.getByText('Property details', { exact: true })).toBeVisible();
  await expect(page.locator('.lp-reset')).toBeVisible();
  await expect(page.locator('.lp-reset')).toHaveText(/Start over/);
});

test('Start over asks for confirmation and can be cancelled without losing data', async ({ page }) => {
  await gotoFlow(page);
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1050');

  // Open the confirmation.
  await page.locator('.lp-reset').click();
  await expect(page.getByText('Start over?', { exact: true })).toBeVisible();

  // Cancel — data stays intact.
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByText('Start over?', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1050');
});

test('Confirming Start over clears the form and the saved draft', async ({ page, consoleErrors }) => {
  await gotoFlow(page);

  await page.locator('input[data-err="carpetArea"]').fill('1050');
  /* The autosave is debounced, and the read below goes through `page.evaluate`, which does not
     retry -- so this wait is load-bearing. Polling the draft waits for the write itself rather than
     for a duration somebody timed the debounce at once. */
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('pnDraft:list-property')))
    .toContain('1050');
  const draftBefore = await page.evaluate(() => localStorage.getItem('pnDraft:list-property'));
  expect(draftBefore).toContain('1050');

  // Open confirm and commit the reset (triggers a full reload).
  await page.locator('.lp-reset').click();
  /* `exact` matters here: Playwright matches accessible names by substring by default, and the
     modal's close button is labelled "Close Start over?" — which contains "Start over". Two
     matches, and the one that would have been clicked is a coin toss. */
  await page.locator('.pn-modal-panel').getByRole('button', { name: 'Start over', exact: true }).click();

  // Page reloads back into a fresh, still-signed-in flow.
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('');

  // The entered data is gone: a later refresh will now yield a blank form,
  // never the old draft. (A fresh, blank draft may be re-persisted — that's
  // the expected "hold on refresh" behaviour — but it must not carry old data.)
  const draftAfter = await page.evaluate(() => localStorage.getItem('pnDraft:list-property'));
  expect(draftAfter ?? '').not.toContain('1050');
  expect(consoleErrors).toHaveLength(0);
});

test('Start over control is present on the Location step header', async ({ page }) => {
  await gotoFlow(page);
  // Advance to step 2.
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  /* The `if (await opt.count())` that used to guard this click is gone with the sleep that made it
     necessary: `count()` does not retry, so against a portalled menu still one frame from open
     (Select.jsx:178) it returned 0, the click was skipped, and the wizard carried its default type
     through a test that appeared to have chosen one. */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  await expect(page.getByText('Location & pricing', { exact: true })).toBeVisible();
  await expect(page.locator('.lp-reset')).toBeVisible();
});
