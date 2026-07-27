import { test, expect } from '@playwright/test';

/* Badge-not-gate contact model (ADR-019). Contacting an owner needs only a
   signed-in (L1) account — there is NO blanket Aadhaar gate anymore. The ONLY
   time verification is asked for is when an owner has opted into "accept verified
   contacts only": an unverified requester is then offered the opt-in Verified
   badge (native DigiLocker) instead of being walled out. */

const BASE = 'http://localhost:5173';
const PROP = 'P5000';                 // approved seed listing (owner mobile 9530047855)
const OWNER_MOBILE = '9530047855';
const BUYER = '9876543210';           // a different number → treated as a buyer, not the owner
const REQ_KEY = 'puneNestContactReq:' + OWNER_MOBILE;
const PREFS_KEY = 'pnOwnerPrefs:' + OWNER_MOBILE;

async function seedBuyer(page, { verified = false, ownerVerifiedOnly = false } = {}) {
  await page.addInitScript(({ buyer, verified, ownerVerifiedOnly, prefsKey }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Buyer', mobile: buyer, role: 'buyer', loginAt: Date.now(),
    }));
    if (verified) {
      localStorage.setItem('puneNestAadhaar:' + buyer, JSON.stringify({ verified: true, aadhaarMobile: buyer, at: Date.now() }));
    }
    if (ownerVerifiedOnly) {
      localStorage.setItem(prefsKey, JSON.stringify({ verifiedContactOnly: true }));
    }
  }, { buyer: BUYER, verified, ownerVerifiedOnly, prefsKey: PREFS_KEY });
}

const readReqs = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), REQ_KEY);
const pendingCount = async (page) => (await readReqs(page)).filter((r) => r.status === 'pending').length;
// The DigiLocker opt-in badge modal (shared AadhaarVerifyModal).
const badgeModal = (page) => page.getByRole('dialog', { name: 'Get your Verified badge' });

test('an unverified buyer requests the number directly — no gate, request goes pending', async ({ page }) => {
  await seedBuyer(page, { verified: false });
  await page.goto(`${BASE}/property/${PROP}`);

  const requestBtn = page.getByRole('button', { name: /Request number/i }).first();
  await requestBtn.waitFor({ timeout: 10000 });
  await requestBtn.click();

  // No verification popup — the request is stored and the awaiting state is shown.
  await expect(badgeModal(page)).toHaveCount(0);
  await expect(page.getByText('Request sent — awaiting owner').first()).toBeVisible();
  expect(await pendingCount(page)).toBe(1);
});

test('an already-verified buyer also sends the request directly (no popup)', async ({ page }) => {
  await seedBuyer(page, { verified: true });
  await page.goto(`${BASE}/property/${PROP}`);

  await page.getByRole('button', { name: /Request number/i }).first().click();

  await expect(badgeModal(page)).toHaveCount(0);
  await expect(page.getByText('Request sent — awaiting owner').first()).toBeVisible();
  expect(await pendingCount(page)).toBe(1);
});

test('a "verified contacts only" owner shows the opt-in badge modal to an unverified buyer', async ({ page }) => {
  await seedBuyer(page, { verified: false, ownerVerifiedOnly: true });
  await page.goto(`${BASE}/property/${PROP}`);

  await page.getByRole('button', { name: /Request number/i }).first().click();

  // The owner opted into verified-only, so the buyer is offered the badge — NOT walled.
  await expect(badgeModal(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with DigiLocker' })).toBeVisible();
  // Crucially the request was NOT stored yet — verification is offered first.
  expect(await pendingCount(page)).toBe(0);
});

test('earning the DigiLocker badge lets the verified-only request go through', async ({ page }) => {
  await seedBuyer(page, { verified: false, ownerVerifiedOnly: true });
  await page.goto(`${BASE}/property/${PROP}`);

  await page.getByRole('button', { name: /Request number/i }).first().click();
  await expect(badgeModal(page)).toBeVisible();

  // Complete the mock DigiLocker round-trip → badge earned → request resumes.
  await page.getByRole('button', { name: 'Continue with DigiLocker' }).click();

  await expect(badgeModal(page)).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByText('Request sent — awaiting owner').first()).toBeVisible();
  const badge = await page.evaluate((m) => JSON.parse(localStorage.getItem('puneNestAadhaar:' + m) || 'null'), BUYER);
  expect(badge && badge.verified).toBe(true);
  expect(await pendingCount(page)).toBe(1);
});
