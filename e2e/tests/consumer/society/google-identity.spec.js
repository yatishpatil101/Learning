import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { PHOTO_PNG, uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { mintSociety, seedSocietyReviews } from '../../../helpers/liveSociety.js';
import { fillSociety, pickGoogleSociety, pickSocietyNotOnMaps, stubPlaceId, wizardSocietyInput } from '../../../helpers/places.js';
import { pickLocality } from '../../../helpers/locality.js';

// Society identity is the Google Place ID: a pick resolves to the society that place already has,
// offers nearby look-alikes before minting, and "Not on Google Maps" is the only way past without one.

const BASE = process.env.BASE_URL || 'http://localhost:5173';
// The stub's default pin, so every pick in this file lands at the same point.
const PIN = { lat: 18.5975, lng: 73.7701 };
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const owners = new Set();

test.afterEach(async () => {
  if (!owners.size) return;
  const admin = await authHeaders(ACTORS.admin);
  for (const mobile of owners) {
    const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
    if (res.status !== 200) continue;
    const body = await res.json();
    for (const row of Array.isArray(body) ? body : (body.content ?? [])) {
      await fetch(`${API}/properties/${row.id}/status`, {
        method: 'PATCH',
        headers: admin,
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup' }),
      });
    }
  }
  owners.clear();
});

const resolveByPlace = async (request, placeId, name) => {
  const res = await request.get(`${API}/societies/resolve`, { params: { placeId, name, ...PIN } });
  expect(res.status()).toBe(200);
  return res.json();
};

/** Records every society mint the page sends, so a test can assert none was made. */
function watchMints(page) {
  const mints = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/societies') mints.push(r.postDataJSON());
  });
  return mints;
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function pickFloor(page, value, label) {
  const field = page.locator('div').filter({ has: page.locator(`label:text-is("${label}")`) }).last();
  await field.locator('.dz-dropdown__trigger').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.getByRole('option', { name: value, exact: true }).click();
}

/** A fresh account on the wizard's Location step for a rented flat. */
async function toLocationStep(page) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await page.locator('input[data-err="carpetArea"]').fill('1150');
  await page.locator('div').filter({ has: page.locator('label:text-is("Parking Spaces")') }).last()
    .locator('.radio-pill').filter({ hasText: /^2$/ }).first().click();
  await pickFloor(page, '9', 'Floor No. *');
  await pickFloor(page, '14', 'Total Floors *');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickLocality(page, 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('A-702');
  await page.locator('input[data-err="pincode"]').fill('411045');
  return mobile;
}

async function submitFlat(page) {
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await page.locator('input[data-err="deposit"]').fill('60000');
  await page.locator('.radio-pill', { hasText: 'Included in Rent' }).click();
  await pickDate(page, '[data-err="availableFrom"]', inDays(120));
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & description/i', { timeout: 15000 });
  await uploadPublishablePhotos(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Submitted for review/i')).toBeVisible({ timeout: 30000 });
}

async function onlyListing(mobile) {
  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.content ?? []);
  expect(rows).toHaveLength(1);
  return rows[0];
}

test('a listing posted with a Google suggestion is bound to the society minted for that place, and a second user picking it binds the same one', async ({ page, browser, request }) => {
  test.slow();
  const name = `Zz Identity ${uniq()}`;

  const mintsA = watchMints(page);
  const first = await toLocationStep(page);
  await fillSociety(page, name);
  expect(mintsA).toHaveLength(1);
  expect(mintsA[0]).toMatchObject({ placeId: stubPlaceId(name), name });
  await submitFlat(page);

  const minted = (await resolveByPlace(request, stubPlaceId(name), name)).society;
  expect(minted, 'the pick did not mint a society for its place').toBeTruthy();
  expect((await onlyListing(first)).societyId).toBe(minted.id);

  const second = await (await browser.newContext({ baseURL: BASE })).newPage();
  const mintsB = watchMints(second);
  const secondMobile = await toLocationStep(second);
  await fillSociety(second, name);
  expect(mintsB, 'the same place must not be minted twice').toHaveLength(0);
  await submitFlat(second);

  expect((await onlyListing(secondMobile)).societyId).toBe(minted.id);
  const found = await request.get(`${API}/societies`, { params: { q: name, size: 20 } });
  expect((await found.json()).content.filter((s) => s.name === name)).toHaveLength(1);
  await second.close();
});

