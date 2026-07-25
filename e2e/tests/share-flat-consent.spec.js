import { test, expect } from '@playwright/test';

/* Owner-consent OTP ping. A sitting tenant listing a replacement flatmate confirms
   the flat owner is aware via an OTP sent to the owner's phone. On success the
   group carries an "Owner-consented" trust cue that persists across reload. */

const BASE = 'http://localhost:5173';
const MOBILE = '9812345678';
const OWNER = '9700000001';

async function seedTenant(page) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Consent Tenant', mobile: m, role: 'tenant', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, MOBILE);
}

async function startGroup(page, title) {
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Create a group/i }).click();
  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('45000');
  await page.locator('input[type="number"]').nth(1).fill('3');
  await page.locator('input[type="number"]').nth(2).fill('1');
  await page.getByPlaceholder(/Your name/i).fill('Consent Tenant');
  await page.getByText(/registered rent agreement/i).click(); // tenant tier
  await page.getByLabel('Upload registered rent agreement for group').setInputFiles({ name: 'agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 consent test') });
}

test('tenant completes owner-consent OTP → group shows Owner-consented (persists)', async ({ page }) => {
  const title = 'Consent replacement in Baner';
  await seedTenant(page);
  await startGroup(page, title);
  // Enter the owner's mobile and run the consent OTP.
  await page.getByPlaceholder(/seeking a replacement/i).fill(OWNER);
  await page.getByRole('button', { name: /Verify owner consent via OTP/i }).click();
  await page.getByRole('button', { name: /Send OTP to owner/i }).click();
  for (let d = 1; d <= 6; d++) await page.getByLabel(`OTP digit ${d}`).fill(String(d));
  await page.getByRole('button', { name: /Confirm consent/i }).click();
  // The form reflects the confirmed consent.
  await expect(page.getByText(/Owner consent confirmed/i).first()).toBeVisible({ timeout: 5000 });
  // Publish and assert the card cue.
  await page.getByRole('button', { name: /Create group/i }).click();
  const card = page.locator('.sf-card', { hasText: title }).first();
  await expect(card.getByText(/Owner-consented/i)).toBeVisible({ timeout: 5000 });
  // Tenant tier with an uploaded agreement is still awaiting Ops — badge withheld.
  await expect(card.getByText(/Pending Ops review/i)).toBeVisible();
  await expect(card.getByText(/Tenant-verified/i)).toHaveCount(0);
  // Persists across reload.
  await page.reload();
  const card2 = page.locator('.sf-card', { hasText: title }).first();
  await card2.waitFor({ timeout: 10000 });
  await expect(card2.getByText(/Owner-consented/i)).toBeVisible();
});

test('consent button is disabled until a full 10-digit owner mobile is entered', async ({ page }) => {
  const title = 'Consent gating in Baner';
  await seedTenant(page);
  await startGroup(page, title);
  const btn = page.getByRole('button', { name: /Verify owner consent via OTP/i });
  await expect(btn).toBeDisabled();
  await page.getByPlaceholder(/seeking a replacement/i).fill('97000');
  await expect(btn).toBeDisabled();
  await page.getByPlaceholder(/seeking a replacement/i).fill(OWNER);
  await expect(btn).toBeEnabled();
});
