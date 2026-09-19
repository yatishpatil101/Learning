import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';

const DRAFT_KEY = 'dzDraft:list-property';
const DETAILS = {
  flatNumber: 'C-901', tower: 'North', society: 'Edit Prefill Homes', street: 'Baner Road',
  landmark: 'Near the public library', ownership: 'Freehold', loanAvailable: false,
  agreementDuration: '24', lockIn: '0', noticePeriod: '2', availableFrom: '2027-01-20',
  preferredTenants: ['family', 'bachelors'], petsPolicy: 'no', foodPref: 'veg',
  rentMaintMode: 'extra', possession: 'available', fixtures: [],
};
const ADDRESS = 'C-901, North, Edit Prefill Homes, Baner Road';
const LEGACY_ADDRESS = '  Unit 9, East Annex, Old Banyan Cooperative Housing Society,\nSurvey 42/7, Behind the municipal library, Baner-Pashan Link Road, Pune 411045  ';
// The shape the wizard itself composes, so the boxes can be handed back in the join order.
const RECOVERABLE_ADDRESS = '101, KATEPURAM PHASE-2, Shirode Road';
const DOCUMENT_NAME = 'edit-prefill-ownership.png';
const POISON_DRAFT = JSON.stringify({
  deal: 'buy', propertyType: 'villa', carpetArea: '9999', flatNumber: 'POISON-42',
  tower: 'Wrong tower', society: 'Wrong society', street: 'Wrong street',
  description: 'Unrelated new-listing draft', pincode: '400001', ownership: 'Leasehold',
});

// Labels are not associated with these controls; use the existing field-wrapper convention.
function field(page, label) {
  return page.locator('div').filter({ has: page.locator('label').filter({ hasText: label }) }).last();
}

async function pngFile(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = '#167d8d';
    context.fillRect(0, 0, 48, 32);
    context.fillStyle = '#f0d4ac';
    context.fillRect(8, 8, 24, 16);
    return canvas.toDataURL('image/png');
  });
  return { name: DOCUMENT_NAME, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

async function readListing(request, seeded) {
  const response = await request.get(`${API}/me/listings/${seeded.id}`, { headers: seeded.headers });
  expect(response.status(), 'owner read must reach the real API').toBe(200);
  return response.json();
}

async function readDocuments(request, seeded) {
  const response = await request.get(`${API}/me/documents/${seeded.id}`, { headers: seeded.headers });
  expect(response.status()).toBe(200);
  return response.json();
}

async function seedListing(page, request, { deal = 'rent', legacy = false } = {}) {
  // `legacy` may name the stored line, so a recoverable address and an unsplittable blob share a seed.
  const storedAddress = legacy === true ? LEGACY_ADDRESS : (legacy || ADDRESS);
  const mobile = await signedInAsNew(page);
  const headers = await authHeaders(mobile);
  const file = await pngFile(page);
  const photo = await request.post(`${API}/me/photos`, {
    headers: { authorization: headers.authorization }, multipart: { file },
  });
  expect(photo.status(), 'real PNG upload must succeed before creating a listing').toBe(201);
  const { url } = await photo.json();
  expect(url).toMatch(/^\/api\/dev\/storage\/public\/photos\//);
  const image = await request.get(new URL(url, API).href);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toMatch(/^image\/png/);
  expect(await image.body()).toEqual(file.buffer);
  const response = await request.post(`${API}/me/listings`, {
    headers,
    data: {
      title: `Zztest edit prefill ${deal} ${mobile.slice(-6)}`, deal, propertyType: 'Flat',
      bhk: 2, bathrooms: 2, balconies: 0, parking: 0, price: deal === 'rent' ? 31000 : 9500000,
      deposit: 0, maintenance: 2500, area: 1000, carpetArea: 875.5, builtUpArea: 1000.25,
      areaUnit: 'sqft', furnishing: 'semi-furnished', locality: 'Baner', city: 'Pune',
      lat: 18.559, lng: 73.786, floor: 0, totalFloors: 15, ageYears: 7,
      facing: 'East', overlooking: 'Garden', electricityMeterNo: `00${mobile}`,
      reraId: 'P52100000001', images: [url], description: 'Original owner description.',
      ...(deal === 'buy' ? { possession: 'under-construction' } : {}),
      address: legacy ? storedAddress : ADDRESS,
      ...(legacy ? {} : { pincode: '411045', formDetails: DETAILS }),
    },
  });
  expect(response.status(), 'fresh owner must create a valid listing').toBe(201);
  const listing = await response.json();
  /* A rental has no title deed to show, so its badge evidence is the address proof; only a sale
     asks for Index II. Seeding the category the wizard does not offer leaves nothing to prefill. */
  const category = deal === 'rent' ? 'Electricity Bill' : 'Index II';
  const document = await request.post(`${API}/me/documents/${listing.id}`, {
    headers: { authorization: headers.authorization }, multipart: { category, file },
  });
  expect(document.status(), 'save actual vault bytes rather than browser-only metadata').toBe(201);
  const savedDocument = await document.json();
  const seeded = { id: listing.id, headers, category, documentId: savedDocument.id };
  const baseline = await readListing(request, seeded);
  expect(baseline.address).toBe(legacy ? storedAddress : ADDRESS);
  const vault = await readDocuments(request, seeded);
  expect(vault).toHaveLength(1);
  expect(vault[0]).toMatchObject({ id: savedDocument.id, fileName: DOCUMENT_NAME, category });
  // The vault is authoritative here; the unrelated upload counter drift is tracked in tasks/todo.md.
  expect(baseline.ownershipVerified).toBe(false);
  expect(baseline.verified).toBe(false);
  if (legacy) expect(baseline.formDetails == null).toBe(true);
  else expect(baseline.formDetails).toEqual(DETAILS);
  return { ...seeded, baseline };
}

function vaultRead(page, id) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === `/api/me/documents/${id}`
    && response.request().method() === 'GET' && response.status() === 200);
}

