// Owner-authenticated reads prove duplicate signals survive the mapper and database;
// anonymous responses intentionally withhold the electricity meter number.
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';
import { createRequire } from 'node:module';

const requireFrontend = createRequire(new URL('../../../../frontend/package.json', import.meta.url));
const { PDFDocument, PDFName } = requireFrontend('pdf-lib');

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=';

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

// The optional floor has no error hook; the innermost label wrapper isolates its Select.
async function pickFloor(page, value) {
  const field = page.locator('div').filter({ has: page.locator('label:text-is("Floor No.")') }).last();
  await field.locator('.dz-dropdown__trigger').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.getByRole('option', { name: value, exact: true }).click();
}

async function postAFlat(page, { flat, society, meter, doc, deal = 'rent', docCategory = 'Electricity Bill', index = false }) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  // The step rail distinguishes the wizard from the paywall, which also renders the meter.
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  if (deal === 'rent') await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1150');
  // Scope by label because bathrooms and balconies also offer a "2" pill.
  await page.locator('div').filter({ has: page.locator('label:text-is("Parking Spaces")') }).last()
    .locator('.radio-pill').filter({ hasText: /^2$/ }).first().click();
  // The string-valued floor must survive numeric mapping for the society/floor/BHK duplicate signal.
  await pickFloor(page, '9');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  // A verification identifier must not interrupt the location/pricing step.
  await expect(page.getByPlaceholder(/MSEDCL electricity bill/i)).toHaveCount(0);
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill(flat);
  await page.locator('input[data-err="society"]').fill(society);
  await page.locator('input[data-err="pincode"]').fill('411045');
  if (deal === 'rent') {
    await page.locator('input[data-err="monthlyRent"]').fill('30000');
    await page.locator('input[data-err="deposit"]').fill('60000');
    await page.locator('.radio-pill', { hasText: 'Charged Extra' }).click();
    await page.locator('input[placeholder="e.g. 2,500"]').fill('2500');
    await pickDate(page, '[data-err="availableFrom"]', '2025-12-31');
  } else {
    await page.locator('input[data-err="price"]').fill('9500000');
    await pickOption(page, 'ownership', 'Freehold');
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });

  const verification = page.getByRole('heading', { name: 'Property Documents & Verification', exact: true }).locator('..');
  const consumerNumber = verification.getByLabel('Electricity Consumer No. (optional)', { exact: true });
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
  const buf = Buffer.from(PNG, 'base64');
  const photos = page.locator('[data-err="photos"]');
  await photos.locator('label.upload-zone input[type="file"]')
    .setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: buf });
  // The picker is `disabled` while a photo uploads and a pick made in that window is dropped
  // silently, so wait for the media queue to drain rather than for the control to be enabled.
  await expect(photos.locator('img').first()).toBeVisible();
  await expect(photos).toHaveAttribute('aria-busy', 'false');

  await expect(page.getByRole('heading', { name: 'Get the Verified badge', exact: true })).toBeVisible();
  await expect(page.getByText('Other documents — optional, for your records', { exact: true })).toBeVisible();
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
      await billInput.setInputFiles({ name: 'bill-photo.png', mimeType: 'image/png', buffer: buf });
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

// Signature-shaped dictionaries exercise byte preservation, not cryptographic signature validity.
async function signedPdf() {
  const pdf = await PDFDocument.create();
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


