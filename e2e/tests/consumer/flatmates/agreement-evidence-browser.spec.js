import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { postAsGroup, haveAFlat } from '../../../helpers/app.js';
import { createRequire } from 'node:module';

const { PDFDocument } = createRequire(new URL('../../../../frontend/package.json', import.meta.url))('pdf-lib');
// Browser uploads must reach the real review queue; browser-only review labels remain out of scope.
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const AGREEMENT_FILE = {
  name: 'agreement.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
};
async function agreementPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Leave and licence agreement');
  return { name: 'agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function openGroupForm(page) {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await postAsGroup(page);
  await haveAFlat(page);
}

async function submitGroup(page, title, upload, file = AGREEMENT_FILE) {
  const created = page.waitForResponse(
    (response) => /\/api\/flatmates\/groups(\?|$)/.test(response.url())
      && response.request().method() === 'POST',
  );
  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34,000/i).fill('40000');
  await page.getByPlaceholder(/Your name/i).fill('Agreement Host');
  await page.getByText(/registered rent agreement/i).click();
  if (upload) {
    const uploaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/me/documents/personal' && response.request().method() === 'POST';
    });
    const input = page.locator('input[type="file"][aria-label="Upload registered rent agreement for group"]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles(file);
    expect([200, 201]).toContain((await uploaded).status());
    await expect(page.getByText(/agreement\.(png|jpg|pdf)/)).toBeVisible();
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

test('browser uploads, a PNG or a PDF, back a tenant-tier group and reach the real verification queue', async ({ page }) => {
  test.slow();
  const mobile = await signedInAsNew(page);
  const { accessToken } = await apiLogin(mobile);

  await test.step('a browser upload reaches the real verification queue with agreement evidence', async () => {
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

  await test.step('a PDF agreement uploads and backs a tenant-tier group', async () => {
    await openGroupForm(page);
    const group = await submitGroup(page, `Live agreement pdf ${Date.now().toString(36)}`, true, await agreementPdf());
    track('groups', group.id, accessToken);
    expect(group.verificationTier).toBe('tenant');
    expect(group.agreementDeclared).toBe(true);
  });
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
