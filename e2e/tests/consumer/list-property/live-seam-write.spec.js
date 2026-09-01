/**
 * D219 — the owner listing wizard writes through the property seam, checked against the server.
 *
 * Converted from `seam-write.spec.js`. The original said outright why it settled for the mock: the
 * mock provider is handed the same object the http provider passes to `toListingCreate`, so the
 * payload was observable without a backend. That was a fair proxy and it is no longer necessary.
 * Here the listing is posted through the wizard and then read back from `GET /me/listings`, so the
 * fields are asserted after a round trip through the DTO, the entity and Postgres.
 *
 * That is the difference worth naming. The duplicate detector does not read the object the seam was
 * handed; it reads the columns `ListingDuplicateProbe` queries. A field that reached the provider
 * but was dropped by the mapper, or silently truncated by its column, passed the mock version of
 * this file and would still have left the detector blind. The meter number is the case that matters
 * most — two listings sharing one meter are one flat — and it is the one this can now prove landed.
 *
 * `electricityMeterNo` is owner-and-staff-only on the response (PropertyResponse), so the read has
 * to be made with the posting owner's own token; an anonymous read would find the field absent and
 * the assertion would be about permissions rather than persistence.
 *
 * Each test posts from a brand-new account, so `GET /me/listings` returns exactly the listing the
 * test just made and there is nothing to search for. The free tier allows one listing, which is why
 * one account cannot serve both tests.
 *
 * The photo half of D219 stays out of scope here, as it was before: `live-fees-and-photos.spec.js`
 * owns the claim that real photo URLs reach the gallery.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * The owners this file minted, so their listings can be taken back out of the catalogue.
 *
 * Tracked by mobile rather than by listing id because the id is only known once `savedRow` has run,
 * and a test that fails before then would otherwise leave its listing behind. Teardown rejects
 * rather than deletes: there is no delete route, and rejection is the state the moderation desk
 * itself uses to withdraw a listing, so the database is left in a shape the product can produce.
 */
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
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup \u2014 synthetic seam-write fixture' }),
      });
    }
  }
  owners.clear();
});

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

/* The floor Select carries no `data-err` (it is optional, so nothing ever binds an error to it),
   so anchor on its label instead. `.last()` picks the innermost matching div — the field wrapper
   rather than the grid or the step around it. */
async function pickFloor(page, value) {
  const field = page.locator('div').filter({ has: page.locator('label:text-is("Floor No.")') }).last();
  await field.locator('.pn-dropdown__trigger').click();
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  await page.getByRole('option', { name: value, exact: true }).click();
}

/** Post one rent flat, filling every field the duplicate detector is built out of. */
async function postAFlat(page, { flat, society, meter }) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  /* `.lp-steps` rather than `.lp-meter`: the meter renders on the listing-limit paywall too, and a
     paywalled account would have sailed past that wait and failed later on a missing field. */
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  // Step 1 — a rent flat, because rent asks for the fewest gating answers and the duplicate
  // signals are identical either way.
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1150');
  /* Parking is a residential question for the first time in D244 — before it, the only control was
     on the commercial branch, so the Parking tile on every flat's detail page rendered an em dash
     no matter what the owner would have said. Scoped by its own label because "2" is also a
     bathrooms pill and a balconies pill on this same step. */
  await page.locator('div').filter({ has: page.locator('label:text-is("Parking Spaces")') }).last()
    .locator('.radio-pill').filter({ hasText: /^2$/ }).first().click();
  // The floor is one of the three legs of the (society, floor, bhk) signal, and the one the wizard
  // holds as a *string* — "Ground" is not a number, which is why the mapper guards it.
  await pickFloor(page, '9');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  // Step 2 — location, rent pricing, and the meter number.
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill(flat);
  await page.locator('input[data-err="society"]').fill(society);
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await page.locator('input[data-err="deposit"]').fill('60000');
  await page.locator('.radio-pill', { hasText: 'Charged Extra' }).click();
  await page.locator('input[placeholder="e.g. 2,500"]').fill('2500');
  // The meter box is optional, so like the floor Select it has no `data-err`; its placeholder is
  // the stable handle.
  await page.getByPlaceholder(/MSEDCL electricity bill/i).fill(meter);
  await pickDate(page, '[data-err="availableFrom"]', '2025-12-31');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });

  // Step 3 — one photo and the ownership proof a rent listing asks for.
  const buf = Buffer.from(PNG, 'base64');
  await page.locator('input[type="file"][accept="image/*"]').first()
    .setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: buf });
  await page.locator('input[type="file"][accept="image/*,.pdf"]').first()
    .setInputFiles({ name: 'doc.png', mimeType: 'image/png', buffer: buf });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });
  return mobile;
}

/** The row the server stored — i.e. what the seam actually persisted. */
async function savedRow(mobile) {
  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
  // A fresh account posts one listing and the free tier allows one, so this is unambiguous.
  expect(rows).toHaveLength(1);
  return rows[0];
}

test('the wizard hands the seam an address the duplicate detector can key on', async ({ page }) => {
  const mobile = await postAFlat(page, { flat: 'A-902', society: 'Rohan Nilay', meter: '180012345678' });

  const row = await savedRow(mobile);

  /* The wizard collects the address in five boxes and the contract takes one line. The unit token
     is the part that matters: "Rohan Nilay, Baner" names a building, and every flat inside it would
     normalise to the same AddressKey — a detector that flags a whole tower is a detector nobody can
     act on. Assert the flat number is in there, ahead of the society. */
  expect(row.address).toContain('A-902');
  expect(row.address).toContain('Rohan Nilay');
  expect(row.address.indexOf('A-902')).toBeLessThan(row.address.indexOf('Rohan Nilay'));
});

test('the wizard lifts the fields whose names the contract does not share', async ({ page }) => {
  const mobile = await postAFlat(page, { flat: 'B-1104', society: 'Kumar Prospera', meter: '180099887766' });

  const row = await savedRow(mobile);

  /* Each of these had a different name on the record than on the wire, and a name mismatch on a
     write does not fail — it drops the value in silence. The meter is the strongest duplicate
     signal there is (two listings sharing one meter are one flat), so losing it to a spelling
     would have disabled the detector while every test still passed. */
  expect(row.electricityMeterNo).toBe('180099887766');
  // `floor` is picked as the string "9" and must arrive as a number, not NaN and not 0.
  expect(row.floor).toBe(9);
  // The record calls RERA `rera`; the contract calls it `reraId`. Empty here, but present — an
  // absent key is how a field stops being sent at all.
  expect(row).toHaveProperty('reraId');
  // The wizard splits maintenance by deal (`monthlyMaintenance` for sale, `rentMaintenance` behind
  // the "Charged Extra" toggle for rent); the entity has one column.
  expect(row.maintenance).toBe(2500);

  /* D244. `bathrooms` was the sharpest case of the same class: the step above collects it and
     defaults it to 2, and the builder in `submit.js` simply never put it on the record — the name
     did not appear in that file at all. So the answer was taken from the owner, discarded before
     the seam, and then re-invented on the detail page as `bhk - 1`. Asserting the default rather
     than a clicked value is deliberate: a default is exactly what a dropped field looks like from
     the outside, and only a read-back tells them apart. */
  expect(row.bathrooms).toBe(2);
  expect(row.balconies).toBe(1);
  // The residential parking control is new in D244; before it, this column could only ever be null
  // for a flat because the only input for it was on the commercial branch of the same step.
  expect(row.parking).toBe(2);
});
