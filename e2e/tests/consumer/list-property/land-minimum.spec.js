/* Four minimum-effort land walks, driven through the wizard rather than the API on purpose: the claim is
 * about what the form lets an owner submit, which an API post cannot prove. A NEW owner per listing.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';

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
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup — synthetic land fixture' }),
      });
    }
  }
  owners.clear();
});

// `Select.jsx` portals its menu and flips `portalOpen` a frame late; until `.is-portal-open` lands
// the menu is `pointer-events: none`.
const menuOpen = (page) => expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

const nextStep = (page) => page.getByRole('button', { name: /Next Step/i }).click();
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function gotoForm(page, { deal = 'buy', type } = {}) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  if (deal === 'rent') await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  if (type) await pickOption(page, 'propertyType', type);
  return mobile;
}

/* Deliberately the least the wizard accepts. `Deemed NA` rather than a sanctioned order, which is the one land
   claim needing a document — a minimum-effort walk would then be proving the upload gate instead. */
async function fillLandStep1(page, { type, deal, area }) {
  await page.locator('input[data-err="carpetArea"]').fill(area);
  await pickOption(page, 'naStatus', 'Deemed NA');
  await pickOption(page, 'otherRights', 'Clear');
  if (type === 'Farm Land' && deal === 'buy') await pickOption(page, 'buyerEligibility', 'Agriculturist buyer only');
}

// Locality and PIN only. The project / layout box is left blank on purpose: that is the claim.
async function fillLocation(page) {
  await nextStep(page);
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="pincode"]').fill('411045');
}

async function fillPricing(page, deal, { possession } = {}) {
  await nextStep(page);
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  if (deal === 'rent') {
    await page.locator('input[data-err="monthlyRent"]').fill('18000');
    await page.locator('input[data-err="deposit"]').fill('108000');
    await pickDate(page, '[data-err="availableFrom"]', inDays(30));
  } else {
    await page.locator('input[data-err="price"]').fill('6500000');
    await pickOption(page, 'ownership', 'Freehold');
    // Land has no possession block at all, so only a built property can answer this.
    if (possession) await page.locator('[data-err="possession"]').getByText(possession, { exact: true }).click();
  }
  await nextStep(page);
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });
}

const submitted = (page) => page.waitForResponse((res) => res.request().method() === 'POST'
  && new URL(res.url()).pathname === '/api/me/listings');

/* A parcel publishes on where its edges run and what the layout sanctions, so the two key
   categories a land listing must cover are the same for both types. */
const LAND_KEY_PHOTOS = ['Layout Plan', 'Road / Access'];

const PROFILES = {
  'Open Plot': { area: '2400', unit: 'sqft' },
  'Farm Land': { area: '20', unit: 'guntha' },
};

for (const [type, profile] of Object.entries(PROFILES)) {
  for (const deal of ['buy', 'rent']) {
    test(`a ${deal} ${type} publishes without naming a project or layout`, async ({ page }) => {
      await gotoForm(page, { deal, type });
      await fillLandStep1(page, { type, deal, area: profile.area });
      await fillLocation(page);
      await expect(page.locator('input[data-err="society"]')).toHaveValue('');
      await fillPricing(page, deal);
      await uploadPublishablePhotos(page, { categories: LAND_KEY_PHOTOS });

      const posted = submitted(page);
      await page.getByRole('button', { name: /Submit Property/i }).click();
      const response = await posted;
      expect(response.status(), await response.text()).toBe(201);

      const body = response.request().postDataJSON();
      expect(body.formDetails.society ?? '').toBe('');
      /* The parcel is quoted in the unit the owner chose and posted as `area` alone: `carpetArea`
         is a square-foot carpet figure, which a plot does not have. */
      expect(body.areaUnit).toBe(profile.unit);
      expect(body.area).toBe(Number(profile.area));
      expect(body.carpetArea).toBeFalsy();
    });
  }
}

test('switching a flat to a plot posts neither its possession nor its age', async ({ page }) => {
  const ageField = page.locator('div').filter({ has: page.locator('label:text-is("Age of Property")') }).last();
  await gotoForm(page, { type: 'Flat / Apartment' });
  await page.locator('input[data-err="carpetArea"]').fill('1150');
  await ageField.locator('.dz-dropdown__trigger').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: '5 - 10 years' }).first().click();
  for (const [key, storey] of [['floor', '9'], ['totalFloors', '14']]) {
    await page.locator(`[data-err="${key}"] .dz-dropdown__trigger`).click();
    await menuOpen(page);
    await page.getByRole('option', { name: storey, exact: true }).click();
  }

  await fillLocation(page);
  await page.locator('input[data-err="flatNumber"]').fill('B-904');
  await page.locator('input[data-err="society"]').fill('Zztest Baner Heights');
  await fillPricing(page, 'buy', { possession: 'Ready to Move' });

  // Back to the type and relabel the same answers as a plot.
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('[data-err="propertyType"]')).toBeVisible();
  await pickOption(page, 'propertyType', 'Open Plot');
  await expect(ageField).toHaveCount(0);

  await fillLandStep1(page, { type: 'Open Plot', deal: 'buy', area: '2400' });
  await fillLocation(page);
  await fillPricing(page, 'buy');
  await uploadPublishablePhotos(page, { categories: LAND_KEY_PHOTOS });

  const posted = submitted(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  const response = await posted;
  expect(response.status(), await response.text()).toBe(201);

  const body = response.request().postDataJSON();
  expect(body.possession).toBeFalsy();
  expect(body.ageYears ?? null).toBeNull();
});

test('a farm is not asked for a length and width in feet', async ({ page }) => {
  await gotoForm(page, { type: 'Open Plot' });
  await expect(page.locator('label', { hasText: 'Plot Length' })).toHaveCount(1);

  await pickOption(page, 'propertyType', 'Farm Land');
  await expect(page.locator('label', { hasText: 'Land Area' })).toHaveCount(1);
  await expect(page.locator('label', { hasText: 'Plot Length' })).toHaveCount(0);
  await expect(page.locator('label', { hasText: 'Plot Width' })).toHaveCount(0);
});

test('the strength meter does not dock a land sale for having no MahaRERA number', async ({ page }) => {
  await gotoForm(page);
  const scores = await page.evaluate(async () => {
    const { computeProgress } = await import('/src/pages/consumer/list-property/progress.js');
    const form = {
      deal: 'buy', propertyType: 'openplot', areaUnit: 'sqft', carpetArea: '2400',
      locality: 'Wagholi', pincode: '412207', price: '6500000', ownership: 'Freehold',
      naStatus: 'deemed', otherRights: 'clear',
    };
    return {
      blank: computeProgress({ form, photos: [], documents: {} }).pct,
      quoted: computeProgress({ form: { ...form, reraId: 'P52100000001' }, photos: [], documents: {} }).pct,
      flatBlank: computeProgress({ form: { ...form, propertyType: 'flat' }, photos: [], documents: {} }).pct,
      flatQuoted: computeProgress({ form: { ...form, propertyType: 'flat', reraId: 'P52100000001' }, photos: [], documents: {} }).pct,
    };
  });
  expect(scores.blank).toBe(scores.quoted);
  // The row is still scored where it is genuinely expected, so the land case is a carve-out.
  expect(scores.flatQuoted).toBeGreaterThan(scores.flatBlank);
});
