// @ts-check

/**
 * Post-property and post-on-behalf must stay one taxonomy: a value canonical in the browser and
 * something else in Postgres is a listing no filter can find.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API } from '../../../helpers/liveAuth.js';
import * as consumerC from '../../../../frontend/src/pages/consumer/list-property/constants.js';
import * as adminC from '../../../../frontend/src/pages/admin/post-on-behalf/constants.js';

/**
 * Rejected rather than deleted in teardown: there is no delete route, and rejection leaves the
 * database in a shape the product can actually produce.
 */
const postedIds = new Set();

test.afterEach(async () => {
  if (!postedIds.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of postedIds) {
    await fetch(`${API}/properties/${id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup \u2014 synthetic post-on-behalf fixture' }),
    });
  }
  postedIds.clear();
});

/**
 * The consumer flow is the single source of truth; the admin wizard must expose identical option
 * sets so a listing created either way is discoverable under the same filters.
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
    // `''` is "nothing selected yet", which yields the canonical five without any retired subtype.
    expect(adminC.commercialSubtypeOptions('')).toEqual(consumerC.COMMERCIAL_SUBTYPES);
  });

  test('furnishing values are the canonical keys (unfurnished/semi/furnished)', async () => {
    expect(adminC.furnishingOptions.map((o) => o.value)).toEqual(['unfurnished', 'semi', 'furnished']);
  });

  test('amenities are sourced type-aware from the consumer catalog', async () => {
    for (const type of ['flat', 'independent', 'villa', 'commercial', 'openplot', 'farmland']) {
      const expected = consumerC.amenitiesFor(type, 'office').map((a) => a.label);
      expect(adminC.amenitiesFor(type, 'office')).toEqual(expected);
    }
  });

  test('commercial profile options and authored answers match the consumer flow', async () => {
    expect(adminC.suitableForFor('warehouse')).toEqual(consumerC.suitableForFor('warehouse'));
    expect(adminC.fixturesFor('office')).toEqual(consumerC.fixturesFor('office'));
    expect(adminC.commercialProfileOf('')).toBeNull();
    expect(adminC.INITIAL_FORM).not.toHaveProperty('powerBackup');
  });

  /**
   * `Select` flips `portalOpen` a frame after opening; clicking inside that window fails as "not
   * stable" then "detached from the DOM", which reads like a missing option rather than a race.
   */
  async function pick(page, opener, option) {
    await opener.click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.getByRole('option', { name: option }).click();
  }

  test('admin furnishing round-trips to a canonical key in the saved listing', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/post-on-behalf');

    await page.getByPlaceholder('Full name of the property owner').fill('Sync Furnish Owner');
    await page.getByPlaceholder('9876543210').fill('9600000123');
    await page.getByRole('button', { name: /Next/i }).click();

    await pick(page, page.getByText('Select type'), /Apartment/i);
    await pick(page, page.getByText('Select BHK'), /2 BHK/i);
    await page.getByPlaceholder('e.g. 850').fill('900');
    // Set furnishing to "Semi-Furnished" — the level the two vocabularies spell differently.
    await pick(page, page.getByRole('button', { name: 'Furnishing' }), 'Semi-Furnished');
    await page.getByRole('button', { name: /Next/i }).click();

    await pick(page, page.getByText('Select locality'), /Baner/i);
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('input[inputmode="numeric"]').first().fill('24000');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    /* Wait on the write, not on the confirmation heading: the heading renders from local state and would show
       even if the request had failed, and the response is also where the id comes from. */
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/properties') && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: /Send to Owner/i }).click(),
    ]);
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    postedIds.add(id);
    await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

    /* Moderate before reading: `GET /properties/{id}` answers 404 for anything not approved, so an unmoderated
       row would fail as a 404 rather than as a furnishing mismatch — the wrong diagnosis. */
    const approved = await fetch(`${API}/properties/${id}/status`, {
      method: 'PATCH',
      headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(approved.status).toBe(200);

    // Re-read the stored row: this is the column the discovery filters query.
    const res = await fetch(`${API}/properties/${id}`, { headers: await authHeaders(ACTORS.admin) });
    expect(res.status).toBe(200);
    /* `semi-furnished`, not the browser's `semi`: a raw fetch sees the column verbatim, and the
       filters query this column with this word — which is what makes this a filter claim. */
    expect((await res.json()).furnishing).toBe('semi-furnished');
  });
});
