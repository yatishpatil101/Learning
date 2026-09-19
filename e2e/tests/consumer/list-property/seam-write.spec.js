// Owner-authenticated reads prove duplicate signals survive the mapper and database;
// anonymous responses intentionally withhold the electricity meter number.
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';
import { PHOTO_PNG, uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { createRequire } from 'node:module';

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
  // Portal mounting precedes interactivity by one animation frame.
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

// Floor and total floors are required on a tower type; the innermost label wrapper isolates each Select.
async function pickFloor(page, value, label = 'Floor No. *') {
  const field = page.locator('div').filter({ has: page.locator(`label:text-is("${label}")`) }).last();
  await field.locator('.dz-dropdown__trigger').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.getByRole('option', { name: value, exact: true }).click();
}

/* Both date fields are bounded at today, so a literal is a fixture with an expiry date: the calendar
   day renders `disabled` once the date passes and the click waits out its whole timeout. */
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function postAFlat(page, { flat, society, meter, doc, deal = 'rent', docCategory = 'Electricity Bill', index = false, furniture = [], agreementDuration = '', monthlyMaintenance = '', priceNegotiable = false, loanAvailable = true, bhk = '2', construction = '', preferredTenants = [], superBuiltUp = '', availableFrom = inDays(120), petsPolicy = '', rentMaintMode = 'extra' }) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  // The step rail distinguishes the wizard from the paywall, which also renders the meter.
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  if (deal === 'rent') await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  if (bhk === '0') await page.getByRole('button', { name: '1 RK', exact: true }).click();
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
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill(flat);
  await page.locator('input[data-err="society"]').fill(society);
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
      // The standard 11/0/1 terms are summarised; the three dropdowns only exist once revealed.
      await page.locator('[data-testid="lp-rental-terms"]').getByRole('button', { name: 'Change rental terms', exact: true }).click();
      await page.getByText('Agreement Duration', { exact: true }).locator('..').locator('.dz-dropdown__trigger').click();
      await page.getByRole('option', { name: agreementDuration, exact: true }).click();
    }
  } else {
    await page.locator('input[data-err="price"]').fill('9500000');
    await pickOption(page, 'ownership', 'Freehold');
    if (monthlyMaintenance) await page.locator('input[placeholder="e.g. 3,500"]').fill(monthlyMaintenance);
    if (priceNegotiable) await page.getByRole('switch', { name: 'Negotiable', exact: true }).click();
    if (!loanAvailable) await page.getByRole('switch', { name: 'Home Loan Available', exact: true }).click();
    if (construction) {
      await page.getByRole('button', { name: construction, exact: true }).click();
      // A launch or an under-construction sale owes a handover date; Ready to Move does not.
      if (construction !== 'Ready to Move') {
        await pickDate(page, '[data-err="availableFrom"]', inDays(540));
        // …and, in Maharashtra, a registration number in the advertisement.
        await page.locator('input[data-err="reraId"]').fill('P52100012345');
      }
    } else {
      await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });

  const verification = page.getByRole('heading', { name: 'Property Documents & Verification', exact: true }).locator('..');
  const consumerNumber = verification.getByLabel('Electricity Consumer No.', { exact: true });
  await expect(consumerNumber).toBeVisible();
  await expect(consumerNumber).toHaveAttribute('inputmode', 'numeric');
  await expect(consumerNumber).toHaveAttribute('maxlength', '20');
  await consumerNumber.fill('00ab12-34');
  await expect(consumerNumber).toHaveValue('001234');
  await consumerNumber.fill(meter);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator(`input[data-err="${deal === 'rent' ? 'monthlyRent' : 'price'}"]`)).toBeVisible();
  await expect(page.getByPlaceholder(/MSEDCL electricity bill/i)).toHaveCount(0);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(consumerNumber).toHaveValue(meter);

  // Canvas-generated PNG bytes keep decode validation from masking the persistence assertions.
  await uploadPublishablePhotos(page);

  await expect(page.getByRole('heading', { name: 'Get the Verified badge', exact: true })).toBeVisible();
  await expect(page.getByText('Other documents — for your records', { exact: true })).toBeVisible();
  const billInput = page.getByLabel('Upload Electricity Bill', { exact: true });
  await expect(billInput).toHaveAttribute('accept', '.pdf,application/pdf');
  await expect(billInput).toBeEnabled();
  const badgeStatus = page.getByRole('status', { name: 'Badge documents' });
  await expect(badgeStatus).toContainText('publish without a badge');
  if (doc !== null) {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('Synthetic property document');
    const docFile = doc ?? { name: 'original-bill.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
    if (docCategory === 'Property Tax Receipt') {
      await billInput.setInputFiles({ name: 'bill-photo.png', mimeType: 'image/png', buffer: PHOTO_PNG });
      await expect(page.locator('[data-err="Electricity Bill"]')).toContainText('original MSEDCL PDF, not a photo or scan');
      await expect(badgeStatus).toContainText('publish without a badge');
      await page.getByText('Don’t have a bill? Use a property-tax receipt', { exact: true }).click();
    }
    const docInput = page.getByLabel(`Upload ${docCategory}`, { exact: true });
    await expect(docInput).toBeEnabled();
    await docInput.setInputFiles(docFile);
    await expect(page.locator(`[data-err="${docCategory}"] .doc-name`)).toHaveText(docFile.name);
    if (deal === 'buy') await expect(badgeStatus).toContainText('publish without a badge');
    if (index) {
      const indexInput = page.getByLabel('Upload Index II', { exact: true });
      await expect(indexInput).toBeEnabled();
      await indexInput.setInputFiles({ ...docFile, name: 'index-ii.pdf' });
      await expect(page.locator('[data-err="Index II"] .doc-name')).toHaveText('index-ii.pdf');
    }
    if (deal === 'rent' || index) await expect(badgeStatus).toContainText('ready for staff review — not yet verified');
  }
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });
  return mobile;
}

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

  // The unit must precede the society so address matching identifies a flat rather than a tower.
  expect(row.address).toContain('A-902');
  expect(row.address).toContain('Rohan Nilay');
  expect(row.address.indexOf('A-902')).toBeLessThan(row.address.indexOf('Rohan Nilay'));
});

