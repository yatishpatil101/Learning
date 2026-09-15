import { createRequire } from 'node:module';
import { test, expect, ACTORS } from '../fixtures/live.js';
import { API, authHeaders, seedConsent, uniqueMobile } from '../helpers/liveAuth.js';

const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { PDFDocument } = requireFrontend('pdf-lib');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=', 'base64');
const ownershipPath = (id) => `/properties/${id}/verification/ownership`;
const panelOf = (page) => page.getByRole('region', { name: 'Ownership document checks' });
let created = [];

// Only this spec's rows leave the working queue; never reset shared listings or account permissions.
test.afterEach(async ({ request }) => {
  if (!created.length) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    const response = await request.patch(`${API}/properties/${id}/status`, {
      headers, data: { status: 'rejected', reason: 'Synthetic ownership-review fixture cleanup' },
    });
    expect(response.status()).toBe(200);
  }
  created = [];
});

async function seedListing(request, deal = 'rent') {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const photo = await request.post(`${API}/me/photos`, {
    headers: { authorization: headers.authorization },
    multipart: { file: { name: 'ownership-review-room.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(photo.status()).toBe(201);
  const { url } = await photo.json();
  const title = `Ownership review ${deal} ${mobile}`;
  const response = await request.post(`${API}/me/listings`, {
    headers, data: {
      title, deal, propertyType: 'Flat', bhk: 2, bathrooms: 2, price: deal === 'rent' ? 31000 : 9500000,
      area: 900, locality: 'Baner', city: 'Pune', address: 'O-201, Evidence Court, Baner Road',
      pincode: '411045', electricityMeterNo: `00${mobile}`, images: [url],
    },
  });
  expect(response.status(), 'fresh listing must be created by the real API').toBe(201);
  const listing = await response.json();
  created = [...created, listing.id];
  return { id: listing.id, title, headers, meter: `00${mobile}` };
}

async function uploadDocument(request, listing, category, fileName) {
  const issueDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText(`TEST DOCUMENT: ${category}\nIssued: ${issueDate}\nO-201, Evidence Court, Baner Road\nConsumer no: ${listing.meter}`);
  const buffer = Buffer.from(await pdf.save());
  const response = await request.post(`${API}/me/documents/${listing.id}`, {
    headers: { authorization: listing.headers.authorization },
    multipart: { category, file: { name: fileName, mimeType: 'application/pdf', buffer } },
  });
  expect(response.status(), 'evidence must cite real uploaded PDF bytes').toBe(201);
  return { ...await response.json(), issueDate, buffer };
}

async function openCase(page, listing) {
  await page.goto('/admin/properties?tab=verify');
  await page.getByPlaceholder(/Search title, owner, locality/).fill(listing.title);
  const review = page.getByRole('button', { name: 'Review', exact: true });
  await expect(review).toHaveCount(1, { timeout: 20000 });
  await review.click();
  await expect(page.getByRole('dialog', { name: 'Verify property' })).toBeVisible();
  return panelOf(page);
}

function ownershipResponse(page, listing, method, suffix = '') {
  return page.waitForResponse((response) => new URL(response.url()).pathname === `/api${ownershipPath(listing.id)}${suffix}`
    && response.request().method() === method);
}

async function recordDocument(page, listing, document, suggestedLabel) {
  const panel = panelOf(page);
  await panel.getByRole('button', { name: 'Uploaded document', exact: true }).click();
  await page.getByRole('option', { name: `${document.fileName} — ${document.category}`, exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Evidence document type', exact: true })).toContainText(suggestedLabel);
  await expect(panel.getByLabel('Document issue date', { exact: true })).toHaveValue('');
  await expect(panel.getByRole('button', { name: 'Record evidence', exact: true })).toBeDisabled();
  await panel.getByLabel('Document issue date', { exact: true }).fill(document.issueDate);
  const recorded = ownershipResponse(page, listing, 'POST', '/evidence');
  await panel.getByRole('button', { name: 'Record evidence', exact: true }).click();
  const response = await recorded;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    // The date is read off paper, so it is anchored to Pune's midnight, not the browser's or UTC's.
    documentId: document.id, issuedAt: new Date(`${document.issueDate}T00:00:00+05:30`).toISOString(),
  });
  expect(response.request().postDataJSON()).not.toHaveProperty('subjectName');
  await expect(panel.getByRole('status')).toContainText('Evidence recorded.');
  return response.json();
}

test('rent: retry vault read, record a real bill, explicitly grant the public badge and withdraw with a reason', async ({ page, browser, request, login }) => {
  const listing = await seedListing(request);
  const bill = await uploadDocument(request, listing, 'Electricity Bill', 'msedcl-original.pdf');
  const adminHeaders = await authHeaders(ACTORS.admin);
  await login.asAdmin();
  let grantRequests = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === `/api${ownershipPath(listing.id)}`) grantRequests += 1;
  });
  // StrictMode double-invokes the panel's load effect, so a one-shot abort never reaches it; the
  // route must stay up until the retry for the recovery path to be real.
  await page.route(`**/api${ownershipPath(listing.id)}/documents`, (route) => route.abort('failed'));
  const panel = await openCase(page, listing);
  await expect(panel.getByRole('alert')).toBeVisible();
  await page.unroute(`**/api${ownershipPath(listing.id)}/documents`);
  await panel.getByRole('button', { name: 'Retry ownership evidence' }).click();
  await expect(panel.getByText('No evidence recorded.', { exact: true })).toBeVisible();
  await expect(panel).toContainText('address_proof');
  await expect(panel).not.toContainText('title_proof');
  await expect(panel).toContainText(listing.meter);
  await expect(panel).toContainText('not a legal title guarantee');
  const grant = panel.getByRole('button', { name: 'Grant ownership verification', exact: true });
  await expect(grant).toBeDisabled();
  const link = panel.getByRole('link', { name: `Open original file — ${bill.fileName}`, exact: true });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const downloaded = await request.get(await link.getAttribute('href'));
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()['content-type']).toContain('application/pdf');
  expect(await downloaded.body()).toEqual(bill.buffer);
  const evidence = await recordDocument(page, listing, bill, 'Electricity bill');
  expect(evidence).toMatchObject({ verified: false, missingKinds: [] });
  expect(evidence.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: bill.id, docType: 'electricity_bill', current: true })]));
  expect(grantRequests, 'recording must never auto-grant').toBe(0);
  await expect(grant).toBeEnabled();

  const granted = ownershipResponse(page, listing, 'POST');
  await grant.click();
  const grantResponse = await granted;
  expect(grantResponse.status()).toBe(200);
  expect(await grantResponse.json()).toMatchObject({ verified: true });
  await expect(panel.getByText('Ownership verified', { exact: true })).toBeVisible();
  const published = await request.patch(`${API}/properties/${listing.id}/status`, {
    headers: adminHeaders, data: { status: 'approved', reason: 'Ownership review fixture publication' },
  });
  expect(published.status()).toBe(200);

  const guestContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const guest = await guestContext.newPage();
    await seedConsent(guest);
    await guest.goto(`/property/${listing.id}`);
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    const badge = guest.locator('.tag-strip').getByText('Ownership Verified', { exact: true });
    await expect(badge).toBeVisible();
    await expect(panelOf(guest)).toHaveCount(0);
    await expect(guest.getByText(bill.fileName, { exact: true })).toHaveCount(0);
    const forbidden = await guestContext.request.get(`${API}${ownershipPath(listing.id)}/documents`);
    expect([401, 403]).toContain(forbidden.status());
    const ownerDenied = await request.get(`${API}${ownershipPath(listing.id)}/documents`, { headers: listing.headers });
    expect(ownerDenied.status()).toBe(403);

    const withdraw = panel.getByRole('button', { name: 'Withdraw ownership verification', exact: true });
    await expect(withdraw).toBeDisabled();
    await panel.getByLabel('Reason for withdrawal').fill('   ');
    await expect(withdraw).toBeDisabled();
    const reason = 'Consumer number & property address require a second check';
    await panel.getByLabel('Reason for withdrawal').fill(reason);
    const revoked = ownershipResponse(page, listing, 'DELETE');
    await withdraw.click();
    const revokeResponse = await revoked;
    expect(revokeResponse.status()).toBe(200);
    expect(new URL(revokeResponse.url()).searchParams.get('reason')).toBe(reason);
    const revokedCase = await revokeResponse.json();
    expect(revokedCase.verified).toBe(false);
    expect(revokedCase.evidence).toHaveLength(1);
    await expect(panel.getByRole('status')).toContainText('Ownership verification withdrawn.');
    await guest.reload();
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(badge).toHaveCount(0);
    const publicListing = await guestContext.request.get(`${API}/properties/${listing.id}`);
    expect(publicListing.status()).toBe(200);
    expect(await publicListing.json()).toMatchObject({ ownershipVerified: false });
  } finally {
    await guestContext.close();
  }
});

