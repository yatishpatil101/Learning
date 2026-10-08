import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, E2E_OTP, authHeaders, ownerIdOf, seedConsent, signIn, storedPhotoUrl, uniqueMobile } from '../../../helpers/liveAuth.js';
import { LIST_PROPERTY_DRAFT_KEY, pickFloors, pickPossession } from '../../../helpers/listingForm.helper.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { fillSociety } from '../../../helpers/places.js';
import { mintPickableSociety } from '../../../helpers/liveSociety.js';
import { pickLocality } from '../../../helpers/locality.js';

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function namedOwner(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, `naming ${mobile}`).toBe(200);
  return mobile;
}

async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function fillDetails(page) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
}

async function fillLocation(page, society) {
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickLocality(page, 'Kothrud');
  await page.locator('input[data-err="flatNumber"]').fill('D-904');
  await fillSociety(page, society);
  await expect(page.getByText(/Location set: /)).toBeVisible();
  await page.locator('input[data-err="pincode"]').fill('411038');
  await page.getByRole('button', { name: /Next Step/i }).click();
}

async function fillPricing(page) {
  await page.locator('input[data-err="price"]').fill('7500000');
  await pickPossession(page);
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
}

async function reachDeferredLogin(page, society) {
  await seedConsent(page);
  await page.goto('/list-property');
  await expect(page.getByRole('heading', { name: /List your property/i })).toBeVisible({ timeout: 30000 });
  await fillDetails(page);
  await fillLocation(page, society);
  await fillPricing(page);
  const sheet = page.getByRole('dialog', { name: /Verify your mobile to upload photos and publish/i });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\/list-property\?step=4/);
  return sheet;
}

async function verifyInlineOtp(sheet, mobile) {
  await sheet.getByLabel(/Mobile Number/i).fill(mobile);
  await sheet.getByRole('button', { name: /Send OTP/i }).click();
  await expect(sheet.getByLabel('OTP digit 1')).toBeVisible();
  for (let i = 0; i < 6; i++) await sheet.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);
  await sheet.getByRole('button', { name: /Verify & Sign In/i }).click();
  await expect(sheet).toHaveCount(0);
}

test.afterEach(async () => {
  const admin = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, admin, {
      status: 'rejected',
      reason: 'Zztest cleanup — deferred login wizard fixture',
    });
  }
  created.clear();
});

test.describe('list property deferred login', () => {
  test('a guest fills the wizard, can dismiss the sheet and stays gated, then verifies inline at photos and submits with the draft adopted', async ({ page }) => {
    test.slow();
    const mobile = await namedOwner('Zztest Deferred Login Owner');
    const ownerId = ownerIdOf(await authHeaders(mobile));
    await page.route('**/api/me/photos', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ url: storedPhotoUrl('', ownerId) }),
      });
    });

    let posted = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/me/listings') && req.method() === 'POST') posted = true;
    });

    const society = `Zz Deferred Homes ${uniqueMobile().slice(-6)}`;
    await mintPickableSociety(mobile, society);
    const sheet = await reachDeferredLogin(page, society);
    await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), LIST_PROPERTY_DRAFT_KEY))
      .toContain('"__owner":""');

    await test.step('a guest who dismisses the sheet stays gated and Verify & submit reopens it without posting', async () => {
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);

      await expect(page.getByRole('heading', { name: 'Verify before photos' })).toBeVisible();
      await expect(page.getByLabel('Add property photos')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Submit Property/i })).toHaveCount(0);

      await page.getByRole('button', { name: /Verify & submit/i }).click();
      await expect(sheet).toBeVisible();
      expect(posted).toBe(false);
    });

    await test.step('verifying inline adopts the guest draft into the account', async () => {
      await verifyInlineOtp(sheet, mobile);
      await expect(page.getByRole('heading', { name: /Photos & description/i })).toBeVisible();
      await page.locator('textarea[data-err="description"]').fill('Draft adoption keeps the guest text after sign-in.');
      await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), LIST_PROPERTY_DRAFT_KEY))
        .toMatch(/"__owner":"[^"]+"/);
      await expect(page.locator('textarea[data-err="description"]')).toHaveValue(/Draft adoption keeps/);
    });

    await test.step('the owner uploads photos and submits', async () => {
      await uploadPublishablePhotos(page);
      const createdResponse = page.waitForResponse((res) => res.url().includes('/api/me/listings') && res.request().method() === 'POST');
      await page.getByRole('button', { name: /Submit Property/i }).click();
      const res = await createdResponse;
      expect([200, 201]).toContain(res.status());
      const body = await res.json();
      created.add(body.id);
      await expect(page.getByRole('heading', { name: /Submitted for review/i })).toBeVisible({ timeout: 20000 });
    });
  });

  test('logging out on the wizard clears the signed-in owner draft before another account arrives', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const first = await namedOwner('Zztest Deferred Logout A');
    const second = await namedOwner('Zztest Deferred Logout B');
    await signIn(page, first);

    await page.goto('/list-property');
    await expect(page.getByRole('heading', { name: /List your property/i })).toBeVisible({ timeout: 30000 });
    await page.locator('[data-err="propertyType"]').click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
    await page.locator('input[data-err="carpetArea"]').fill('1199');
    await pickFloors(page);
    await page.getByRole('button', { name: /Next Step/i }).click();
    await fillSociety(page, 'Zz Owner A Private Draft');

    await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), LIST_PROPERTY_DRAFT_KEY))
      .toContain('Zz Owner A Private Draft');

    await page.getByRole('button', { name: /Account menu/i }).click();
    await page.getByRole('button', { name: /Log out/i }).click();
    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('');
    await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), LIST_PROPERTY_DRAFT_KEY))
      .not.toContain('Zz Owner A Private Draft');

    await signIn(page, second);
    await page.goto('/list-property');
    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('');
    await expect(page.getByText('Zz Owner A Private Draft')).toHaveCount(0);
  });
});
