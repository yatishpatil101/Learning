import { test, expect } from '@playwright/test';

/* Blanket Aadhaar gate for contacting owners.
   Unverified tenants/buyers must hit the Aadhaar verification popup before they can
   request an owner's number or send an enquiry. Only verified users get through. */

const BASE = 'http://localhost:5173';
const PROP = 'P5000';                 // approved seed listing (owner mobile 9530047855)
const OWNER_MOBILE = '9530047855';
const BUYER = '9876543210';           // a different number → treated as a buyer, not the owner
const REQ_KEY = 'puneNestContactReq:' + OWNER_MOBILE;

async function seedBuyer(page, { verified = false } = {}) {
  await page.addInitScript(({ buyer, verified }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Buyer', mobile: buyer, role: 'buyer', loginAt: Date.now(),
    }));
    if (verified) {
      localStorage.setItem('puneNestAadhaar:' + buyer, JSON.stringify({ verified: true, aadhaarMobile: buyer, at: Date.now() }));
    }
  }, { buyer: BUYER, verified });
}

const readReqs = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), REQ_KEY);
const pendingCount = async (page) => (await readReqs(page)).filter((r) => r.status === 'pending').length;

async function fillOtpAndVerify(page) {
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await page.getByLabel('OTP digit 1').waitFor({ timeout: 5000 });
  for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill('1');
  await page.getByRole('button', { name: /Verify & continue/i }).click();
}

test('unverified buyer clicking "Request number" gets the Aadhaar popup and NO request is stored', async ({ page }) => {
  await seedBuyer(page, { verified: false });
  await page.goto(`${BASE}/property/${PROP}`);

  const requestBtn = page.getByRole('button', { name: /Request number/i }).first();
  await requestBtn.waitFor({ timeout: 10000 });
  await requestBtn.click();

  // The blanket Aadhaar popup appears …
  await expect(page.getByRole('heading', { name: 'Verify your identity to continue' })).toBeVisible();
  await expect(page.getByText('Only Aadhaar-verified users can contact owners on PuneNest.')).toBeVisible();
  // … and crucially the contact request was NOT sent for an unverified user.
  expect(await pendingCount(page)).toBe(0);
});

test('completing Aadhaar OTP lets the request go through', async ({ page }) => {
  await seedBuyer(page, { verified: false });
  await page.goto(`${BASE}/property/${PROP}`);

  await page.getByRole('button', { name: /Request number/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Verify your identity to continue' })).toBeVisible();

  await fillOtpAndVerify(page);

  // Popup closes and the (previously blocked) request is now stored + reflected in UI.
  await expect(page.getByRole('heading', { name: 'Verify your identity to continue' })).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByText('Request sent — awaiting owner').first()).toBeVisible();
  const reqs = await readReqs(page);
  expect(reqs.some((r) => r.buyerMobile === BUYER && r.status === 'pending')).toBe(true);
});

test('an already-verified buyer sends the request directly (no popup)', async ({ page }) => {
  await seedBuyer(page, { verified: true });
  await page.goto(`${BASE}/property/${PROP}`);

  await page.getByRole('button', { name: /Request number/i }).first().click();

  await expect(page.getByRole('heading', { name: 'Verify your identity to continue' })).toHaveCount(0);
  await expect(page.getByText('Request sent — awaiting owner').first()).toBeVisible();
  expect(await pendingCount(page)).toBe(1);
});

test('Contact Owner on an unverified account is gated behind Aadhaar (goes straight to the gate, no enquiry modal)', async ({ page }) => {
  await seedBuyer(page, { verified: false });
  await page.goto(`${BASE}/property/${PROP}`);

  await page.getByRole('button', { name: /Contact Owner/i }).first().click();

  // Contact Owner now starts an in-app chat, so an unverified user hits the Aadhaar
  // gate directly — there is no separate "Contact the owner" enquiry popup to duplicate
  // the number-reveal flow.
  await expect(page.getByRole('heading', { name: 'Verify your identity to continue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Contact the owner' })).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/messages/);
});
