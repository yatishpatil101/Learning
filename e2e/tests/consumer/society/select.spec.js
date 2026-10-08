import { test, expect } from '@playwright/test';
import { API, signedInAs } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';
import { fillSociety, stubGooglePlaces, wizardSocietyInput } from '../../../helpers/places.js';
// The list-property Location step takes a society only from a Google Maps suggestion: picking one
// mints (or re-finds) the society behind that place, and typed text is never accepted.
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543211';

async function gotoForm(page) {
  await signedInAs(page, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
}

async function toStep2Flat(page) {
  await gotoForm(page);
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });
}

test('picking a Google suggestion mints a community society that reaches the shared catalogue', async ({ page, request }) => {
  await toStep2Flat(page);
  // Unique per run: the placeId follows the name, so a fixed name would read back an earlier
  // run's row and the `mintOrigin` assertion below would be about that row instead.
  const NAME = `Zz Live Select ${Date.now().toString(36)}`;
  await fillSociety(page, NAME);
  const found = await request.get(`${API}/societies`, { params: { q: NAME, size: 20 } });
  expect(found.status()).toBe(200);
  const row = (await found.json()).content.find((s) => s.name === NAME);
  expect(row, 'the minted society is absent from the catalogue — the write never left the browser').toBeTruthy();
  expect(row.source).toBe('community');
  expect(row.mintOrigin).toBe('listing');
});

test('typed text is not a society: the field offers only Google suggestions and Not on Google Maps, and reverts on blur', async ({ page, request }) => {
  await toStep2Flat(page);
  const society = wizardSocietyInput(page);
  const NAME = `Zz Typed Only ${Date.now().toString(36)}`;
  await stubGooglePlaces(page, { empty: true });
  await society.click();
  await society.fill(NAME);
  await expect(page.getByTestId('society-not-on-maps')).toBeVisible();
  await expect(page.getByTestId('society-google-option')).toHaveCount(0);
  await society.blur();
  await expect(society).toHaveValue('');
  const found = await request.get(`${API}/societies`, { params: { q: NAME, size: 20 } });
  expect((await found.json()).content.find((s) => s.name === NAME)).toBeUndefined();
});