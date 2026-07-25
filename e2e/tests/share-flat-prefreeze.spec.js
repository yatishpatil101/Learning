import { test, expect } from '@playwright/test';

/* Pre-freeze fixes for Share Flat (Rent):
   1. Joining / requesting a group must follow through like "Express interest":
      write a notification + a pending chat and flip the button to a done-state
      (it used to only fire a toast and dead-end). Signed-out users are routed to
      sign-in, matching the flatmate/room flows.
   2. Saving any share post must store a rich card so the Saved page renders a real
      title/price/preview instead of the bare storage key ("r:r1"). The bookmark
      state also persists across a reload.
   3. The hero is compact enough that at least one result card is within the first
      viewport on a laptop (inventory no longer sits entirely below the fold). */

const BASE = 'http://localhost:5173';
const MOBILE = '9811122233';

async function seedUser(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Share Tester', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, mobile);
}

test('joining a group flips to a done-state and creates a notification + pending chat', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedUser(page);
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  const joinBtn = page.getByRole('button', { name: /Join group|Request to join/i }).first();
  await joinBtn.waitFor({ state: 'visible', timeout: 10000 });
  await joinBtn.click();

  // Button flips to the disabled done-state.
  await expect(page.getByRole('button', { name: /^(Joined|Requested)$/i }).first()).toBeVisible({ timeout: 5000 });

  // A pending chat and a notification were written for the group.
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('pnPendingRequests') || '[]'));
  expect(pending.some((p) => String(p.propertyId).startsWith('group-'))).toBeTruthy();
  const notifs = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestNotifications') || '[]'));
  expect(notifs.length).toBeGreaterThan(0);

  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('the group done-state survives a reload (dedupe is persisted)', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Join group|Request to join/i }).first().click();
  await expect(page.getByRole('button', { name: /^(Joined|Requested)$/i }).first()).toBeVisible({ timeout: 5000 });

  await page.reload();
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /^(Joined|Requested)$/i }).first()).toBeVisible({ timeout: 5000 });
});

test('a signed-out user is routed to sign-in when joining a group', async ({ page }) => {
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Join group|Request to join/i }).first().click();
  await expect(page).toHaveURL(/\/signin/, { timeout: 5000 });
});

test('saving a room shows a real card on the Saved page and persists the bookmark', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/share-flat?view=rooms`);
  const card = page.locator('.sf-card').first();
  await card.waitFor({ state: 'visible', timeout: 10000 });
  const society = (await card.locator('.drop-shadow').first().innerText()).trim();

  await card.locator('.save-btn').click();

  await page.goto(`${BASE}/saved`);
  await page.getByRole('button', { name: /Flatmates & Flat-shares/i }).click();

  // The saved room renders with its real society title + a "Room" badge — never the raw key.
  await expect(page.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/^r:/)).toHaveCount(0);

  // Returning to Share Flat, the bookmark is still filled (state hydrates from storage).
  await page.goto(`${BASE}/share-flat?view=rooms`);
  await expect(page.locator('.sf-card').first().locator('.save-btn')).toHaveClass(/saved/, { timeout: 5000 });
});

test('at least one result card is above the fold on a 1440x820 laptop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.goto(`${BASE}/share-flat?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  const box = await page.locator('.sf-card').first().boundingBox();
  expect(box).not.toBeNull();
  // The card's top edge is inside the viewport — inventory peeks without scrolling.
  expect(box.y).toBeLessThan(820);
});
