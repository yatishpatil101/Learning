/* The commercial sub-type picks the use-profile deciding which fixtures, amenities and photo categories the
   form offers, and the server stores `formDetails` verbatim — so an answer must not survive a profile change. */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { fillSociety } from '../../../helpers/places.js';
import { pickLocality } from '../../../helpers/locality.js';

const owners = new Set();

test.afterEach(async () => {
  if (!owners.size) return;
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const mobile of owners) {
    const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
    if (res.status !== 200) continue;
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
    for (const row of rows) {
      await fetch(`${API}/properties/${row.id}/status`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup — synthetic sub-type fixture' }),
      });
    }
  }
  owners.clear();
});

const menuOpen = (page) => expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();

async function pickOption(page, dataErr, label) {
  const trigger = page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`);
  await trigger.click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

const multiSelect = (page) => page.getByRole('button', { name: 'Fixtures and fittings', exact: true }).locator('..');
// The multi-select keeps its menu open, so the caller closes it once it is done picking.
async function openMulti(page) {
  const field = multiSelect(page);
  await field.locator('.dz-dropdown__trigger').click();
  await menuOpen(page);
  return field;
}

async function closeMulti(page, field) {
  const trigger = field.locator('.dz-dropdown__trigger');
  await trigger.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toHaveCount(0);
}

async function gotoCommercialRent(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Commercial');
  return mobile;
}
// Fit-out is the one commercial answer step 1 refuses to advance without. Pills, not a dropdown.
const pickFitOut = (page) => page.locator('[data-err="shellType"]').getByText('Warm Shell', { exact: true }).click();

const BANER_PIN = { lat: 18.5602, lng: 73.7861, locality: 'Baner', pincode: '411045' };

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function fillLocationAndPricing(page) {
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickLocality(page, 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('Unit 402');
  await fillSociety(page, 'Zztest Business Bay', BANER_PIN);
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="monthlyRent"]').fill('90000');
  await page.locator('input[data-err="deposit"]').fill('540000');
  await pickDate(page, '[data-err="availableFrom"]', inDays(60));
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & description/i', { timeout: 15000 });
}

test('switching the commercial sub-type drops the previous profile’s fixtures and amenities', async ({ page }) => {
  await gotoCommercialRent(page);
  await pickOption(page, 'commercialType', 'Office Space');
  await pickFitOut(page);
  await page.locator('input[data-err="carpetArea"]').fill('2400');

  const fixtures = await openMulti(page);
  await page.locator('.dz-dropdown__option', { hasText: 'Server / UPS Room' }).first().click();
  await closeMulti(page, fixtures);
  await expect(fixtures.locator('.dz-dropdown__trigger')).toContainText('Server / UPS Room');

  await fillLocationAndPricing(page);
  await page.locator('.furn-tile', { hasText: 'Power Backup' }).click();
  await expect(page.locator('.furn-tile.checked', { hasText: 'Power Backup' })).toHaveCount(1);

  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('[data-err="commercialType"]')).toBeVisible();
  await pickOption(page, 'commercialType', 'Warehouse / Godown');
  // The office answer is gone, and the industrial list cannot even offer it back.
  const warehouseFixtures = await openMulti(page);
  await expect(page.locator('.dz-dropdown__option', { hasText: 'Server / UPS Room' })).toHaveCount(0);
  await expect(page.locator('.dz-dropdown__option', { hasText: 'Loading Bay / Dock' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(warehouseFixtures.locator('.dz-dropdown__trigger')).toContainText('Select fixtures & fittings');
  await pickFitOut(page);
  // Power Backup exists in both profiles, so an uncleared amenity would survive this walk unnoticed.
  await fillLocationAndPricing(page);
  await expect(page.locator('.furn-tile', { hasText: 'Power Backup' })).toHaveCount(1);
  await expect(page.locator('.furn-tile.checked', { hasText: 'Power Backup' })).toHaveCount(0);
});

test('leaving Commercial posts no commercial fixtures', async ({ page }) => {
  const mobile = await gotoCommercialRent(page);
  owners.add(mobile);
  await pickOption(page, 'commercialType', 'Office Space');
  await pickFitOut(page);
  await openMulti(page);
  await page.locator('.dz-dropdown__option', { hasText: 'Server / UPS Room' }).first().click();
  await page.keyboard.press('Escape');

  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await expect(multiSelect(page)).toHaveCount(0);
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await page.locator('input[data-err="carpetArea"]').fill('1150');
  const floor = page.locator('div').filter({ has: page.locator('label:text-is("Floor No. *")') }).last();
  await floor.locator('.dz-dropdown__trigger').click();
  await menuOpen(page);
  await page.getByRole('option', { name: '9', exact: true }).click();
  const total = page.locator('div').filter({ has: page.locator('label:text-is("Total Floors *")') }).last();
  await total.locator('.dz-dropdown__trigger').click();
  await menuOpen(page);
  await page.getByRole('option', { name: '14', exact: true }).click();

  await fillLocationAndPricing(page);
  await uploadPublishablePhotos(page);

  const posted = page.waitForRequest((request) => request.method() === 'POST'
    && new URL(request.url()).pathname === '/api/me/listings');
  await page.getByRole('button', { name: /Submit Property/i }).click();
  const { formDetails } = (await posted).postDataJSON();

  expect(formDetails.fixtures).toBeUndefined();
  expect(formDetails.suitableFor).toBeUndefined();
  expect(formDetails.shellType).toBeUndefined();
  expect(formDetails.commercialType).toBeUndefined();
});