test('a different place with a similar name at the same pin asks "Is it one of these?", and choosing the candidate binds the existing society', async ({ page, request }) => {
  const name = `Zz Orchid ${uniq()} Heights`;
  const owner = await authHeaders(uniqueMobile());
  const seeded = await request.post(`${API}/societies`, {
    headers: owner,
    data: { placeId: stubPlaceId(name), name, localityLabel: 'Wakad', localitySlug: 'wakad', ...PIN },
  });
  expect(seeded.status()).toBe(201);
  const { id } = await seeded.json();

  const mints = watchMints(page);
  await toLocationStep(page);
  await pickGoogleSociety(page, name, { input: wizardSocietyInput(page), candidate: true, idPrefix: 'alt-' });
  await expect(page.getByTestId('society-candidate-option').filter({ hasText: name })).toBeVisible();
  await expect(page.getByTestId('society-not-listed-candidate')).toBeVisible();

  await page.getByTestId('society-candidate-option').filter({ hasText: name }).click();
  await expect(page.getByTestId('society-candidate-option')).toHaveCount(0);
  await expect(wizardSocietyInput(page)).toHaveValue(name);
  expect(mints, 'choosing a candidate must not mint').toHaveLength(0);
  const alt = await resolveByPlace(request, stubPlaceId(name, 'alt-'), name);
  expect(alt.society, 'the alternate place stayed unminted').toBeNull();
  expect((await resolveByPlace(request, stubPlaceId(name), name)).society.id).toBe(id);
});

test('answering "none of these" mints a separate society for the picked place', async ({ page, request }) => {
  const name = `Zz Lotus ${uniq()} Residency`;
  const owner = await authHeaders(uniqueMobile());
  const seeded = await request.post(`${API}/societies`, {
    headers: owner,
    data: { placeId: stubPlaceId(name), name, localityLabel: 'Wakad', localitySlug: 'wakad', ...PIN },
  });
  expect(seeded.status()).toBe(201);
  const { id } = await seeded.json();

  const mints = watchMints(page);
  await toLocationStep(page);
  await pickGoogleSociety(page, name, { input: wizardSocietyInput(page), idPrefix: 'alt-' });

  expect(mints).toHaveLength(1);
  expect(mints[0].placeId).toBe(stubPlaceId(name, 'alt-'));
  const alt = (await resolveByPlace(request, stubPlaceId(name, 'alt-'), name)).society;
  expect(alt, 'none of these should have minted the picked place').toBeTruthy();
  expect(alt.id).not.toBe(id);
});

test('"Not on Google Maps" lets the wizard continue with no society, and typed text is not accepted', async ({ page }) => {
  const mints = watchMints(page);
  await toLocationStep(page);
  const society = wizardSocietyInput(page);

  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(society).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('text=/Price & terms/i')).toHaveCount(0);

  await society.click();
  await society.fill(`Zz Typed ${uniq()}`);
  await society.blur();
  await expect(society).toHaveValue('');

  await pickSocietyNotOnMaps(page, society);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.locator('text=/Price & terms/i')).toBeVisible({ timeout: 15000 });
  expect(mints).toHaveLength(0);
});

test('the flatmate room wizard takes its society from the same Google picker', async ({ page, request }) => {
  const name = `Zz Room ${uniq()} Heights`;
  const mints = watchMints(page);
  await signedInAsNew(page);
  await page.goto(`${BASE}/list-property?flatmate=1`);
  await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
  await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Double sharing (up to 2)' }).click();
  await page.getByText('I have a registered rent agreement', { exact: true }).click();
  await page.getByLabel('Upload registered rent agreement for room').setInputFiles({
    name: 'agreement.png', mimeType: 'image/png', buffer: PHOTO_PNG,
  });
  await page.getByLabel('The owner knows and agrees to sharing').check();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await pickLocality(page, 'Baner');

  await wizardSocietyInput(page).click();
  await expect(page.getByTestId('society-not-on-maps'), 'nothing is offered before the owner types').toHaveCount(0);
  await fillSociety(page, name);
  expect(mints).toHaveLength(1);
  expect(mints[0]).toMatchObject({ placeId: stubPlaceId(name), name });
  expect((await resolveByPlace(request, stubPlaceId(name), name)).society?.name).toBe(name);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.getByText('Rent & move-in', { exact: true })).toBeVisible();
});

test('the society hub offers its Reviews tab from three reviews, while the Review button is always there', async ({ page, request }) => {
  const slug = await mintSociety(request, uniqueMobile(), 'identityreviews');
  await seedSocietyReviews(request, slug, 2);
  const tab = page.getByRole('tab', { name: /Reviews/ });

  await page.goto(`${BASE}/society/${slug}?tab=reviews`);
  await expect(page.getByText('(2)', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(tab).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeVisible();

  await seedSocietyReviews(request, slug, 1);
  await page.reload();
  await expect(page.getByText('(3)', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(tab).toBeVisible();
});
