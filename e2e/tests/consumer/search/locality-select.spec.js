import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { signedInAs } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';
import { chooseLocality, localityField, pickGoogleLocality } from '../../../helpers/locality.js';
import { stubGooglePlaces } from '../../../helpers/places.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';
async function gotoStep2(page) {
  await signedInAs(page, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });
}

const resolveCall = (page) => page.waitForResponse((r) => r.url().includes('/api/localities/resolve') && r.request().method() === 'POST');

test('a Google suggestion is resolved to a locality row, sets the value and recenters the map', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoStep2(page);

  const resolved = resolveCall(page);
  await pickGoogleLocality(page, 'Pashan', { lat: 18.538, lng: 73.807 });
  const res = await resolved;
  expect(res.status()).toBe(200);
  expect(res.request().postDataJSON()).toMatchObject({ placeId: 'stub-pashan', name: 'Pashan' });
  expect(await res.json()).toMatchObject({ slug: 'pashan', name: 'Pashan' });

  await expect(page.getByText(/Location set:/i)).toBeVisible({ timeout: 8000 });
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('with Google returning nothing the picker offers the live localities from the search endpoint, with no resolve call', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoStep2(page);
  await stubGooglePlaces(page, { empty: true });
  let resolves = 0;
  page.on('request', (r) => { if (r.url().includes('/api/localities/resolve')) resolves += 1; });

  const searched = page.waitForResponse((r) => r.url().includes('/api/localities/search') && r.status() === 200);
  await chooseLocality(page, localityField(page).locator('.dz-dropdown__trigger'), 'Baner');
  await searched;

  await expect(localityField(page).locator('.dz-dropdown__value')).toHaveText(/Baner/);
  expect(resolves).toBe(0);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('a failed resolve keeps the old value and shows the locality error', async ({ page }) => {
  await gotoStep2(page);
  await page.route('**/api/localities/resolve', (route) => route.fulfill({
    status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'Pick the locality from the suggestions.' }),
  }));

  await pickGoogleLocality(page, 'Pashan', { lat: 18.538, lng: 73.807, expectValue: null });

  await expect(page.getByTestId('locality-error')).toBeVisible();
  await expect(localityField(page).locator('.dz-dropdown__value')).not.toHaveText(/Pashan/);
});

test('while a pick is resolving the field says so and stays locked', async ({ page }) => {
  await gotoStep2(page);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/localities/resolve', async (route) => { await gate; await route.continue(); });

  const picked = pickGoogleLocality(page, 'Pashan', { lat: 18.538, lng: 73.807 });
  const adding = page.getByRole('status').filter({ hasText: 'Adding locality' });
  await expect(adding).toBeVisible();
  await expect(localityField(page).locator('.dz-dropdown__trigger')).toBeDisabled();

  release();
  await picked;
  await expect(adding).toHaveCount(0);
});