test('the wizard lifts the fields whose names the contract does not share', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await postAFlat(page, { flat: 'B-1104', society: 'Kumar Prospera', meter: '180099887766' });

  const row = await savedRow(mobile);

  // Read-back catches field-name mismatches that silently discard duplicate signals.
  expect(row.electricityMeterNo).toBe('180099887766');
  expect(row.floor).toBe(9);
  // An empty RERA value still needs its contract key so omission cannot masquerade as persistence.
  expect(row).toHaveProperty('reraId');
  // The wizard splits maintenance by deal (`monthlyMaintenance` for sale, `rentMaintenance` behind
  // the "Charged Extra" toggle for rent); the entity has one column.
  expect(row.maintenance).toBe(2500);

  // Read back defaults as well as selections: rendering a default does not prove it was stored.
  expect(row.bathrooms).toBe(2);
  expect(row.balconies).toBe(1);
  expect(row.parking).toBe(2);
});

test('rental detail shows the owner-selected furniture and agreement duration', async ({ page }) => {
  const mobile = await postAFlat(page, {
    flat: 'B1-1204', society: 'Furniture Truth Homes', meter: '180099887767',
    furniture: ['TV'], agreementDuration: '24 months',
  });
  const row = await savedRow(mobile);
  expect(row.formDetails.furniture).toEqual(['TV']);
  expect(row.formDetails.agreementDuration).toBe('24');

  const published = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH', headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ status: 'approved', reason: 'Phase one property detail fixture' }),
  });
  expect(published.status).toBe(200);
  const publicResponse = await fetch(`${API}/properties/${row.id}`);
  expect(publicResponse.status).toBe(200);
  expect(await publicResponse.json()).toMatchObject({ furniture: ['TV'], agreementDuration: '24' });

  await page.goto(`/property/${row.id}`);
  await page.getByRole('tab', { name: 'Rent Details', exact: true }).click();
  await expect(page.getByText('TV', { exact: true })).toBeVisible();
  await expect(page.getByText('Wardrobes', { exact: true })).toHaveCount(0);
  await expect(page.getByText('24 months', { exact: true })).toBeVisible();
});

