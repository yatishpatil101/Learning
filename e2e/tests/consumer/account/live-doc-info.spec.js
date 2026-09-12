import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { signedInAs } from '../../../helpers/liveAuth.js';

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
      version: 1,
      ts: Date.now(),
    }));
  });
}

async function openDocuments(page, mobile, context = 'owner') {
  await seedConsent(page);
  await signedInAs(page, mobile);
  const documentsRead = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    const isOwnerVault = /^\/api\/me\/documents\/[^/]+$/.test(path)
      && !path.endsWith('/personal') && !path.endsWith('/requests');
    return response.request().method() === 'GET'
      && (context === 'owner' ? isOwnerVault : path === '/api/me/documents/personal');
  });
  await page.goto('/dashboard#documents');
  const response = await documentsRead;
  expect(response.status(), `loading the selected ${context} vault: ${new URL(response.url()).pathname}`).toBe(200);
  await expect(page.getByText('Document Vault', { exact: true })).toBeVisible();
}

async function center(page, locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
}

test.describe('Document Vault information — live APIs', () => {
  test('an owner hovering a document-information dot sees its explanatory tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openDocuments(page, ACTORS.owner);

    const dot = page.getByRole('button', { name: /What is Sale Deed/i }).first();
    await center(page, dot);
    await dot.hover();

    const tooltip = page.locator('.dz-tip[role="tooltip"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/ownership was transferred/i);
    await expect(page.locator('[data-tip][aria-describedby]').first()).toBeVisible();

    await page.mouse.move(2, 2);
    await expect(tooltip).toBeHidden();

    const agreement = page.getByRole('button', { name: /Rent Agreement/i }).first();
    await expect(agreement).toBeVisible();
    await expect(agreement).toContainText(/for this property|Registered agreement for/i);
  });

  test('the touch version opens and dismisses the same tooltip without a scroll race', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    await openDocuments(page, ACTORS.owner);
    const dot = page.getByRole('button', { name: /What is Sale Deed/i }).first();
    await center(page, dot);
    await dot.tap();

    const tooltip = page.locator('.dz-tip[role="tooltip"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Sale Deed');

    await page.mouse.click(5, 5);
    await expect(tooltip).toBeHidden();
    await context.close();
  });

  test('tenant agreement information stays scoped to My Tenancy, not Personal identity documents', async ({ page }) => {
    await openDocuments(page, ACTORS.tenant, 'personal');

    const tenancy = page.getByRole('button', { name: /My Tenancy/i });
    await expect(tenancy).toBeVisible();
    const agreement = page.getByRole('button', { name: /Rent Agreement/i }).first();
    await expect(agreement).toBeVisible();
    await expect(agreement).toContainText(/for|Registered/i);

    await page.getByRole('button', { name: /^Personal$/ }).click();
    await expect(page.getByRole('button', { name: /Rent Agreements/i })).toHaveCount(0);
  });
});
