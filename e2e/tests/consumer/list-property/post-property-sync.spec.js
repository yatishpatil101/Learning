// @ts-check
import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { authHeaders, API } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch } from '../../../helpers/moderation.js';
import { pickPlaceholderLocality } from '../../../helpers/locality.js';
import * as consumerC from '../../../../frontend/src/pages/consumer/list-property/constants.js';
import * as adminC from '../../../../frontend/src/pages/admin/post-on-behalf/constants.js';
// Teardown rejects, not deletes: rejection is a producible product state.
const postedIds = new Set();

test.afterEach(async () => {
  if (!postedIds.size) return;
  const headers = await authHeaders(STAFF.rental);
  for (const id of postedIds) {
    await fetch(`${API}/properties/${id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup \u2014 synthetic post-on-behalf fixture' }),
    });
  }
  postedIds.clear();
});

test.describe('Post-property ↔ Post-on-behalf option sync', () => {
  test('the admin and consumer flows share option arrays, the property taxonomy and the furnishing keys', async () => {
    expect(adminC.floorOptions).toEqual(consumerC.floorOptions);
    expect(adminC.totalFloorsOptions).toEqual(consumerC.totalFloorsOptions);
    expect(adminC.localities).toEqual(consumerC.localities);
    expect(adminC.naStatusOptions).toEqual(consumerC.naStatusOptions);
    expect(adminC.otherRightsOptions).toEqual(consumerC.otherRightsOptions);
    expect(adminC.buyerEligibilityOptions).toEqual(consumerC.buyerEligibilityOptions);
    expect(adminC.typeOptions).toEqual(consumerC.PROPERTY_TYPES);
    // `''` is "nothing selected yet", which yields the canonical five without any retired subtype.
    expect(adminC.commercialSubtypeOptions('')).toEqual(consumerC.COMMERCIAL_SUBTYPES);
    expect(adminC.furnishingOptions.map((o) => o.value)).toEqual(['unfurnished', 'semi', 'furnished']);
  });

    test('admin furnishing round-trips to a canonical key in the saved listing', async ({ page, login, request }) => {
    await login.asAdmin();
    await page.goto('/admin/post-on-behalf');

    await page.getByPlaceholder('Full name of the property owner').fill('Sync Furnish Owner');
    await page.getByPlaceholder('9876543210').fill('9600000123');

    await page.getByRole('group', { name: 'Property type' }).getByRole('button', { name: 'Flat / Apartment' }).click();
    await page.getByRole('group', { name: 'BHK', exact: true }).getByRole('button', { name: '2 BHK' }).click();
    await page.getByPlaceholder('e.g. 850').fill('900');
    await page.getByRole('group', { name: 'Furnishing' }).getByRole('button', { name: 'Semi-Furnished' }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    await pickPlaceholderLocality(page, 'Baner');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('input[inputmode="numeric"]').first().fill('24000');
    await page.getByRole('button', { name: /Next/i }).click();

    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/admin/properties') && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: /Send to Owner/i }).click(),
    ]);
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    postedIds.add(id);
    await expect(page.getByRole('heading', { name: 'Listing created' })).toBeVisible({ timeout: 15000 });

    const confirmed = await fetch(`${API}/me/listings/${id}/confirm`, {
      method: 'POST', headers: await authHeaders('9600000123'),
    });
    expect(confirmed.status).toBe(204);
    const approved = await approveListingWithFetch(id, await authHeaders(STAFF.rental));
    expect(approved.status).toBe(200);

    const res = await fetch(`${API}/properties/${id}`, { headers: await authHeaders(ACTORS.admin) });
    expect(res.status).toBe(200);
    /* `semi-furnished`, not the browser's `semi`: a raw fetch sees the column verbatim, and the
       filters query this column with this word — which is what makes this a filter claim. */
    expect((await res.json()).furnishing).toBe('semi-furnished');
  });
});