test('sale detail shows the owner-declared ownership, maintenance, loan and negotiability', async ({ page }) => {
  const mobile = await postAFlat(page, {
    flat: 'B2-1205', society: 'Sale Terms Homes', meter: '180099887768', deal: 'buy',
    monthlyMaintenance: '3500', priceNegotiable: true, loanAvailable: false,
  });
  const row = await savedRow(mobile);
  expect(row).toMatchObject({ maintenance: 3500, negotiable: true });

  const published = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH', headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ status: 'approved', reason: 'Phase one sale detail fixture' }),
  });
  expect(published.status).toBe(200);
  const publicResponse = await fetch(`${API}/properties/${row.id}`);
  expect(publicResponse.status).toBe(200);
  expect(await publicResponse.json()).toMatchObject({
    ownership: 'Freehold', maintenance: 3500, loanAvailable: false, negotiable: true,
  });

  await page.goto(`/property/${row.id}`);
  await page.getByRole('tab', { name: 'Price Insights', exact: true }).click();
  await expect(page.getByText('Freehold', { exact: true })).toBeVisible();
  await expect(page.getByText('₹3,500', { exact: true })).toBeVisible();
  await expect(page.getByText('Loan not available', { exact: true })).toBeVisible();
  await expect(page.getByText('Negotiable', { exact: true })).toBeVisible();
});

test('1 RK and canonical construction and tenant choices reach the listing facets', async ({ page }) => {
  const mobile = await postAFlat(page, {
    flat: 'B3-1206', society: 'Vocabulary Homes', meter: '180099887769', deal: 'buy',
    bhk: '0', construction: 'New Launch', preferredTenants: [],
  });
  const row = await savedRow(mobile);
  expect(row).toMatchObject({ bhk: 0, possession: 'new-launch' });

  const published = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH', headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ status: 'approved', reason: 'Phase two vocabulary fixture' }),
  });
  expect(published.status).toBe(200);
  const facet = await fetch(`${API}/properties?bhks=0&construction=new-launch`);
  expect(facet.status).toBe(200);
  expect((await facet.json()).content.map((listing) => listing.id)).toContain(row.id);

  await page.goto(`/property/${row.id}`);
  await expect(page.getByRole('heading', { name: /1 RK Flat for Sale/i })).toBeVisible();
});

test('gendered bachelor tenant preferences reach the rental facet', async ({ page }) => {
  const mobile = await postAFlat(page, {
    flat: 'B4-1207', society: 'Tenant Vocabulary Homes', meter: '180099887770',
    preferredTenants: ['Bachelor (Male)'],
  });
  const row = await savedRow(mobile);
  expect(row.tenants).toEqual(['bachelor-male']);
  const published = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH', headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ status: 'approved', reason: 'Phase two tenant vocabulary fixture' }),
  });
  expect(published.status).toBe(200);
  const facet = await fetch(`${API}/properties?tenants=bachelor-male&rank=newest`);
  expect(facet.status).toBe(200);
  expect((await facet.json()).content.map((listing) => listing.id)).toContain(row.id);
});

test('a stated super built-up area and a near move-in date reach the detail page and the move-in filter', async ({ page }) => {
  const mobile = await postAFlat(page, {
    flat: 'B5-1208', society: 'Enrichment Homes', meter: '180099887771',
    superBuiltUp: '1400', availableFrom: inDays(10),
  });
  const row = await savedRow(mobile);
  expect(Number(row.superBuiltUpArea)).toBe(1400);
  expect(row.availableFrom).toBe('15');

  const published = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH', headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ status: 'approved', reason: 'Phase three enrichment fixture' }),
  });
  expect(published.status).toBe(200);
  const facet = await fetch(`${API}/properties?availableFrom=15&rank=newest`);
  expect(facet.status).toBe(200);
  expect((await facet.json()).content.map((listing) => listing.id)).toContain(row.id);

  await page.goto(`/property/${row.id}`);
  // The same figure also heads the collapsed summary, so assert the labelled breakdown row.
  await expect(page.locator('div').filter({ hasText: /^Super Built-up1,400 sq\.ft\.$/ }).first()).toBeVisible();
});

test('a move-in date beyond the widest bucket states no move-in claim at all', async ({ page }) => {
  const mobile = await postAFlat(page, {
    flat: 'B6-1209', society: 'Distant Move Homes', meter: '180099887772',
    availableFrom: inDays(120),
  });
  const row = await savedRow(mobile);
  // Not "within 30 days": a filter that returned this flat would waste every caller's journey.
  expect(row.availableFrom == null || row.availableFrom === '').toBe(true);
});

