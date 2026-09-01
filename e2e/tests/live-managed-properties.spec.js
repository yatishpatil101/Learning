// @ts-check
/**
 * LIVE: the owner hub against the real API (D32).
 *
 * The owner hub used to be the largest single-player surface left in the app: the Rent-o-meter, the
 * property passport, its document vault and the rent tracker all read and wrote `localStorage`, so
 * an owner who registered a flat on their phone had no flat on their laptop. D32 moved the whole
 * `managed` domain across the seam, and this spec exists to prove the *endpoints*, not the screens.
 *
 * That distinction is the whole reason for a live spec here. The mock specs in
 * `consumer/account/owner-hub.spec.js` still pass unchanged after the port, because the mock
 * provider writes the same browser keys they assert on — which is exactly why they cannot tell you
 * the port happened. A silent regression to `lib/data/managedProperty.js` would keep every one of
 * them green while the owner's data went back to living in one browser.
 *
 * Each test therefore waits on a specific request and asserts its status, then re-reads through the
 * API to prove the row survived the page that made it.
 *
 * Not covered here on purpose: publish. It mints a real listing in the moderation queue, and the
 * live database is reset once per suite rather than once per test, so a publish would leak a row
 * into every spec that counts properties afterwards. Publish's contract — including the 422 on a
 * record that cannot legally become a listing — is pinned in `ManagedPropertyFlowTest` instead,
 * where the transaction rolls back.
 */
import { test, expect } from '@playwright/test';
import { IGNORE as SHARED_IGNORE } from '../helpers/console.js';
import { signedInAs, authHeaders, API } from '../helpers/liveAuth.js';

/** A seeded owner. Any verified user will do — a managed record has no prerequisites. */
const OWNER = { mobile: '9470744469' };

/** See the long note in `live-property-integration.spec.js`: live runs cross a TLS-intercepting proxy. */
const IGNORE = new RegExp(`${SHARED_IGNORE.source}|CDN|net::ERR|ERR_CERT`, 'i');

/** Every managed record this spec created, so `afterAll` can put the database back. */
const created = [];

/** Drive the Rent-o-meter to a saved property and return its id, taken from the passport URL. */
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

  /* The suite reseeds once, not per test, so anything written here is still here for every spec
     that follows. Deleting through the API rather than the UI keeps the cleanup honest: it does not
     depend on the screen it is cleaning up after still working. */
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

    // The id in the URL is a server UUID, not the `MP-…` the browser store used to mint. That is the
    // load-bearing difference: the document vault is keyed by it, so an `MP-…` here would mean the
    // passport was still talking to localStorage.
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);

    // Re-read from outside the page. A record that only exists in the tab that made it is the exact
    // failure this port was for.
    const res = await fetch(`${API}/me/managed-properties/${id}`, { headers: await authHeaders(OWNER.mobile) });
    expect(res.status).toBe(200);
    const rec = await res.json();
    expect(rec.visibility).toBe('private');
    expect(rec.status).toBe('managed');
    // The estimate the owner was shown, kept verbatim — it is their evidence for the number, and
    // re-deriving it later from a changed model would quietly rewrite history.
    expect(rec.valuation).toBeTruthy();
  });

  test('the passport vault round-trips through /me/documents/managed/{id}', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    const id = await estimateAndSave(page);

    await expect(page.getByText('Passport completeness')).toBeVisible();

    // A separate route family from the per-listing vault, against a separate table (V93). The papers
    // on a flat you own but have not advertised are not shareable with buyers, and routing them
    // through `/me/documents/{propId}` would mean the passport only worked once you had advertised.
    const uploaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/me/documents/managed/${id}`
        && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page.setInputFiles('input[type="file"]', {
      name: 'live-sale-deed.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 live passport vault'),
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

    // PATCH is key-presence based on both providers, so a write that touched three fields must not
    // have blanked the rest of the record. Asserting the untouched valuation is the cheap way to
    // catch a mapper that rebuilt the whole body from a partial patch.
    const rec = await (await fetch(`${API}/me/managed-properties/${id}`, { headers: await authHeaders(OWNER.mobile) })).json();
    expect(rec.rented).toBe(true);
    expect(rec.tenantName).toBe('Rahul Kulkarni');
    expect(rec.valuation).toBeTruthy();
  });
});
