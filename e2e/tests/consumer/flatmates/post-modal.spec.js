import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* "Post your flatmate request" modal redesign:
   - Preferred localities & Lifestyle are now themed dropdowns (pn-dropdown), not chip rows.
   - Two new matching selects exist: "Looking to share with" and "Room preference".
   - Picking a locality via the dropdown and submitting posts the request. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9811122233';

async function seedUser(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Share Tester', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

test('post modal shows dropdowns for localities/lifestyle and the new P0 selects', async ({ page }) => {
  const errors = trackErrors(page);

  await seedUser(page);
  await page.goto(`${BASE}/flatmates?post=1`);

  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });

  // Localities is a dropdown trigger (aria-label), not a row of chips.
  const locTrigger = page.getByRole('button', { name: 'Preferred localities' });
  await expect(locTrigger).toBeVisible();

  // New P0 fields are present.
  await expect(page.getByText('Looking to share with')).toBeVisible();
  await expect(page.getByText('Room preference')).toBeVisible();

  // Lifestyle dropdown trigger is present.
  await expect(page.getByRole('button', { name: 'Lifestyle preferences' })).toBeVisible();

  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('picking a locality via the dropdown and submitting posts the request', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?post=1`);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });

  // Budget (required).
  await page.locator('input[placeholder="₹ e.g. 15000"]').fill('16000');

  // Open the localities dropdown and pick Baner.
  await page.getByRole('button', { name: 'Preferred localities' }).click();
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();
  await page.keyboard.press('Escape');

  // The trigger now summarises the pick.
  await expect(page.getByRole('button', { name: 'Preferred localities' })).toContainText('Baner');

  // Submit.
  await page.getByRole('button', { name: /Post request/i }).click();

  /* The own-request banner appears with our pick — on the **Team up** tab, which is where a
     request for people belongs. The page opens on "Move in now" and posting does not switch tabs,
     so this navigates rather than waiting where the old single-list page put it. The banner reads
     "in review", not "live": D72 holds a new post until a moderator approves it. What this test
     protects is the dropdown-to-submit path, so the state it lands in is the honest assertion. */
  await page.getByRole('button', { name: /Team up —/i }).click();
  await expect(page.getByText(/in review/i).first()).toBeVisible({ timeout: 10000 });
});
