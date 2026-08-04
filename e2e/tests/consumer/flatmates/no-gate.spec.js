import { test, expect } from '@playwright/test';
import { postAsGroup, postHavingPlace } from '../../../helpers/app.js';

/* Badge-not-gate for flatmates supply (ADR-019). Listing a room, creating a
   group and posting a requirement are host actions that need only a signed-in
   (L1) account — the removed Aadhaar OTP wall is gone. A signed-in user (verified
   or not) reaches every supply form directly; only a signed-OUT guest is routed
   to sign-in. The optional "Verified Seeker" badge lives in a separate flow. */

const BASE = 'http://localhost:5173';
const MOBILE = '9812340000';

async function seedSignedIn(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    // Deliberately NO puneNestAadhaar key → not identity-verified, yet still allowed.
  }, mobile);
}

// The old Aadhaar gate dialog — must never appear on a supply action now.
const gateDialog = (page) => page.getByRole('dialog', { name: /Verify your identity with Aadhaar/i });

test('a signed-in (unverified) user opens Create-a-group directly — no gate', async ({ page }) => {
  await seedSignedIn(page);
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postAsGroup(page);
  await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible();
  await expect(gateDialog(page)).toHaveCount(0);
});

test('a signed-in (unverified) user posting with a place lands on the room form', async ({ page }) => {
  await seedSignedIn(page);
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postHavingPlace(page);

  // Routed straight into the post-property flow for a tenant's replacement search.
  await expect(page).toHaveURL(/\/list-property\?flatmate=1/);
  await expect(gateDialog(page)).toHaveCount(0);
});

test('a signed-in (unverified) user deep-linking ?post=1 opens the post form directly', async ({ page }) => {
  await seedSignedIn(page);
  await page.goto(`${BASE}/flatmates?post=1`);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });
  await expect(gateDialog(page)).toHaveCount(0);
});

test('a signed-out guest hitting Create a group is routed to sign-in (the only floor)', async ({ page }) => {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postAsGroup(page);
  await expect(page).toHaveURL(/\/signin/);
});