async function openEdit(page, seeded, { reload = false, carpetArea = 875.5, builtUpArea = 1000.25 } = {}) {
  const documents = vaultRead(page, seeded.id);
  if (reload) await page.reload();
  else await page.goto(`/list-property?edit=${seeded.id}`);
  await documents;
  await expect(page.getByRole('heading', { name: 'Property details', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Find a flatmate\b/ })).toHaveCount(0);
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue(String(carpetArea));
  await expect(field(page, /^Built-up Area$/).locator('input')).toHaveValue(String(builtUpArea));
  await expect(field(page, /^Floor No\. \*$/).locator('.dz-dropdown__trigger')).toContainText('Ground');
  await expect(field(page, /^Age of Property$/).locator('.dz-dropdown__trigger')).toContainText('5 - 10 years');
}

async function nextStep(page, title) {
  await page.getByRole('button', { name: 'Next Step', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

async function expectAddress(page, details = DETAILS) {
  await expect(page.locator('input[data-err="flatNumber"]')).toHaveValue(details.flatNumber);
  await expect(field(page, /^Wing \/ Block$/).locator('input')).toHaveValue(details.tower);
  await expect(page.locator('input[data-err="society"]')).toHaveValue(details.society);
  await expect(page.locator('input[autocomplete="address-line1"]')).toHaveValue(details.street);
  await expect(page.locator('input[autocomplete="address-line3"]')).toHaveValue(details.landmark);
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045');
}

async function expectDocument(page, seeded) {
  const slot = page.locator(`[data-err="${seeded.category}"]`);
  await expect(slot.locator('.doc-name')).toHaveText(DOCUMENT_NAME);
  await expect(slot.locator('.doc-upload')).toHaveClass(/has-file/);
  await expect(page.getByLabel('Electricity Consumer No.', { exact: true }))
    .toHaveValue(seeded.baseline.electricityMeterNo);
  // A filename is evidence submitted for review, not a verification decision.
  await expect(page.locator('.lp-meter').getByText(/verified/i)).toHaveCount(0);
}

function recordWrites(page) {
  let writes = [];
  page.on('request', (request) => {
    const listingOrMedia = /^\/api\/me\/(listings|photos|documents)(\/|$)/.test(new URL(request.url()).pathname);
    if (listingOrMedia && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      writes = [...writes, request];
    }
  });
  return () => writes;
}

async function saveDescription(page, description, writes) {
  await page.locator('textarea').fill(description);
  const patched = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && /^\/api\/me\/listings\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Submit Property', exact: true }).click();
  const response = await patched;
  expect(response.status(), 'description-only save must succeed').toBe(200);
  expect(response.request().postDataJSON()).toEqual({ description });
  await expect(page.getByRole('heading', { name: 'Listing Updated!', exact: true })).toBeVisible();
  expect(writes().filter((request) => request.method() === 'PATCH')).toHaveLength(1);
  expect(writes().filter((request) => /multipart\/form-data/i.test(request.headers()['content-type'] || ''))).toHaveLength(0);
  expect(writes().filter((request) => /\/me\/(photos|documents)(\/|$)/.test(new URL(request.url()).pathname))).toHaveLength(0);
}

async function expectPreserved(request, seeded, description) {
  const saved = await readListing(request, seeded);
  expect(saved.description).toBe(description);
  for (const key of ['address', 'pincode', 'area', 'carpetArea', 'builtUpArea', 'ageYears', 'floor',
    'deposit', 'maintenance', 'electricityMeterNo', 'reraId', 'formDetails', 'images', 'docsCount',
    'ownershipVerified', 'verified']) {
    expect(saved[key], `${key} must not be rewritten by an unrelated edit`).toEqual(seeded.baseline[key]);
  }
  const documents = await readDocuments(request, seeded);
  expect(documents).toHaveLength(1);
  expect(documents[0]).toMatchObject({ id: seeded.documentId, category: seeded.category, fileName: DOCUMENT_NAME });
}

test('rent reload restores address, terms and zeros; description-only save preserves the vault and unrelated draft', async ({ page, request }, testInfo) => {
  const seeded = await seedListing(page, request);
  await page.evaluate(({ key, draft }) => localStorage.setItem(key, draft), { key: DRAFT_KEY, draft: POISON_DRAFT });
  const writes = recordWrites(page);
  await openEdit(page, seeded);
  await openEdit(page, seeded, { reload: true });
  await nextStep(page, 'Location');
  await expectAddress(page);
  await nextStep(page, 'Price & terms');
  await expect(page.locator('input[data-err="deposit"]')).toHaveValue('0');
  await expect(page.locator('[data-err="availableFrom"]')).toHaveText('20/01/2027');
  for (const [label, value] of [[/^Agreement Duration$/, '24 months'], [/^Lock-in Period$/, 'None'], [/^Notice Period$/, '2 months']]) {
    await expect(field(page, label).locator('.dz-dropdown__trigger')).toContainText(value);
  }
  for (const name of ['Family', 'Bachelors', 'Not Allowed', 'Veg Only', 'Charged Extra']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  for (const name of ['Anyone', 'Company Lease', 'Allowed', 'Veg & Non-veg', 'Included in Rent']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page.getByPlaceholder('e.g. 2,500', { exact: true })).toHaveValue('2,500');
  const screenshot = testInfo.outputPath('edit-prefill-address-terms.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Restored address and rental terms', { path: screenshot, contentType: 'image/png' });
  await nextStep(page, 'Photos & documents');
  await expectDocument(page, seeded);
  await expect(page.locator('textarea')).toHaveValue(seeded.baseline.description);
  await saveDescription(page, 'Updated rental description only.', writes);
  await expectPreserved(request, seeded, 'Updated rental description only.');
  await openEdit(page, seeded, { reload: true });
  await nextStep(page, 'Location');
  await expectAddress(page);
  await nextStep(page, 'Price & terms');
  await nextStep(page, 'Photos & documents');
  await expectDocument(page, seeded);
  await expect(page.locator('textarea')).toHaveValue('Updated rental description only.');
  expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBe(POISON_DRAFT);
});

test('sale reload restores Freehold, false loan availability, meter, RERA and saved proof without verification', async ({ page, request }, testInfo) => {
  const seeded = await seedListing(page, request, { deal: 'buy' });
  const writes = recordWrites(page);
  await openEdit(page, seeded);
  await openEdit(page, seeded, { reload: true });
  await nextStep(page, 'Location');
  await expectAddress(page);
  await nextStep(page, 'Price & terms');
  await expect(page.locator('[data-err="ownership"]')).toContainText('Freehold');
  await expect(page.getByRole('switch', { name: /home loan/i })).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('[data-err="availableFrom"]')).toHaveText('20/01/2027');
  // MahaRERA moved off the document step to sit beside the possession answer that demands it.
  await expect(page.getByPlaceholder('e.g. P52100012345', { exact: true })).toHaveValue('P52100000001');
  await nextStep(page, 'Photos & documents');
  await expectDocument(page, seeded);
  const screenshot = testInfo.outputPath('edit-prefill-saved-documents.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Saved proof, meter and RERA', { path: screenshot, contentType: 'image/png' });
  await saveDescription(page, 'Updated sale description only.', writes);
  await expectPreserved(request, seeded, 'Updated sale description only.');
  await openEdit(page, seeded, { reload: true });
  await nextStep(page, 'Location');
  await expectAddress(page);
  await nextStep(page, 'Price & terms');
  await nextStep(page, 'Photos & documents');
  await expectDocument(page, seeded);
});

test('sale edit clears an optional maintenance amount without retaining a public claim', async ({ page, request }) => {
  const seeded = await seedListing(page, request, { deal: 'buy' });
  await openEdit(page, seeded);
  await nextStep(page, 'Location');
  await nextStep(page, 'Price & terms');
  await expect(field(page, /^Monthly Maintenance/).locator('input')).toHaveValue('2,500');
  await field(page, /^Monthly Maintenance/).locator('input').fill('');
  await nextStep(page, 'Photos & documents');
  const patched = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && new URL(response.url()).pathname === `/api/me/listings/${seeded.id}`);
  await page.getByRole('button', { name: 'Submit Property', exact: true }).click();
  const response = await patched;
  expect(response.status(), 'clearing optional maintenance must succeed').toBe(200);
  expect(response.request().postDataJSON()).toEqual({ clearMaintenance: true });

  const published = await request.patch(`${API}/properties/${seeded.id}/status`, {
    headers: await authHeaders(ACTORS.admin), data: { status: 'approved', reason: 'Maintenance clear fixture' },
  });
  expect(published.status()).toBe(200);
  const publicListing = await request.get(`${API}/properties/${seeded.id}`);
  expect(publicListing.status()).toBe(200);
  expect(await publicListing.json()).not.toHaveProperty('maintenance');
});

test('a tenant-preference edit reaches the canonical field the rental facet searches', async ({ page, request }) => {
  const seeded = await seedListing(page, request);
  await openEdit(page, seeded);
  await nextStep(page, 'Location');
  await nextStep(page, 'Price & terms');
  await page.getByRole('button', { name: 'Bachelors', exact: true }).click();
  await page.getByRole('button', { name: 'Bachelor (Male)', exact: true }).click();
  await nextStep(page, 'Photos & documents');
  const patched = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && new URL(response.url()).pathname === `/api/me/listings/${seeded.id}`);
  await page.getByRole('button', { name: 'Submit Property', exact: true }).click();
  expect((await patched).status(), 'a tenant-preference edit must succeed').toBe(200);
  expect((await patched).request().postDataJSON().tenants).toEqual(['family', 'bachelor-male']);

  const published = await request.patch(`${API}/properties/${seeded.id}/status`, {
    headers: await authHeaders(ACTORS.admin), data: { status: 'approved', reason: 'Tenant edit fixture' },
  });
  expect(published.status()).toBe(200);
  const publicListing = await request.get(`${API}/properties/${seeded.id}`);
  expect(publicListing.status()).toBe(200);
  expect((await publicListing.json()).tenants).toEqual(['family', 'bachelor-male']);
});

for (const deal of ['rent', 'buy']) {
  test(`legacy ${deal} keeps the full address and permits unrelated edits without missing postcode, date or ownership`, async ({ page, request }) => {
    const seeded = await seedListing(page, request, { deal, legacy: true });
    const writes = recordWrites(page);
    await openEdit(page, seeded);
    await nextStep(page, 'Location');
    const address = page.getByRole('heading', { name: 'Saved address', exact: true }).locator('..').locator('p').first();
    expect(await address.textContent()).toBe(LEGACY_ADDRESS);
    await expect(page.locator('input[data-err="flatNumber"]')).toHaveValue('');
    await expect(page.locator('input[data-err="society"]')).toHaveValue('');
    await expect(page.locator('input[data-err="pincode"]')).toHaveValue('');
    await nextStep(page, 'Price & terms');
    if (deal === 'rent') await expect(page.locator('[data-err="availableFrom"]')).toHaveText('DD/MM/YYYY');
    else await expect(page.locator('[data-err="ownership"]')).toContainText('Select ownership');
    await nextStep(page, 'Photos & documents');
    await expectDocument(page, seeded);
    const description = `Legacy ${deal}: description changed without replacing the address.`;
    await saveDescription(page, description, writes);
    await expectPreserved(request, seeded, description);
    await openEdit(page, seeded, { reload: true });
    await nextStep(page, 'Location');
    expect(await address.textContent()).toBe(LEGACY_ADDRESS);
    await nextStep(page, 'Price & terms');
    await nextStep(page, 'Photos & documents');
    await expectDocument(page, seeded);
    await expect(page.locator('textarea')).toHaveValue(description);
  });
}

test('an address the wizard composed is recovered into the boxes and replaced only on purpose', async ({ page, request }) => {
  const seeded = await seedListing(page, request, { legacy: RECOVERABLE_ADDRESS });
  const writes = recordWrites(page);
  const street = page.locator('input[autocomplete="address-line1"]');
  await openEdit(page, seeded);
  await nextStep(page, 'Location');
  // The owner gets their address back in the boxes rather than an apology beside empty ones.
  await expect(page.getByRole('heading', { name: 'Saved address', exact: true })).toHaveCount(0);
  await expect(page.locator('input[data-err="flatNumber"]')).toHaveValue('101');
  await expect(page.locator('input[data-err="society"]')).toHaveValue('KATEPURAM PHASE-2');
  await expect(street).toHaveValue('Shirode Road');

  // Recovered boxes are not an edit: an unrelated save must still leave the stored line alone.
  await nextStep(page, 'Price & terms');
  await nextStep(page, 'Photos & documents');
  const description = 'Recovered address: description changed without replacing the address.';
  await saveDescription(page, description, writes);
  await expectPreserved(request, seeded, description);

  await openEdit(page, seeded, { reload: true });
  await nextStep(page, 'Location');
  await street.fill('Shirode Lane');
  // Advancing proves the recovered boxes satisfy the address rules a replacement has to meet.
  await nextStep(page, 'Price & terms');
  await nextStep(page, 'Photos & documents');
  const patched = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && /^\/api\/me\/listings\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Submit Property', exact: true }).click();
  expect((await patched).status(), 'an address replacement must succeed').toBe(200);
  await expect(page.getByRole('heading', { name: 'Listing Updated!', exact: true })).toBeVisible();

  const saved = await readListing(request, seeded);
  expect(saved.address, 'only the edited part changes').toBe('101, KATEPURAM PHASE-2, Shirode Lane');
  expect(saved.formDetails).toMatchObject({ flatNumber: '101', society: 'KATEPURAM PHASE-2', street: 'Shirode Lane' });
  await openEdit(page, seeded, { reload: true });
  await nextStep(page, 'Location');
  await expect(street).toHaveValue('Shirode Lane');
});

test('the photo deep link opens on the photo step with the whole listing already hydrated', async ({ page, request }) => {
  /* Arriving on the photo step must still be an EDIT: the hydration a full walk performs has to
     have happened anyway, or a save from here writes wizard defaults over the owner's answers. */
  const seeded = await seedListing(page, request);
  const writes = recordWrites(page);

  const documents = vaultRead(page, seeded.id);
  await page.goto(`/list-property?edit=${seeded.id}&step=photos`);
  await documents;
  await expect(page.getByRole('heading', { name: 'Photos & documents', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Property details', exact: true })).toHaveCount(0);

  // Hydrated, not empty: the seeded photo and the vault document are both already on the step the
  // link lands on, which is what makes "add" mean add rather than replace.
  await expect(page.locator('[data-err="photos"] img')).toHaveCount(1);
  await expectDocument(page, seeded);

  /* Separates a real edit from a blank form opened on page three. Step 1 is addressed as a
     listitem because StepNav's `role="listitem"` overrides the button's implicit role. */
  await page.getByRole('list', { name: 'Listing progress' }).getByRole('listitem')
    .filter({ hasText: 'Step 1' }).click();
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('875.5');
  await nextStep(page, 'Location');
  await expectAddress(page);

  // And the save is still a one-field PATCH. `expectPreserved` re-reads outside the browser, so a
  // deep link that had quietly rebuilt the form from defaults cannot pass.
  await nextStep(page, 'Price & terms');
  await nextStep(page, 'Photos & documents');
  const description = 'Photo deep link: description changed, everything else untouched.';
  await saveDescription(page, description, writes);
  await expectPreserved(request, seeded, description);
});

test('vault failure blocks the entire editor and all writes until an explicit retry hydrates saved values', async ({ page, request }) => {
  const seeded = await seedListing(page, request);
  const writes = recordWrites(page);
  const vaultUrl = `**/api/me/documents/${seeded.id}`;
  let releaseFailure;
  const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
  await page.route(vaultUrl, async (route) => {
    await failureGate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Vault temporarily unavailable' }) });
  });
  try {
    await page.goto(`/list-property?edit=${seeded.id}`);
    await expect(page.getByRole('status').filter({ hasText: 'Loading your listing and saved documents' })).toBeVisible();
    await expect(page.locator('.lp-step, .lp-steps, .lp-page input, .lp-page textarea')).toHaveCount(0);
    expect(writes()).toHaveLength(0);
  } finally {
    releaseFailure();
  }
  await expect(page.getByRole('alert').filter({ hasText: 'We could not load your listing and its documents' })).toBeVisible();
  await expect(page.locator('.lp-step, .lp-steps, .lp-page input, .lp-page textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Next Step|Submit Property/ })).toHaveCount(0);
  expect(writes()).toHaveLength(0);
  await page.unroute(vaultUrl);
  const recovered = vaultRead(page, seeded.id);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await recovered;
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('875.5');
  await nextStep(page, 'Location');
  await expectAddress(page);
  await nextStep(page, 'Price & terms');
  await nextStep(page, 'Photos & documents');
  await expectDocument(page, seeded);
  expect(writes()).toHaveLength(0);
  await saveDescription(page, 'Saved after the vault recovered.', writes);
  await expectPreserved(request, seeded, 'Saved after the vault recovered.');
});

for (const [wireKey, value] of [['builtUpArea', 1100.75], ['carpetArea', 900.75]]) {
  test(`wizard edits decimal ${wireKey} without rewriting the independent headline or other area`, async ({ page, request }) => {
    const seeded = await seedListing(page, request);
    expect(seeded.baseline).toMatchObject({ area: 1000, carpetArea: 875.5, builtUpArea: 1000.25 });
    const writes = recordWrites(page);
    await openEdit(page, seeded);
    const input = wireKey === 'builtUpArea'
      ? field(page, /^Built-up Area$/).locator('input')
      : page.locator('input[data-err="carpetArea"]');
    await input.fill(String(value));
    await expect(input).toHaveValue(String(value));
    await nextStep(page, 'Location');
    await nextStep(page, 'Price & terms');
    await nextStep(page, 'Photos & documents');
    await expectDocument(page, seeded);
    const patched = page.waitForResponse((response) => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/me/listings/${seeded.id}`);
    await page.getByRole('button', { name: 'Submit Property', exact: true }).click();
    const response = await patched;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ [wireKey]: value });
    await expect(page.getByRole('heading', { name: 'Listing Updated!', exact: true })).toBeVisible();
    expect(writes()).toHaveLength(1);
    expect(writes()[0].method()).toBe('PATCH');
    const expected = { ...seeded.baseline, [wireKey]: value };
    await expectPreserved(request, { ...seeded, baseline: expected }, seeded.baseline.description);
    const areas = { carpetArea: expected.carpetArea, builtUpArea: expected.builtUpArea };
    await openEdit(page, seeded, areas);
    await openEdit(page, seeded, { ...areas, reload: true });
    await nextStep(page, 'Location');
    await expectAddress(page);
    await nextStep(page, 'Price & terms');
    await nextStep(page, 'Photos & documents');
    await expectDocument(page, seeded);
    expect(writes()).toHaveLength(1);
  });
}

async function selectOption(page, trigger, name) {
  await trigger.click();
  const menu = page.locator('.dz-dropdown__menu.is-portal-open');
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name, exact: true }).click();
  await expect(trigger).toContainText(name);
}

test('create through the rental wizard persists exact answers and decimal areas for a fresh edit reload', async ({ page, request }) => {
  const mobile = await signedInAsNew(page);
  const headers = await authHeaders(mobile);
  const details = {
    ...DETAILS, society: `Zztest Prefill ${mobile.slice(-6)}`, ownership: '', loanAvailable: true,
    lockIn: '6', furniture: ['Wardrobe'], commercialType: '',
    plotArea: '', floorsInHouse: '', washrooms: '', shellType: '', camCharges: '',
    gstOnRent: '', fitOutMonths: '', escalationPct: '', tenancyStatus: '', inPlaceRent: '',
    leaseExpiry: '', seatCount: '', frontage: '', floorLoad: '', clearHeight: '',
    sanctionedPower: '', dockCount: '',
    plotLength: '', plotWidth: '', openSides: '', roadWidth: '', plotZone: '', waterSource: '',
    pantry: false, cornerPlot: false, boundaryWall: false,
    naSanctioned: false, electricity: false, roadAccess: false, satbara: false, suitableFor: [],
  };
  /* The wizard asks about possession on a sale and nowhere else, so the ABSENCE of the key is the assertion:
     a pre-filled default would claim a handover the owner never stated on a rental. */
  delete details.possession;
  const meter = `00${mobile}`;
  const description = 'Zztest rental wizard: structured address and decimal measurements.';
  const writes = recordWrites(page);
  /* A draft left by an earlier attempt restores its photos into this one. Removing the key after load fails —
     the autosave writes the restored state straight back — so this runs before the app's own scripts. */
  await page.addInitScript((key) => localStorage.removeItem(key), DRAFT_KEY);
  await page.goto('/list-property');
  await expect(page.getByRole('heading', { name: 'Property details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rent', exact: true }).click();
  await selectOption(page, page.locator('[data-err="propertyType"]'), 'Flat / Apartment');
  // The same locator must find the creation option before it can prove edit mode removes it.
  await expect(page.getByRole('button', { name: /^Find a flatmate\b/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Rent out the whole place\b/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await page.locator('[data-err="bathrooms"]').getByRole('button', { name: '2', exact: true }).click();
  await page.locator('input[data-err="carpetArea"]').fill('875.5');
  await field(page, /^Built-up Area$/).locator('input').fill('1000.25');
  for (const label of [/^Balconies$/, /^Parking Spaces$/]) {
    await field(page, label).getByRole('button', { name: 'None', exact: true }).click();
  }
  for (const [label, option] of [[/^Floor No\. \*$/, 'Ground'], [/^Total Floors \*$/, '15'],
    [/^Age of Property$/, '5 - 10 years'], [/^Facing$/, 'East'], [/^Overlooking$/, 'Garden']]) {
    await selectOption(page, field(page, label).locator('.dz-dropdown__trigger'), option);
  }
  await page.getByRole('button', { name: 'Semi-Furnished', exact: true }).click();
  await page.locator('.furn-tile').filter({ has: page.getByText('Wardrobe', { exact: true }) }).click();
  await nextStep(page, 'Location');
  // Choosing a real locality places the pin without relying on Google tile timing.
  await selectOption(page, page.locator('[data-err="locality"]'), 'Baner');
  const pin = page.locator('[data-err="location"] p').filter({ hasText: /Location set:/ });
  await expect(pin).toBeVisible();
  const coordinates = (await pin.innerText()).match(/Location set: (-?\d+\.\d+), (-?\d+\.\d+)/);
  expect(coordinates, 'the selected pin must expose both coordinates').not.toBeNull();
  await page.locator('input[data-err="flatNumber"]').fill(details.flatNumber);
  await field(page, /^Wing \/ Block$/).locator('input').fill(details.tower);
  await page.locator('input[data-err="society"]').fill(details.society);
  await page.locator('input[autocomplete="address-line1"]').fill(details.street);
  await page.locator('input[autocomplete="address-line3"]').fill(details.landmark);
  await page.locator('input[data-err="pincode"]').fill('411045');
  await nextStep(page, 'Price & terms');
  await page.locator('input[data-err="monthlyRent"]').fill('31000');
  await page.locator('input[data-err="deposit"]').fill('0');
  await page.getByRole('button', { name: 'Charged Extra', exact: true }).click();
  await page.getByPlaceholder('e.g. 2,500', { exact: true }).fill('2500');
  await pickDate(page, '[data-err="availableFrom"]', details.availableFrom);
  // A fresh form carries the standard terms collapsed, so revealing them is part of the answer.
  await page.getByRole('button', { name: 'Change rental terms', exact: true }).click();
  for (const [label, option] of [[/^Agreement Duration$/, '24 months'], [/^Lock-in Period$/, '6 months'], [/^Notice Period$/, '2 months']]) {
    await selectOption(page, field(page, label).locator('.dz-dropdown__trigger'), option);
  }
  for (const name of ['Family', 'Bachelors', 'Not Allowed', 'Veg Only']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await nextStep(page, 'Photos & documents');
  await page.getByLabel('Electricity Consumer No.', { exact: true }).fill(meter);
  await page.locator('textarea').fill(description);
  const uploaded = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/me/photos');
  await page.getByLabel('Upload property photos', { exact: true }).setInputFiles(await pngFile(page));
  const photoResponse = await uploaded;
  expect(photoResponse.status()).toBe(201);
  const photo = await photoResponse.json();
  expect(photo.url).toMatch(/^\/api\/dev\/storage\/public\/photos\//);
  await expect(page.locator('[data-err="photos"]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('[data-err="photos"] img')).toHaveCount(1);
  // One photo does not publish. Two more carry the listing to the floor and cover the key categories the
  // upload step checks, without disturbing the single upload asserted above.
  await uploadPublishablePhotos(page, { count: 2 });
  const posted = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/me/listings');
  await page.getByRole('button', { name: 'Submit Property', exact: true }).click();
  const response = await posted;
  expect(response.status(), 'only the wizard may create this listing').toBe(201);
  const body = response.request().postDataJSON();
  expect(body.formDetails).toEqual(details);
  const expected = {
    deal: 'rent', propertyType: 'Flat', area: 875.5, carpetArea: 875.5, builtUpArea: 1000.25,
    areaUnit: 'sqft', bhk: 2, bathrooms: 2, balconies: 0, parking: 0, floor: 0, totalFloors: 15,
    facing: 'East', overlooking: 'Garden', furnishing: 'semi-furnished', locality: 'Baner',
    price: 31000, deposit: 0, maintenance: 2500, pincode: '411045', electricityMeterNo: meter,
    address: `${details.flatNumber}, ${details.tower}, ${details.society}, ${details.street}`,
    description, formDetails: details,
  };
  expect(body).toMatchObject(expected);
  // The first upload is the one whose response shape was asserted, so it must lead the list.
  expect(body.images).toHaveLength(3);
  expect(body.images[0]).toBe(photo.url);
  expect(body.lat).toBeCloseTo(Number(coordinates[1]), 4);
  expect(body.lng).toBeCloseTo(Number(coordinates[2]), 4);
  const created = { ...(await response.json()), headers };
  expect(created.id).toEqual(expect.any(String));
  expect(created.id).not.toBe('');
  await expect(page.getByRole('heading', { name: 'Property Listed Successfully!', exact: true })).toBeVisible();
  const saved = await readListing(request, created);
  expect(saved).toMatchObject({ ...expected, lat: body.lat, lng: body.lng });
  expect(saved.formDetails).toEqual(details);
  expect(saved.images).toEqual(body.images);
  expect(writes().filter((entry) => entry.method() === 'POST'
    && new URL(entry.url()).pathname === '/api/me/listings')).toHaveLength(1);
  await openEdit(page, created);
  await openEdit(page, created, { reload: true });
  await expect(field(page, /^Total Floors \*$/).locator('.dz-dropdown__trigger')).toContainText('15');
  await expect(field(page, /^Facing$/).locator('.dz-dropdown__trigger')).toContainText('East');
  await expect(field(page, /^Overlooking$/).locator('.dz-dropdown__trigger')).toContainText('Garden');
  await expect(page.getByRole('button', { name: 'Semi-Furnished', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.furn-tile').filter({ has: page.getByText('Wardrobe', { exact: true }) })).toHaveClass(/checked/);
  for (const label of [/^Balconies$/, /^Parking Spaces$/]) {
    await expect(field(page, label).getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await nextStep(page, 'Location');
  await expectAddress(page, details);
  await expect(page.locator('[data-err="locality"]')).toContainText('Baner');
  await expect(pin).toContainText(`${Number(body.lat).toFixed(4)}, ${Number(body.lng).toFixed(4)}`);
  await nextStep(page, 'Price & terms');
  await expect(page.locator('input[data-err="monthlyRent"]')).toHaveValue('31,000');
  await expect(page.locator('input[data-err="deposit"]')).toHaveValue('0');
  await expect(page.getByPlaceholder('e.g. 2,500', { exact: true })).toHaveValue('2,500');
  await expect(page.locator('[data-err="availableFrom"]')).toHaveText('20/01/2027');
  for (const [label, option] of [[/^Agreement Duration$/, '24 months'], [/^Lock-in Period$/, '6 months'], [/^Notice Period$/, '2 months']]) {
    await expect(field(page, label).locator('.dz-dropdown__trigger')).toContainText(option);
  }
  for (const name of ['Family', 'Bachelors', 'Not Allowed', 'Veg Only', 'Charged Extra']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  for (const name of ['Anyone', 'Company Lease', 'Allowed', 'Veg & Non-veg', 'Included in Rent']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false');
  }
  await nextStep(page, 'Photos & documents');
  await expect(page.getByLabel('Electricity Consumer No.', { exact: true })).toHaveValue(meter);
  await expect(page.locator('textarea')).toHaveValue(description);
  await expect(page.locator('[data-err="photos"] img')).toHaveCount(3);
  // The photo whose upload response was asserted above is the cover, so it reloads first.
  await expect(page.locator('[data-err="photos"] img').first()).toHaveAttribute('src', photo.url);
  expect(writes().filter((entry) => entry.method() === 'PATCH')).toHaveLength(0);
});