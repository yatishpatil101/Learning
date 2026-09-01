import { test, expect } from '@playwright/test';
import { pickDate } from '../../../helpers/datePicker.helper.js';

/**
 * D219 — the owner listing wizard writes through the property seam.
 *
 * Until this slice `persistListing` wrote straight to localStorage and never touched `services/`.
 * That mattered for one reason above all the others: the server's duplicate detector runs inside
 * `POST /me/listings`, so a wizard that never issued that request was a detector no owner could
 * ever reach. The only caller was admin post-on-behalf — a desk of five people — while the abuse
 * the detector exists to catch (one flat listed twice, by two "owners") arrives through this form.
 *
 * These tests run on the mock provider, like the rest of the default suite. That is not a
 * compromise: the mock provider is fed the *same object* the http provider hands to
 * `toListingCreate`, so the payload the seam receives is observable here without a backend. What
 * is asserted is therefore the thing that regresses silently — that the wizard still assembles the
 * fields the contract needs, in the shape it needs them. A page that quietly went back to writing
 * its own record would still show "Listed Successfully"; only the payload tells you which code ran.
 *
 * The photo half of D219 is deliberately NOT asserted here. In mock mode `uploadPhoto` returns a
 * base64 `data:` URL, and the wizard drops those from the gallery on purpose (a handful of them is
 * megabytes of localStorage — the write would blow the quota and lose the listing, not just the
 * pictures). Real photo URLs only exist against a real photo provider, which is what
 * `live-fees-and-photos.spec.js` covers.
 */

const MOBILE = '9876543210';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function seedOwner(page) {
  return page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

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
  await seedOwner(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-meter', { timeout: 10000 });

  // Step 1 — a rent flat, because rent asks for the fewest gating answers and the duplicate
  // signals are identical either way.
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1150');
  // The floor is one of the three legs of the (society, floor, bhk) signal, and the one the wizard
  // holds as a *string* — "Ground" is not a number, which is why the mapper guards it.
  await pickFloor(page, '9');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });

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
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 10000 });

  // Step 3 — one photo and the ownership proof a rent listing asks for.
  const buf = Buffer.from(PNG, 'base64');
  await page.locator('input[type="file"][accept="image/*"]').first()
    .setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: buf });
  await page.locator('input[type="file"][accept="image/*,.pdf"]').first()
    .setInputFiles({ name: 'doc.png', mimeType: 'image/png', buffer: buf });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 15000 });
}

/** The row the provider stored — i.e. what the seam was actually handed. */
function savedRow(page, society) {
  return page.evaluate((soc) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    return (db.listings || []).find((l) => l.real && l.society === soc) || null;
  }, society);
}

test('the wizard hands the seam an address the duplicate detector can key on', async ({ page }) => {
  await postAFlat(page, { flat: 'A-902', society: 'Rohan Nilay', meter: '180012345678' });

  const row = await savedRow(page, 'Rohan Nilay');
  expect(row).not.toBeNull();

  /* The wizard collects the address in five boxes and the contract takes one line. The unit token
     is the part that matters: "Rohan Nilay, Baner" names a building, and every flat inside it would
     normalise to the same AddressKey — a detector that flags a whole tower is a detector nobody can
     act on. Assert the flat number is in there, ahead of the society. */
  expect(row.address).toContain('A-902');
  expect(row.address).toContain('Rohan Nilay');
  expect(row.address.indexOf('A-902')).toBeLessThan(row.address.indexOf('Rohan Nilay'));
});

test('the wizard lifts the fields whose names the contract does not share', async ({ page }) => {
  await postAFlat(page, { flat: 'B-1104', society: 'Kumar Prospera', meter: '180099887766' });

  const row = await savedRow(page, 'Kumar Prospera');
  expect(row).not.toBeNull();

  /* Each of these had a different name on the record than on the wire, and a name mismatch on a
     write does not fail — it drops the value in silence. The meter is the strongest duplicate
     signal there is (two listings sharing one meter are one flat), so losing it to a spelling
     would have disabled the detector while every test still passed. */
  expect(row.electricityConsumerNo).toBe('180099887766');
  // `floor` is picked as the string "9" and must arrive as a number, not NaN and not 0.
  expect(row.floor).toBe(9);
  // The record calls RERA `rera`; the contract calls it `reraId`. Empty here, but present — an
  // absent key is how a field stops being sent at all.
  expect(row).toHaveProperty('reraId');
  // The wizard splits maintenance by deal (`monthlyMaintenance` for sale, `rentMaintenance` behind
  // the "Charged Extra" toggle for rent); the entity has one column.
  expect(row.maintenance).toBe(2500);
});