test('sale: a bill and supporting sale deed cannot replace Index II', async ({ page, request, login }) => {
  const listing = await seedListing(request, 'buy');
  const bill = await uploadDocument(request, listing, 'Electricity Bill', 'sale-msedcl.pdf');
  const deed = await uploadDocument(request, listing, 'Sale Deed', 'supporting-deed.pdf');
  const index = await uploadDocument(request, listing, 'Index II', 'registered-index-ii.pdf');
  await login.asAdmin();
  const panel = await openCase(page, listing);
  await expect(panel.getByText('No evidence recorded.', { exact: true })).toBeVisible();
  await expect(panel).toContainText('title_proof');
  await expect(panel).toContainText('address_proof');
  expect((await recordDocument(page, listing, bill, 'Electricity bill')).missingKinds).toEqual(['title_proof']);
  const supporting = await recordDocument(page, listing, deed, 'Sale deed (supporting only)');
  expect(supporting).toMatchObject({ verified: false, missingKinds: ['title_proof'] });
  const grant = panel.getByRole('button', { name: 'Grant ownership verification', exact: true });
  await expect(grant).toBeDisabled();
  const complete = await recordDocument(page, listing, index, 'Index II');
  expect(complete).toMatchObject({ verified: false, missingKinds: [] });
  await expect(grant).toBeEnabled();
  const granted = ownershipResponse(page, listing, 'POST');
  await grant.click();
  const response = await granted;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ verified: true });
});

