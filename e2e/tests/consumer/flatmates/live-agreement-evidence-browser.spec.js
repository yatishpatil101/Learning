import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Browser-to-API agreement evidence contract.
 *
 * This is deliberately below the moderation UI: a browser creates a group through the actual
 * uploader and the test checks the server's verification queue for the evidence. Declaring the
 * agreement without a file must instead become an identity group with no queue row.
 *
 * The consumer card's pending/approved review labels remain mock-only for now. The screen reads
 * those labels from `getFlatmateReviewStatusMap()` in localStorage, not from the real review route,
 * so asserting them here would require faking the very state this spec is meant to prove.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const PDF = {
  name: 'agreement.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 live agreement evidence'),
};
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function openGroupForm(page) {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Post$/ }).first().click();
  const modal = page.locator('.sf-modal');
  await modal.getByRole('button', { name: /I'm still looking for a place/i }).click();
  await modal.getByRole('button', { name: /We're already a group/i }).click();
}

async function submitGroup(page, title, upload) {
  const created = page.waitForResponse(
    (response) => /\/api\/flatmates\/groups(\?|$)/.test(response.url())
      && response.request().method() === 'POST',
  );
  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('40000');
  await page.getByPlaceholder(/Your name/i).fill('Agreement Host');
  await page.getByText(/registered rent agreement/i).click();
  if (upload) {
    await page.getByLabel('Upload registered rent agreement for group').setInputFiles(PDF);
  }
  await page.getByRole('button', { name: /Create group/i }).click();
  const response = await created;
  const group = await response.json();
  expect(response.status(), JSON.stringify(group)).toBe(201);
  return group;
}

async function pendingReviews() {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const response = await fetch(`${API}/admin/flatmate-reviews?status=pending&size=100`, {
    headers: auth(accessToken),
  });
  expect(response.status).toBe(200);
  return (await response.json()).content;
}

test('a browser upload reaches the real verification queue with agreement evidence', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  const { accessToken } = await apiLogin(mobile);
  const title = `Live agreement upload ${Date.now().toString(36)}`;

  await openGroupForm(page);
  const group = await submitGroup(page, title, true);
  track('groups', group.id, accessToken);
  expect(group.verificationTier).toBe('tenant');
  expect(group.agreementDeclared).toBe(true);

  const review = (await pendingReviews()).find((row) => row.groupId === group.id);
  expect(review, 'an agreement-backed group must be queued for Ops').toBeTruthy();
  expect(review.agreementDoc).toBeTruthy();
});

test('a browser declaration without evidence stays identity-tier and creates no review', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  const { accessToken } = await apiLogin(mobile);
  const title = `Live agreement declare only ${Date.now().toString(36)}`;

  await openGroupForm(page);
  const group = await submitGroup(page, title, false);
  track('groups', group.id, accessToken);
  expect(group.verificationTier).toBe('identity');
  expect(group.agreementDeclared).toBe(false);
  expect((await pendingReviews()).some((row) => row.groupId === group.id)).toBe(false);
});