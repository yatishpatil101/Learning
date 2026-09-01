import { test, expect } from '@playwright/test';

/* Pre-freeze fixes — mock-only keeper.
 *
 * ## Why this file survives the live conversion
 *
 * Of the five original prefreeze claims, four are now live-provable and live in
 * `live-group-join-and-layout.spec.js`. This one is not:
 *
 * **Saving a flatmate room stores a rich card so the Saved page renders a real title.**
 * Flatmate saves are localStorage-bound (`puneNestFlatmateSaved` in `useFlatmates.jsx`),
 * not backed by the API — the http saved provider (`/me/saved`) handles only property
 * listings. There is no server endpoint to read this save back from, so there is no
 * live assertion to make. The test stays here to pin the shape contract: the Saved page
 * must render the room's society title, not the raw storage key (`r:r1`).
 *
 * When `puneNestFlatmateSaved` migrates to the API (if it does), this test moves to the
 * live suite and this file is deleted.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9811122233';

async function seedUser(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Share Tester', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, mobile);
}

test('saving a room shows a real card on the Saved page and persists the bookmark', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=rooms`);
  const card = page.locator('.sf-card').first();
  await card.waitFor({ state: 'visible', timeout: 10000 });
  const society = (await card.locator('.drop-shadow').first().innerText()).trim();

  await card.locator('.save-btn').click();

  await page.goto(`${BASE}/saved`);
  await page.getByRole('button', { name: /Flatmates & Rooms/i }).click();

  // The saved room renders with its real society title + a "Room" badge — never the raw key.
  await expect(page.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/^r:/)).toHaveCount(0);

  // Returning to Flatmates, the bookmark is still filled (state hydrates from storage).
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await expect(page.locator('.sf-card').first().locator('.save-btn')).toHaveClass(/saved/, { timeout: 5000 });
});