test('a verified rental changed to a sale needs a fresh badge decision but can still be published', async ({ page, request, login }) => {
  const listing = await seedListing(request);
  const bill = await uploadDocument(request, listing, 'Electricity Bill', 'rent-to-sale-bill.pdf');
  await login.asAdmin();
  const panel = await openCase(page, listing);
  await recordDocument(page, listing, bill, 'Electricity bill');
  const granted = ownershipResponse(page, listing, 'POST');
  await panel.getByRole('button', { name: 'Grant ownership verification', exact: true }).click();
  expect((await granted).status()).toBe(200);
  const headers = await authHeaders(ACTORS.admin);
  const publish = () => request.patch(`${API}/properties/${listing.id}/status`, {
    headers, data: { status: 'approved', reason: 'Evidence recheck fixture publication' },
  });
  expect((await publish()).status()).toBe(200);
  const changed = await request.patch(`${API}/me/listings/${listing.id}`, {
    headers: listing.headers, data: { deal: 'buy' },
  });
  expect(changed.status()).toBe(200);
  expect(await changed.json()).toMatchObject({ ownershipVerified: false });
  expect((await publish()).status()).toBe(200);
  const publicListing = await request.get(`${API}/properties/${listing.id}`);
  expect(publicListing.status()).toBe(200);
  expect(await publicListing.json()).toMatchObject({ deal: 'buy', status: 'approved', ownershipVerified: false });
  const regrant = await request.post(`${API}${ownershipPath(listing.id)}`, { headers });
  expect(regrant.status()).toBe(400);
  expect((await regrant.json()).message).toContain('title_proof');
});

