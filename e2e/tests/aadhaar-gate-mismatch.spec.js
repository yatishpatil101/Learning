import { test, expect } from '@playwright/test';

/* "Is this the mobile number linked to your Aadhaar?" confirmation, mirrored from the
   List Property gate, must appear on every Aadhaar identity gate:
   - the shared AadhaarVerifyModal (contact owners / share-flat supply gate), and
   - the share-flat "Become a verified seeker" modal.
   Answering "No, it's a different number" must route the user to sign in with their
   Aadhaar-linked number, and "Back" must return to the confirmation. */

const BASE = 'http://localhost:5173';
const MOBILE = '9812340000';

async function seedUnverified(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    // No puneNestAadhaar / seeker key → neither identity- nor seeker-verified.
  }, mobile);
}

test('shared Aadhaar gate: confirm the signed-in number, and "No" routes to re-sign-in', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/share-flat?post=1`);

  const gate = page.getByRole('dialog', { name: /Verify your identity with Aadhaar/i });
  await expect(gate).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toBeVisible();

  await page.getByRole('button', { name: /a different number/i }).click();
  await expect(page.getByRole('heading', { name: 'Sign in with your Aadhaar-linked number' })).toBeVisible();
  await expect(gate.getByText(`+91 ${MOBILE}`)).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toBeVisible();
});

test('seeker verify modal: "Yes, send OTP" completes the verification', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/share-flat`);

  await page.getByRole('button', { name: /Get verified/i }).click();
  await expect(page.getByRole('heading', { name: 'Become a verified seeker' })).toBeVisible();

  await page.getByRole('button', { name: /Yes, send OTP/i }).click();
  const box1 = page.getByLabel('OTP digit 1');
  await box1.waitFor({ timeout: 5000 });
  for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill('1');
  await page.getByRole('button', { name: /Verify.*continue/i }).click();

  await expect(page.getByText(/Verified Seeker/i).first()).toBeVisible({ timeout: 5000 });
});

test('seeker verify modal: confirm the signed-in number, and "No" routes to re-sign-in', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/share-flat`);

  await page.getByRole('button', { name: /Get verified/i }).click();
  await expect(page.getByRole('heading', { name: 'Become a verified seeker' })).toBeVisible();
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toBeVisible();

  await page.getByRole('button', { name: /a different number/i }).click();
  await expect(page.getByRole('heading', { name: 'Sign in with your Aadhaar-linked number' })).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toBeVisible();
});
