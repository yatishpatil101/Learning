// Owner-authenticated reads prove duplicate signals survive the mapper and database;
// anonymous responses intentionally withhold the electricity meter number.
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';
import { PHOTO_PNG, uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { approveListingWithFetch } from '../../../helpers/moderation.js';
import { openBadgeVault, uploadBadgeProof } from '../../../helpers/badgeVault.js';
import { createRequire } from 'node:module';
import { fillSociety } from '../../../helpers/places.js';
import { pickLocality } from '../../../helpers/locality.js';

const requireFrontend = createRequire(new URL('../../../../frontend/package.json', import.meta.url));
const { PDFDocument, PDFName } = requireFrontend('pdf-lib');
// Track owners before submission so teardown can withdraw listings even after a mid-flow failure.
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
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function pickFloor(page, value, label = 'Floor No. *') {
  const field = page.locator('div').filter({ has: page.locator(`label:text-is("${label}")`) }).last();
  await field.locator('.dz-dropdown__trigger').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.getByRole('option', { name: value, exact: true }).click();
}
/* Both date fields are bounded at today, so a literal is a fixture with an expiry date: the calendar
   day renders `disabled` once the date passes and the click waits out its whole timeout. */

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function postAFlat(page, { flat, society, deal = 'rent', furniture = [], agreementDuration = '', monthlyMaintenance = '', priceNegotiable = false, loanAvailable = true, bhk = '2', construction = '', preferredTenants = [], superBuiltUp = '', availableFrom = inDays(120), petsPolicy = '', rentMaintMode = 'extra' }) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  await page.locator('.radio-pill', { hasText: deal === 'rent' ? 'Rent' : 'Sale' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  if (bhk === '0') await page.getByRole('button', { name: '1 RK', exact: true }).click();
  else await page.locator('[data-err="bhk"]').getByRole('button', { name: bhk, exact: true }).click();
  if (furniture.length) {
    await page.locator('.radio-pill').filter({ hasText: /^Furnished$/ }).click();
    for (const item of furniture) await page.locator('.furn-tile', { hasText: item }).click();
  }
  await page.locator('input[data-err="carpetArea"]').fill('1150');
  if (superBuiltUp) await page.locator('input[data-err="superBuiltUp"]').fill(superBuiltUp);
  // Scope by label because bathrooms and balconies also offer a "2" pill.
  await page.locator('div').filter({ has: page.locator('label:text-is("Parking Spaces")') }).last()
    .locator('.radio-pill').filter({ hasText: /^2$/ }).first().click();
  // The string-valued floor must survive numeric mapping for the society/floor/BHK duplicate signal.
  await pickFloor(page, '9');
  await pickFloor(page, '14', 'Total Floors *');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  // A verification identifier must not interrupt the location/pricing step.
  await expect(page.getByPlaceholder(/MSEDCL electricity bill/i)).toHaveCount(0);
  await pickLocality(page, 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill(flat);
  await fillSociety(page, society);
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  if (deal === 'rent') {
    await page.locator('input[data-err="monthlyRent"]').fill('30000');
    await page.locator('input[data-err="deposit"]').fill('60000');
    if (rentMaintMode === 'extra') {
      await page.locator('.radio-pill', { hasText: 'Charged Extra' }).click();
      await page.locator('input[placeholder="e.g. 2,500"]').fill('2500');
    } else if (rentMaintMode) {
      await page.locator('.radio-pill', { hasText: 'Included in Rent' }).click();
    }
    if (petsPolicy) await page.locator('[data-err="petsPolicy"]').getByRole('button', { name: petsPolicy, exact: true }).click();
    await pickDate(page, '[data-err="availableFrom"]', availableFrom);
    for (const tenant of preferredTenants) await page.getByRole('button', { name: tenant, exact: true }).click();
    if (agreementDuration) {
      await page.locator('[data-testid="lp-rental-terms"]').getByRole('button', { name: 'Change rental terms', exact: true }).click();
      await page.getByText('Agreement Duration', { exact: true }).locator('..').locator('.dz-dropdown__trigger').click();
      await page.getByRole('option', { name: agreementDuration, exact: true }).click();
    }
  } else {
    await page.locator('input[data-err="price"]').fill('9500000');
    await pickOption(page, 'ownership', 'Freehold');
    if (monthlyMaintenance) await page.locator('input[placeholder="e.g. 3,500"]').fill(monthlyMaintenance);
    if (priceNegotiable) await page.getByRole('switch', { name: 'Negotiable', exact: true }).click();
    await page.locator('[data-err="loanAvailable"]').getByRole('button', { name: loanAvailable ? 'Yes' : 'No', exact: true }).click();
    if (construction) {
      await page.getByRole('button', { name: construction, exact: true }).click();
      if (construction !== 'Ready to Move') {
        await pickDate(page, '[data-err="availableFrom"]', inDays(540));
      }
    } else {
      await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & description/i', { timeout: 15000 });

  await uploadPublishablePhotos(page);

  await expect(page.getByRole('heading', { name: 'Get the Verified property badge', exact: true })).toHaveCount(0);
  await expect(page.locator('.doc-upload')).toHaveCount(0);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Submitted for review/i')).toBeVisible({ timeout: 30000 });
  return mobile;
}

async function savedRow(mobile) {
  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
  // A fresh account posts one listing and the free tier allows one, so this is unambiguous.
  expect(rows).toHaveLength(1);
  const stored = await fetch(`${API}/me/listings/${rows[0].id}`, { headers: await authHeaders(mobile) });
  expect(stored.status).toBe(200);
  return stored.json();
}

test('a rental post reaches the seam, the vault, the public read, the facets and the detail page', async ({ page }) => {
  test.slow();
  const mobile = await postAFlat(page, {
    flat: 'A-902', society: 'Rohan Nilay',
    furniture: ['TV'], agreementDuration: '24 months',
    preferredTenants: ['Bachelor (Male)'], superBuiltUp: '1400', availableFrom: inDays(10), petsPolicy: 'Allowed',
  });
  const row = await savedRow(mobile);

  await test.step('the wizard hands the seam an address the duplicate detector can key on', async () => {
    // The unit must precede the society so address matching identifies a flat rather than a tower.
    expect(row.address).toContain('A-902');
    expect(row.address).toContain('Rohan Nilay');
    expect(row.address.indexOf('A-902')).toBeLessThan(row.address.indexOf('Rohan Nilay'));
  });

  await test.step('the owner\'s furniture, agreement duration, tenants, area, move-in date and pet answer are stored', async () => {
    expect(row.formDetails.furniture).toEqual(['TV']);
    expect(row.formDetails.agreementDuration).toBe('24');
    expect(row.tenants).toEqual(['bachelor-male']);
    expect(Number(row.superBuiltUpArea)).toBe(1400);
    expect(row.availableFrom).toBe('15');
    expect(row.pets).toBe(true);
    expect(row.ownershipVerified).toBe(false);
  });

  await test.step('a small signature-bearing PDF uploaded in the vault is stored byte-for-byte without a re-save', async () => {
    const issued = await signedPdf();
    expect(issued.length).toBeLessThan(1_000_000);
    const card = await openBadgeVault(page, row.id);
    await uploadBadgeProof(page, card, 'Electricity Bill', { name: 'msedcl-signed.pdf', mimeType: 'application/pdf', buffer: issued });
    const listed = await fetch(`${API}/me/documents/${row.id}`, { headers: await authHeaders(mobile) });
    expect(listed.status).toBe(200);
    const documents = await listed.json();
    expect(documents).toHaveLength(1);
    // The sniffed type, not the browser's claim: the vault persists what it proved the bytes were.
    expect(documents[0]).toMatchObject({ fileName: 'msedcl-signed.pdf', mimeType: 'application/pdf' });
    expect(documents[0].sizeBytes).toBe(issued.length);

    const signed = await fetch(`${API}/me/documents/${documents[0].id}/url`, { headers: await authHeaders(mobile) });
    expect(signed.status).toBe(200);
    const stored = await fetch(new URL((await signed.json()).url, API));
    expect(stored.status).toBe(200);
    // Byte-for-byte, because a re-encoded copy still opens, still says MSEDCL, and proves nothing:
    // the ByteRange digest a reviewer checks is over exactly these bytes.
    expect(Buffer.from(await stored.arrayBuffer())).toEqual(issued);
  });

  await test.step('staff publishes without any badge documents, and the public read and facets carry the answers', async () => {
    const published = await approveListingWithFetch(row.id, await authHeaders(ACTORS.admin));
    expect(published.status).toBe(200);
    const publicResponse = await fetch(`${API}/properties/${row.id}`);
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toMatchObject({
      furniture: ['TV'], agreementDuration: '24', ownershipVerified: false, status: 'approved',
    });
    for (const query of ['tenants=bachelor-male&rank=newest', 'availableFrom=15&rank=newest', 'pets=true&rank=newest']) {
      const facet = await fetch(`${API}/properties?${query}`);
      expect(facet.status, query).toBe(200);
      expect((await facet.json()).content.map((listing) => listing.id), query).toContain(row.id);
    }
  });

  await test.step('rental detail shows the owner-selected furniture and agreement duration, and the stated super built-up area', async () => {
    await page.goto(`/property/${row.id}`);
    await page.getByRole('tab', { name: 'Rent Details', exact: true }).click();
    await expect(page.getByText('TV', { exact: true })).toBeVisible();
    await expect(page.getByText('Wardrobes', { exact: true })).toHaveCount(0);
    await expect(page.getByText('24 months', { exact: true })).toBeVisible();

    await page.goto(`/property/${row.id}?tab=amenities`);
    await expect(page.getByRole('heading', { name: 'In-flat features' })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.amenity-card', { hasText: 'TV' })).toHaveCount(1);
    await page.goto(`/property/${row.id}`);
    // The same figure also heads the collapsed summary, so assert the labelled breakdown row.
    await expect(page.locator('div').filter({ hasText: /^Super Built-up1,400 sq\.ft\.$/ }).first()).toBeVisible();
  });
});

test('the wizard lifts the fields whose names the contract does not share, and a move-in date beyond the widest bucket states no claim', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await postAFlat(page, { flat: 'B-1104', society: 'Kumar Prospera' });

  const row = await savedRow(mobile);

  expect(row.floor).toBe(9);
  // An empty RERA value still needs its contract key so omission cannot masquerade as persistence.
  expect(row).toHaveProperty('reraId');
  expect(row.maintenance).toBe(2500);

  expect(row.bathrooms).toBe(2);
  expect(row.balconies).toBe(1);
  expect(row.parking).toBe(2);
  expect(row.availableFrom == null || row.availableFrom === '').toBe(true);
});

test('an unanswered pet and maintenance question is published as unstated, not as a refusal', async ({ page, request }) => {
  const mobile = await postAFlat(page, {
    flat: 'B7-1210', society: 'Unstated Terms Homes',
    petsPolicy: '', rentMaintMode: '',
  });
  const row = await savedRow(mobile);
  // Absent, not false: the owner skipped the question, and "Not allowed" is an answer nobody gave.
  expect(row.pets ?? null).toBeNull();

  const published = await approveListingWithFetch(row.id, await authHeaders(ACTORS.admin));
  expect(published.status).toBe(200);
  expect((await (await fetch(`${API}/properties/${row.id}`)).json()).pets ?? null).toBeNull();

  const facet = await fetch(`${API}/properties?pets=true&rank=newest`);
  expect((await facet.json()).content.map((listing) => listing.id)).not.toContain(row.id);

  await page.goto(`/property/${row.id}`);
  await expect(page.getByText('Not allowed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Included', { exact: true })).toHaveCount(0);
});
test('a sale post: 1 RK and New Launch reach the facets, the owner-declared terms reach the public read and the detail page, and no badge documents are needed', async ({ page }) => {
  test.slow();
  const mobile = await postAFlat(page, {
    flat: 'B2-1205', society: 'Sale Terms Homes', deal: 'buy',
    monthlyMaintenance: '3500', priceNegotiable: true, loanAvailable: false,
    bhk: '0', construction: 'New Launch',
  });
  const row = await savedRow(mobile);
  expect(row).toMatchObject({ maintenance: 3500, negotiable: true, bhk: 0, possession: 'new-launch', ownershipVerified: false });

  const published = await approveListingWithFetch(row.id, await authHeaders(ACTORS.admin));
  expect(published.status).toBe(200);
  const publicResponse = await fetch(`${API}/properties/${row.id}`);
  expect(publicResponse.status).toBe(200);
  expect(await publicResponse.json()).toMatchObject({
    ownership: 'Freehold', maintenance: 3500, loanAvailable: false, negotiable: true, ownershipVerified: false, status: 'approved',
  });
  const facet = await fetch(`${API}/properties?bhks=0&construction=new-launch`);
  expect(facet.status).toBe(200);
  expect((await facet.json()).content.map((listing) => listing.id)).toContain(row.id);

  await page.goto(`/property/${row.id}`);
  await expect(page.getByRole('heading', { name: /1 RK Flat for Sale/i })).toBeVisible();
  await page.getByRole('tab', { name: 'Price Insights', exact: true }).click();
  await expect(page.getByText('Freehold', { exact: true })).toBeVisible();
  await expect(page.getByText('₹3,500', { exact: true })).toBeVisible();
  await expect(page.getByText('Loan not available', { exact: true })).toBeVisible();
  await expect(page.getByText('Negotiable', { exact: true })).toBeVisible();
});

async function signedPdf() {  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('MSEDCL bill - O-201, Evidence Court, Baner Road');
  const signature = pdf.context.register(pdf.context.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 0, 0, 0],
  }));
  const field = pdf.context.register(pdf.context.obj({
    FT: 'Sig', T: 'Signature1', V: signature, Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 0, 0],
  }));
  pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.register(pdf.context.obj({ SigFlags: 3, Fields: [field] })));
  return Buffer.from(await pdf.save());
}

test('sale: an Index II in the vault unlocks the badge request, which waits for staff instead of self-awarding', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await postAFlat(page, { flat: 'D-401', society: 'Evidence Sale Court', deal: 'buy' });
  const row = await savedRow(mobile);
  const card = await openBadgeVault(page, row.id);
  await expect(card.getByTestId('badge-state')).toHaveText('Not requested');
  await expect(card.locator('li[data-doc]')).toHaveCount(2);
  await expect(card.getByTestId('request-badge')).toBeDisabled();
  await uploadBadgeProof(page, card, 'Index II', { name: 'index-ii.png', mimeType: 'image/png', buffer: PHOTO_PNG });
  await card.getByTestId('request-badge').click();
  await expect(card.getByTestId('badge-state')).toHaveText('Under review');

  const after = await savedRow(mobile);
  expect(after.ownershipVerified).toBe(false);
  expect(after.ownershipRequestedAt).toBeTruthy();
  const response = await fetch(`${API}/me/documents/${row.id}`, { headers: await authHeaders(mobile) });
  expect(response.status).toBe(200);
  expect((await response.json()).map((d) => d.category)).toEqual(['Index II']);
});

