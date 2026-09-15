// @ts-check
// Assert network writes and independent reads so browser-local success cannot pass as persistence.
import { test, expect } from '@playwright/test';
import { PDFDocument } from '../../frontend/node_modules/pdf-lib/cjs/index.js';
import { IGNORE as SHARED_IGNORE } from '../helpers/console.js';
import { signedInAs, authHeaders, API } from '../helpers/liveAuth.js';

async function unsignedPdfBuffer() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
}

const OWNER = { mobile: '9470744469' };

// The local environment's TLS-intercepting proxy can produce external resource errors.
const IGNORE = new RegExp(`${SHARED_IGNORE.source}|CDN|net::ERR|ERR_CERT`, 'i');

// Track created IDs so teardown leaves other specs' managed records intact.
const created = [];

async function estimateAndSave(page) {
  await page.goto('/dashboard#owner-hub');
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Estimate now/i }).click();
  await expect(page.getByText(/Estimated monthly rent/i)).toBeVisible();

  const posted = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/me/managed-properties'
      && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: /Save as my property/i }).click();
  expect((await posted).status()).toBe(201);

  await page.waitForURL(/\/owner-hub\/property\//, { timeout: 20000 });
  const id = new URL(page.url()).pathname.split('/').pop();
  created.push(id);
  return id;
}

test.describe('LIVE: managed properties against the real API', () => {
  let errors;
  let apiFails;

  test.beforeEach(async ({ page }) => {
    errors = [];
    apiFails = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) apiFails.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
  });

  test.afterEach(() => {
    expect(errors.filter((e) => !IGNORE.test(e)), `failed API calls: ${apiFails.join(', ') || 'none'}`).toEqual([]);
  });

  // The suite reseeds once; API cleanup must not depend on the screen under test still working.
  test.afterAll(async () => {
    const headers = await authHeaders(OWNER.mobile);
    for (const id of created) {
      await fetch(`${API}/me/managed-properties/${id}`, { method: 'DELETE', headers });
    }
    created.length = 0;
  });

  test('the Rent-o-meter registers through POST /me/managed-properties, and the record outlives the tab', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    const id = await estimateAndSave(page);

    // A server UUID distinguishes the vault's identity from a browser-generated managed ID.
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);

    // An independent read cannot be satisfied by a record stored only in this tab.
    const res = await fetch(`${API}/me/managed-properties/${id}`, { headers: await authHeaders(OWNER.mobile) });
    expect(res.status).toBe(200);
    const rec = await res.json();
    expect(rec.visibility).toBe('private');
    expect(rec.status).toBe('managed');
    // Persist the quoted valuation so later model changes cannot rewrite the owner's evidence.
    expect(rec.valuation).toBeTruthy();
  });

  test('the passport vault round-trips through /me/documents/managed/{id}', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    const id = await estimateAndSave(page);

    await expect(page.getByText('Passport completeness')).toBeVisible();

    // A managed vault must work without advertising the property or sharing its documents with buyers.
    const uploaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/me/documents/managed/${id}`
        && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page.setInputFiles('input[type="file"]', {
      name: 'live-sale-deed.pdf',
      mimeType: 'application/pdf',
      buffer: await unsignedPdfBuffer(),
    });
    expect((await uploaded).status()).toBe(201);
    await expect(page.getByText('live-sale-deed.pdf')).toBeVisible();

    const deleted = page.waitForResponse(
      (r) => new RegExp(`^/api/me/documents/managed/${id}/[^/]+$`).test(new URL(r.url()).pathname)
        && r.request().method() === 'DELETE',
      { timeout: 20000 },
    );
    await page.getByRole('button', { name: /Delete live-sale-deed\.pdf/i }).click();
    expect((await deleted).status()).toBeLessThan(300);
    await expect(page.getByText('live-sale-deed.pdf')).toHaveCount(0);
  });

  test('rent tracking writes through PATCH, and the dashboard reads it back', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    const id = await estimateAndSave(page);

    const patched = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/me/managed-properties/${id}`
        && r.request().method() === 'PATCH',
      { timeout: 20000 },
    );
    await page.getByPlaceholder('e.g. Rohit More').fill('Rahul Kulkarni');
    await page.getByRole('button', { name: /Start tracking/i }).click();
    expect((await patched).status()).toBe(200);

    // Untouched valuation catches a partial PATCH that accidentally blanks the rest of the record.
    const rec = await (await fetch(`${API}/me/managed-properties/${id}`, { headers: await authHeaders(OWNER.mobile) })).json();
    expect(rec.rented).toBe(true);
    expect(rec.tenantName).toBe('Rahul Kulkarni');
    expect(rec.valuation).toBeTruthy();
  });
});
