// @ts-check
/**
 * Post-property and post-on-behalf must stay one taxonomy — checked against the server.
 *
 * Converted from `post-property-sync.spec.js`. The first four tests are unchanged and could not be
 * otherwise: they import both `constants.js` modules directly and compare the arrays, which is a
 * claim about source files and has no runtime, no page and no provider. Reading them from the
 * server would in fact weaken them, because the drift they exist to catch happens when someone
 * re-declares an option array in the admin flow, and that is visible only in the modules.
 *
 * The fifth test is the one that moves. It posts a listing through the admin wizard and then asks
 * what furnishing value was stored. The mock version read the browser catalogue, which meant it
 * proved the label "Semi-Furnished" had been normalised to `semi` before the write — but not that
 * `semi` was what the column ended up holding. It was not: the server's vocabulary spells that
 * level `semi-furnished`, and the two only ever agreed because `unfurnished` and `furnished` happen
 * to be spelled the same on both sides. Filters query that column, so a value that was canonical in
 * the browser and something else in Postgres is a listing nobody can find, and the old assertion
 * would have passed straight through it. Here the row is re-read from `GET /properties/{id}` as the
 * admin who created it, so the key is asserted where the filters actually look.
 *
 * `POST /admin/properties` is exempt from the freemium cap, which is why the owner's mobile can be a
 * fixed number rather than a fresh one — the desk is allowed to post past the ceiling.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API } from '../../../helpers/liveAuth.js';
import * as consumerC from '../../../../frontend/src/pages/consumer/list-property/constants.js';
import * as adminC from '../../../../frontend/src/pages/admin/post-on-behalf/constants.js';

/**
 * Listings this file put into the catalogue. Rejected rather than deleted in teardown: there is no
 * delete route, and rejection is the state the moderation desk itself uses to take a listing out of
 * public view, so it leaves the database in a shape the product can actually produce.
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

  /**
   * Open a `Select` and choose an option, waiting for the portal to settle first.
   *
   * `Select` renders its menu through a portal and only flips `portalOpen` one requestAnimationFrame
   * after the open (Select.jsx:178); until then the menu is `opacity: 0; pointer-events: none`
   * (dropdown.css:198). Clicking an option in that window resolves the locator against a node that
   * is still animating, and Playwright reports "element is not stable" and then "detached from the
   * DOM" — a failure that reads like a missing option rather than a race.
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

    /* Wait on the write rather than on the confirmation heading. The heading renders from local
       state and would show even if the request had failed, and the response is also where the id
       comes from — the desk never puts it on screen. */
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

    /* Moderate before reading. `GET /properties/{id}` is the public detail route and answers 404
       for anything not approved (PropertyController:119), so an unmoderated row would fail here as
       a 404 rather than as a furnishing mismatch — the wrong diagnosis for the right test. */
    const approved = await fetch(`${API}/properties/${id}/status`, {
      method: 'PATCH',
      headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(approved.status).toBe(200);

    // Re-read the stored row: this is the column the discovery filters query.
    const res = await fetch(`${API}/properties/${id}`, { headers: await authHeaders(ACTORS.admin) });
    expect(res.status).toBe(200);
    /* `semi-furnished`, not the browser's `semi`. This read is a raw fetch, so it sees the column
       verbatim, and the column's vocabulary is the contract's (Furnishing.SEMI_FURNISHED, enforced
       by the V3 CHECK). The browser calls the same level `semi`; propertyMapper translates between
       the two. Asserting the wire spelling here is what makes this test a filter claim — the
       filters query this column, and they query it with this word. */
    expect((await res.json()).furnishing).toBe('semi-furnished');
  });
});
