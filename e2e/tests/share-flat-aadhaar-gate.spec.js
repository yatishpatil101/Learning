import { test, expect } from '@playwright/test';

/* Supply-side eligibility gate: listing a room and creating a group are host
   actions and must require an Aadhaar-OTP-verified identity. Verified users pass
   straight through; unverified users get the shared Aadhaar popup and the action
   only resumes once they verify. */

const BASE = 'http://localhost:5173';
const MOBILE = '9812340000';

async function seedVerified(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, mobile);
}

async function seedUnverified(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    // Deliberately no puneNestAadhaar key → identity not verified.
  }, mobile);
}

const gateDialog = (page) => page.getByRole('dialog', { name: /Verify your identity with Aadhaar/i });

test('verified host opens Create-a-group directly (no Aadhaar gate)', async ({ page }) => {
  await seedVerified(page);
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Create a group/i }).click();
  await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible();
  await expect(gateDialog(page)).toHaveCount(0);
});

test('unverified user hitting Create a group is stopped by the Aadhaar gate', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Create a group/i }).click();
  await expect(gateDialog(page)).toBeVisible();
  // The group form must NOT be open behind the gate.
  await expect(page.getByPlaceholder(/2 girls/i)).toHaveCount(0);
});

test('unverified user hitting List your room is stopped by the Aadhaar gate', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/share-flat?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /List your room/i }).click();
  await expect(gateDialog(page)).toBeVisible();
  // Must not have navigated to the list-property flow yet.
  await expect(page).toHaveURL(/\/share-flat/);
});

test('passing the Aadhaar OTP resumes the parked create-group action', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Create a group/i }).click();
  await expect(gateDialog(page)).toBeVisible();

  await page.getByRole('button', { name: /Send OTP/i }).click();
  const box1 = page.getByLabel('OTP digit 1');
  await box1.waitFor({ timeout: 5000 });
  await box1.click();
  await page.keyboard.type('123456');
  await page.getByRole('button', { name: /Verify.*continue/i }).click();

  // Gate closes and the parked action (open the group form) runs.
  await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible({ timeout: 5000 });
  await expect(gateDialog(page)).toHaveCount(0);
});

test('unverified user deep-linking to Post a request is stopped by the Aadhaar gate', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/share-flat?post=1`);
  await expect(gateDialog(page)).toBeVisible({ timeout: 10000 });
  // The post form must NOT be open behind the gate.
  await expect(page.getByRole('heading', { name: /Post your flat-share request/i })).toHaveCount(0);
});

test('verified host clicking List your room lands on the flatmate/tenant room form', async ({ page }) => {
  await seedVerified(page);
  await page.goto(`${BASE}/share-flat?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /List your room/i }).click();

  // Routed into the post-property flow, pre-set for a sitting tenant's replacement search.
  await expect(page).toHaveURL(/\/list-property\?share=1/);
  await expect(page.getByRole('button', { name: /Find a flatmate/i })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /I'm a current tenant/i })).toHaveAttribute('aria-pressed', 'true');
});

test('passing the Aadhaar OTP resumes the parked post-a-request action', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/share-flat?post=1`);
  await expect(gateDialog(page)).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /Send OTP/i }).click();
  const box1 = page.getByLabel('OTP digit 1');
  await box1.waitFor({ timeout: 5000 });
  await box1.click();
  await page.keyboard.type('123456');
  await page.getByRole('button', { name: /Verify.*continue/i }).click();

  // Gate closes and the parked action (open the post-request form) runs.
  await expect(page.getByRole('heading', { name: /Post your flat-share request/i })).toBeVisible({ timeout: 5000 });
  await expect(gateDialog(page)).toHaveCount(0);
});