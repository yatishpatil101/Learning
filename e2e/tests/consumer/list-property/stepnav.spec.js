import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

// Seed an authenticated + Aadhaar-verified owner so the whole-place flow
// (with the segmented StepNav) is shown.
async function gotoFlow(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({
      verified: true, aadhaarMobile: mobile, at: Date.now(),
    }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-steps', { timeout: 10000 });
}

async function advanceToStep2(page) {
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
  await page.waitForSelector('.gm-style', { timeout: 20000 });
}

test('StepNav shows the three labelled phases', async ({ page }) => {
  await gotoFlow(page);
  const items = page.locator('.lp-steps__item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Details');
  await expect(items.nth(1)).toContainText('Location');
  await expect(items.nth(2)).toContainText('Photos');
  // On step 1, Details is the active (current) step.
  await expect(page.locator('.lp-steps__item.is-active')).toContainText('Details');
});

test('completed steps are clickable and navigate back', async ({ page }) => {
  const errors = trackErrors(page);
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
  expect(errors).toHaveLength(0);
});

test('upcoming steps are not interactive', async ({ page }) => {
  await gotoFlow(page);
  // Photos is a future step on load — rendered as a non-button div.
  const todo = page.locator('.lp-steps__item.is-todo', { hasText: 'Photos' });
  await expect(todo).toHaveJSProperty('tagName', 'DIV');
});