test('an unanswered pet and maintenance question is published as unstated, not as a refusal', async ({ page }) => {
  const mobile = await postAFlat(page, {
    flat: 'B7-1210', society: 'Unstated Terms Homes', meter: '180099887773',
    petsPolicy: '', rentMaintMode: '',
  });
  const row = await savedRow(mobile);
  // Absent, not false: the owner skipped the question, and "Not allowed" is an answer nobody gave.
  expect(row.pets ?? null).toBeNull();

  const published = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH', headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ status: 'approved', reason: 'Unstated terms fixture' }),
  });
  expect(published.status).toBe(200);
  expect((await (await fetch(`${API}/properties/${row.id}`)).json()).pets ?? null).toBeNull();

  // The pet-friendly facet promises nothing it was not told.
  const facet = await fetch(`${API}/properties?pets=true&rank=newest`);
  expect((await facet.json()).content.map((listing) => listing.id)).not.toContain(row.id);

  await page.goto(`/property/${row.id}`);
  await expect(page.getByText('Not allowed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Included', { exact: true })).toHaveCount(0);
});

test('an owner who answers the pet question has that answer published and searchable', async ({ page }) => {
  const mobile = await postAFlat(page, {
    flat: 'B8-1211', society: 'Stated Terms Homes', meter: '180099887774', petsPolicy: 'Allowed',
  });
  const row = await savedRow(mobile);
  expect(row.pets).toBe(true);

  const published = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH', headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ status: 'approved', reason: 'Stated terms fixture' }),
  });
  expect(published.status).toBe(200);
  const facet = await fetch(`${API}/properties?pets=true&rank=newest`);
  expect((await facet.json()).content.map((listing) => listing.id)).toContain(row.id);
});

// Signature-shaped dictionaries exercise byte preservation, not cryptographic signature validity.
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

test('a small signature-bearing PDF is stored byte-for-byte without a re-save', async ({ page }) => {
  const issued = await signedPdf();
  // The ceiling is exclusive and the preservation branch is the under-it one; a fixture that drifted
  // over 1 MB would take the compression path and prove the opposite of what this claims.
  expect(issued.length).toBeLessThan(1_000_000);
  const mobile = await postAFlat(page, {
    flat: 'C-304', society: 'Ganga Legend', meter: '180077665544',
    doc: { name: 'msedcl-signed.pdf', mimeType: 'application/pdf', buffer: issued },
  });

  const row = await savedRow(mobile);
  const headers = await authHeaders(mobile);
  const listed = await fetch(`${API}/me/documents/${row.id}`, { headers });
  expect(listed.status).toBe(200);
  const documents = await listed.json();
  expect(documents).toHaveLength(1);
  // The sniffed type, not the browser's claim: the vault persists what it proved the bytes were.
  expect(documents[0]).toMatchObject({ fileName: 'msedcl-signed.pdf', mimeType: 'application/pdf' });
  expect(documents[0].sizeBytes).toBe(issued.length);

  const stored = await fetch(documents[0].url);
  expect(stored.status).toBe(200);
  // Byte-for-byte, because a re-encoded copy still opens, still says MSEDCL, and proves nothing:
  // the ByteRange digest a reviewer checks is over exactly these bytes.
  expect(Buffer.from(await stored.arrayBuffer())).toEqual(issued);
});

test('sale: tax fallback plus Index II is ready for review but does not self-award a badge', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await postAFlat(page, {
    flat: 'D-401', society: 'Evidence Sale Court', meter: '180077665545',
    deal: 'buy', docCategory: 'Property Tax Receipt', index: true,
  });
  const row = await savedRow(mobile);
  expect(row.ownershipVerified).toBe(false);
  const response = await fetch(`${API}/me/documents/${row.id}`, { headers: await authHeaders(mobile) });
  expect(response.status).toBe(200);
  expect((await response.json()).map((d) => d.category).sort()).toEqual(['Index II', 'Property Tax Receipt']);
});

for (const deal of ['rent', 'buy']) {
  test(`${deal}: an owner submits and staff publishes without any badge documents`, async ({ page }) => {
    const mobile = await postAFlat(page, {
      flat: deal === 'rent' ? 'E-502' : 'F-503', society: `No Documents ${deal}`, meter: deal === 'rent' ? '180077665546' : '180077665547',
      deal, doc: null,
    });
    const row = await savedRow(mobile);
    expect(row.ownershipVerified).toBe(false);
    const published = await fetch(`${API}/properties/${row.id}/status`, {
      method: 'PATCH', headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({ status: 'approved', reason: 'Optional documents publication test' }),
    });
    expect(published.status).toBe(200);
    const publicRow = await fetch(`${API}/properties/${row.id}`);
    expect(publicRow.status).toBe(200);
    expect(await publicRow.json()).toMatchObject({ ownershipVerified: false, status: 'approved' });
  });
}


