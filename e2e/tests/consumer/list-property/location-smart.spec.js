import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';

const SOCIETY = {
  id: 'soc-smart-1',
  slug: 'skyline-heights-baner',
  name: 'Skyline Heights',
  localitySlug: 'baner',
  pincode: '411045',
  lat: 18.5602,
  lng: 73.7861,
  builder: 'Kolte-Patil',
  year: 2018,
  rera: 'P52100012345',
  registration: true,
  conveyance: true,
  source: 'seed',
};

async function stubSocieties(page) {
  await page.route('**/api/societies**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/societies/skyline-heights-baner')) {
      await route.fulfill({ json: SOCIETY });
      return;
    }
    await route.fulfill({ json: { content: [SOCIETY], totalElements: 1 } });
  });
}

async function gotoLocation(page) {
  await stubSocieties(page);
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

test('the society pick leads the location step and autofills safe fields; the current-location control and mobile map controls are wired', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoRequested = false;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition(success) {
        window.__geoRequested = true;
        success({ coords: { latitude: 18.5602, longitude: 73.7861 } });
      },
    } });
  });
  await gotoLocation(page);
  const society = page.locator('input[data-err="society"]');
  const { societyY, mapY } = await page.evaluate(() => ({
    societyY: document.querySelector('input[data-err="society"]').getBoundingClientRect().y,
    mapY: document.querySelector('.gm-style').getBoundingClientRect().y,
  }));
  expect(societyY).toBeLessThan(mapY);

  await society.fill('Skyline');
  await page.getByRole('option', { name: /Skyline Heights/ }).click();
  await expect(page.locator('[data-err="locality"]')).toContainText('Baner');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045');
  await expect(page.getByText(/Filled from Skyline Heights/i)).toBeVisible();
  await expect(page.getByText(/Location set:/i)).toBeVisible();

  await expect(page.getByRole('button', { name: /Use my current location/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Zoom in map/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Zoom out map/i })).toBeVisible();
  await page.getByRole('button', { name: /Use my current location/i }).click();
  await expect.poll(() => page.evaluate(() => window.__geoRequested)).toBe(true);
});

test('society pick does not overwrite owner-entered locality or pincode', async ({ page }) => {
  await gotoLocation(page);
  await page.locator('[data-err="locality"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.getByRole('option', { name: 'Wakad', exact: true }).click();
  await page.locator('input[data-err="pincode"]').fill('411099');

  await page.locator('input[data-err="society"]').fill('Skyline');
  await page.getByRole('option', { name: /Skyline Heights/ }).click();
  await expect(page.locator('[data-err="locality"]')).toContainText('Wakad');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411099');
});
