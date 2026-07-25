// @ts-check
import { test, expect } from '@playwright/test';
import * as consumerC from '../../frontend/src/pages/consumer/list-property/constants.js';
import * as adminC from '../../frontend/src/pages/admin/post-on-behalf/constants.js';

const BASE = 'http://localhost:5173';

/**
 * These tests lock the two "post a property" flows together: the consumer flow
 * (/list-property) is the single source of truth, and the admin "post on behalf"
 * wizard must expose the identical option sets so a listing created either way is
 * discoverable under the same filters. If someone re-declares an option array in
 * the admin flow and it drifts, these assertions fail.
 */
test.describe('Post-property ↔ Post-on-behalf option sync', () => {
  test('shared option arrays are identical across both flows', async () => {
    expect(adminC.facingOptions).toEqual(consumerC.facingOptions);
    expect(adminC.ageOptions).toEqual(consumerC.ageOptions);
    expect(adminC.floorOptions).toEqual(consumerC.floorOptions);
    expect(adminC.totalFloorsOptions).toEqual(consumerC.totalFloorsOptions);
    expect(adminC.localities).toEqual(consumerC.localities);
    expect(adminC.ownershipOptions).toEqual(consumerC.ownershipOptions);
    expect(adminC.agreementOptions).toEqual(consumerC.agreementOptions);
    expect(adminC.lockinOptions).toEqual(consumerC.lockinOptions);
    expect(adminC.noticeOptions).toEqual(consumerC.noticeOptions);
    expect(adminC.plotZoneOptions).toEqual(consumerC.plotZoneOptions);
    expect(adminC.openSidesOptions).toEqual(consumerC.openSidesOptions);
    expect(adminC.waterSourceOptions).toEqual(consumerC.waterSourceOptions);
    expect(adminC.washroomOptions).toEqual(consumerC.washroomOptions);
  });

  test('property types and commercial subtypes match the canonical taxonomy', async () => {
    expect(adminC.typeOptions).toEqual(consumerC.PROPERTY_TYPES);
    expect(adminC.commercialSubtypes).toEqual(consumerC.COMMERCIAL_SUBTYPES);
  });

  test('furnishing values are the canonical keys (unfurnished/semi/furnished)', async () => {
    expect(adminC.furnishingOptions.map((o) => o.value)).toEqual(['unfurnished', 'semi', 'furnished']);
  });

  test('amenities are sourced type-aware from the consumer catalog', async () => {
    for (const type of ['flat', 'independent', 'villa', 'pg', 'commercial', 'openplot', 'farmland']) {
      const expected = consumerC.amenitiesFor(type, 'office').map((a) => a.label);
      expect(adminC.amenitiesFor(type, 'office')).toEqual(expected);
    }
  });

  test('admin furnishing round-trips to a canonical key in the saved listing', async ({ page }) => {
    await page.goto(`${BASE}/staff-login`);
    await page.getByRole('button', { name: /Admin/i }).first().click();
    await page.waitForURL('**/admin');
    await page.goto(`${BASE}/admin/post-on-behalf`);

    await page.getByPlaceholder('Full name of the property owner').fill('Sync Furnish Owner');
    await page.getByPlaceholder('9876543210').fill('9600000123');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('900');
    // Set furnishing to "Semi-Furnished" — must persist as the canonical key 'semi'
    await page.getByRole('button', { name: 'Furnishing' }).click();
    await page.getByRole('option', { name: 'Semi-Furnished' }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('input[inputmode="numeric"]').first().fill('24000');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Send to Owner/i }).click();
    await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 5000 });

    const furnishing = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
      const l = (db.listings || []).find((x) => x.owner === 'Sync Furnish Owner');
      return l ? l.furnishing : null;
    });
    expect(furnishing).toBe('semi');
  });
});
