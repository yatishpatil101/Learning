import { test, expect } from '@playwright/test';
import { PDFDocument } from '../../frontend/node_modules/pdf-lib/cjs/index.js';
import { uploadPublishablePhotos } from '../helpers/listingPhotos.helper.js';
import { LIST_PROPERTY_DRAFT_KEY } from '../helpers/listingForm.helper.js';
import { IGNORE as SHARED_IGNORE } from '../helpers/console.js';
import { signedInAs, signedInAsNew, apiLogin, authHeaders, ownerIdOf, API, uploadedListingPhotos } from '../helpers/liveAuth.js';

// OWNER has four listings, including one non-public row, to distinguish /me/listings from public search.
const OWNER = { mobile: '9470744469', name: 'Meera Deshpande', total: 4, publiclyVisible: 3 };

// Inline base64 because CSP refuses a `data:` fetch from page-side helpers.
const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const IGNORE = new RegExp(`${SHARED_IGNORE.source}|CDN|net::ERR|ERR_CERT`, 'i');

async function unsignedPdfBuffer() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
}

function watchApiFailures(page, sink) {
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) sink.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
}

function watchApiCalls(page, sink) {
  page.on('response', (r) => {
    if (r.url().includes('/api/')) sink.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
}

// Capture bodies in the route handler because navigation can dispose response buffers.
async function captureJson(page, urlRe) {
  const bodies = [];
  await page.route(urlRe, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    try {
      const response = await route.fetch();
      const status = response.status();
      const headers = { ...response.headers() };
      delete headers['content-encoding'];
      delete headers['content-length'];
      const body = await response.body();
      if (status === 200) {
        try {
          bodies.push(JSON.parse(body.toString('utf8')));
        } catch {
        }
      }
      await route.fulfill({ status, headers, body });
    } catch {
    }
  });
  return bodies;
}

async function lastJson(bodies, timeout = 20000) {
  await expect.poll(() => bodies.length, { timeout }).toBeGreaterThan(0);
  return bodies[bodies.length - 1];
}

const ADMIN = { mobile: '9000000000' };

async function signedInAsAdmin(page) {
  const { accessToken } = await apiLogin(ADMIN.mobile);
  const profile = await fetch(`${API}/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(profile.status, 'loading the admin profile').toBe(200);
  const user = await profile.json();
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(({ token, signedInUser }) => {
    localStorage.setItem('draazyTokens', JSON.stringify({ accessToken: token }));
    localStorage.setItem('draazyUser', JSON.stringify(signedInUser));
    sessionStorage.clear();
  }, { token: accessToken, signedInUser: user });
  await page.reload({ waitUntil: 'domcontentloaded' });
}

const CHATTER = { mobile: '9708919481', name: 'Omkar Kulkarni' };

test.describe('LIVE: property domain against the real API', () => {
  let errors;
  let apiFails;

  test.beforeEach(async ({ page }) => {
    errors = [];
    apiFails = [];
    watchApiFailures(page, apiFails);
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
  });

  test.afterEach(() => {
    expect(errors.filter((e) => !IGNORE.test(e)), `failed API calls: ${apiFails.join(', ') || 'none'}`).toEqual([]);
  });

  test('the catalogue is served by the API, not the mock', async ({ page }) => {
    const call = page.waitForResponse((r) => r.url().includes('/api/properties') && r.status() === 200);
    await page.goto('/listings');
    const res = await call;
    const body = await res.json();

    expect(body).toHaveProperty('totalElements');
    const cards = page.locator('[data-testid="property-card"], a[href^="/property/"]');
    await expect(cards.first()).toBeVisible({ timeout: 15000 });
    expect(body.totalElements).toBeGreaterThan(0);
  });

  test('detail, similar and location-insights render from API data', async ({ page }) => {
    await page.goto('/listings');
    const first = page.locator('a[href^="/property/"]').first();
    await expect(first).toBeVisible({ timeout: 15000 });
    const href = await first.getAttribute('href');

    // The location tab must mount before it can request the filtered count.
    const counted = page.waitForResponse(
      (r) => r.url().includes('/api/properties') && /[?&]size=1(&|$)/.test(r.url()),
      { timeout: 20000 },
    );
    await page.goto(`${href}?tab=location`);
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    const res = await counted;
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.totalElements).toBeGreaterThan(0);
    expect(new URL(res.url()).searchParams.get('locality')).toBeTruthy();
  });

  test('My Listings uses /me/listings and shows non-public statuses', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);

    const mine = await captureJson(page, /\/api\/me\/listings(\?|$)/);
    await page.goto('/dashboard');
    const body = await lastJson(mine);
    const rows = Array.isArray(body) ? body : (body.content ?? []);

    expect(rows.length).toBe(OWNER.total);
    expect(rows.length).toBeGreaterThan(OWNER.publiclyVisible);
    expect(rows.some((r) => r.status && r.status !== 'approved')).toBe(true);
  });

  test('the document vault round-trips upload and delete through /me/documents', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);

    // Wait for the listing selector so uploads target an owner property.
    const mine = page.waitForResponse((r) => r.url().includes('/api/me/listings') && r.status() === 200);
    await page.goto('/dashboard#documents');
    await mine;
    await expect(page.getByRole('heading', { name: 'Document Vault' })).toBeVisible();
    const ownerCtx = page.getByRole('button', { name: 'Property docs' });
    await expect(ownerCtx).toBeVisible();
    await ownerCtx.click();

    // Clear leftovers so a failed earlier run cannot exhaust the fixture slot.
    const stale = page.getByRole('button', { name: 'Remove Sale Deed' });
    if (await stale.count()) {
      await stale.click();
      await expect(stale).toHaveCount(0);
    }

    const uploadTile = page.getByRole('button', { name: 'Upload Sale Deed' });
    await expect(uploadTile).toBeVisible();
    const posted = page.waitForResponse(
      (r) => /\/api\/me\/documents\/[^/?]+$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      uploadTile.click(),
    ]);
    await chooser.setFiles({ name: 'live-sale-deed.pdf', mimeType: 'application/pdf', buffer: await unsignedPdfBuffer() });
    expect((await posted).status()).toBe(201);

    const removeBtn = page.getByRole('button', { name: 'Remove Sale Deed' });
    await expect(removeBtn).toBeVisible();

    const deleted = page.waitForResponse(
      (r) => /\/api\/me\/documents\/[^/?]+\/[^/?]+$/.test(r.url()) && r.request().method() === 'DELETE',
      { timeout: 20000 },
    );
    await removeBtn.click();
    expect((await deleted).status()).toBeLessThan(300);
    await expect(page.getByRole('button', { name: 'Upload Sale Deed' })).toBeVisible();
  });

  test('the owner wizard creates the listing through POST /me/listings (D219)', async ({ page }) => {
    const ownerMobile = await signedInAsNew(page);
    const ownerId = ownerIdOf(await authHeaders(ownerMobile));

    await page.addInitScript(({ key, ownerId }) => {
      localStorage.setItem(key, JSON.stringify({
        propertyType: 'flat', bhk: '2', bathrooms: '2', carpetArea: '850', deal: 'rent',
        floor: '9', totalFloors: '14', availableFrom: '2026-09-01',
        __owner: ownerId,
      }));
      // Seed consent so the delayed banner cannot intercept the wizard controls.
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
        necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
      }));
    }, { key: LIST_PROPERTY_DRAFT_KEY, ownerId });

    // One sign-in preserves the OTP budget across the dependent dashboard checks.
    const calls = [];
    watchApiCalls(page, calls);
    await page.goto('/list-property');

    const next = page.getByRole('button', { name: /Next Step/i });
    await next.click();

    await page.locator('[data-err="location"] input[role="combobox"]').fill('Baner');
    await page.getByRole('button', { name: 'Search location' }).click();

    // Wait for reverse-geocoding to select a locality before advancing.
    await expect(page.locator('[data-err="locality"] .dz-dropdown__value'))
      .not.toHaveClass(/is-placeholder/, { timeout: 15_000 });

    // A unique society name makes this run's server row identifiable.
    const society = `Seam Spec Residency ${Date.now()}`;
    const address = { flatNumber: 'A-902', society, pincode: '411045' };
    for (const [field, value] of Object.entries(address)) {
      await page.locator(`input[data-err="${field}"]`).fill(value);
    }
    await next.click();
    for (const [field, value] of Object.entries({ monthlyRent: '31000', deposit: '90000' })) {
      await page.locator(`input[data-err="${field}"]`).fill(value);
    }
    await next.click();
    const photo = page.locator('[data-err="photos"] label.upload-zone input[type="file"][multiple]');
    await expect(photo).toBeAttached({ timeout: 20_000 });
    const uploaded = page.waitForResponse(
      (r) => r.url().includes('/me/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await uploadPublishablePhotos(page);
    expect((await uploaded).status()).toBe(201);

    const documentWrites = [];
    page.on('request', (r) => {
      if (/\/api\/me\/documents\//.test(new URL(r.url()).pathname) && r.method() === 'POST') documentWrites.push(r.url());
    });
    const created = page.waitForResponse(
      (r) => /\/api\/me\/listings$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: /Submit Property/i }).click();

    const res = await created;
    expect(res.status(), `API calls: ${calls.join(', ')}`).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();

    await expect(page.locator('text=/Submitted for review/i')).toBeVisible({ timeout: 20_000 });
    expect(documentWrites).toEqual([]);

    const mine = await captureJson(page, /\/api\/me\/listings(\?|$)/);
    await page.goto('/dashboard');
    const rows = await lastJson(mine).then((b) => (Array.isArray(b) ? b : (b.content ?? [])));
    expect(rows.some((r) => String(r.id) === String(body.id))).toBe(true);

    const mirrored = await page.evaluate(() => Object.keys(localStorage)
      .filter((k) => k.startsWith('draazyListings:'))
      .flatMap((k) => {
        try { return JSON.parse(localStorage.getItem(k) || '[]') || []; } catch { return []; }
      }));
    expect(mirrored, 'the wizard kept a browser-side copy of a server listing').toEqual([]);
  });

  // API-created listings model a browser that has no local listing fixture.
  async function fileListing(mobile, title) {
    const headers = await authHeaders(mobile);
    const res = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        deal: 'rent',
        propertyType: 'flat',
        bhk: 3,
        price: 27000,
        deposit: 81000,
        area: 1150,
        areaUnit: 'sqft',
        furnishing: 'semi-furnished',
        locality: 'Baner',
        city: 'Pune',
        description: 'Filed through the API by the seam spec.',
        images: await uploadedListingPhotos(headers),
      }),
    });
    // Read the native response once because its body cannot be consumed twice.
    const text = await res.text();
    expect(res.status, text).toBe(201);
    return JSON.parse(text);
  }

  test('an owner listing prefills the edit form from the server, can be taken down, and frees a quota slot (D237, D238)', async ({ page }) => {
    test.slow();
    const mobile = await signedInAsNew(page);
    const first = await fileListing(mobile, 'Take Down Proof Flat');

    await test.step('the edit form prefills from the server, not from this browser', async () => {
      await page.goto(`/list-property?edit=${first.slug || first.id}`);
      await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1150', { timeout: 25_000 });
      await expect(page.locator('[data-err="bhk"] [aria-pressed="true"]'))
        .toHaveText('3', { timeout: 15_000 });
    });

    const headers = await authHeaders(mobile);
    // The single-listing quota makes the final retry observable.
    const blocked = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Second Flat, Blocked', deal: 'rent', propertyType: 'flat', bhk: 2,
        price: 25000, locality: 'Baner', city: 'Pune', images: await uploadedListingPhotos(headers),
      }),
    });
    expect(blocked.status).toBe(422);

    await page.goto('/dashboard');
    // Navigate to My Properties because Overview contains no listing actions.
    await page.getByRole('link', { name: /My Properties/i })
      .or(page.getByRole('button', { name: /My Properties/i })).first().click();
    const card = page.getByText('Take Down Proof Flat').first();
    await expect(card).toBeVisible({ timeout: 25_000 });

    const removed = page.waitForResponse(
      (r) => /\/api\/me\/listings\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'DELETE',
      { timeout: 30_000 },
    );
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /Take down|Withdraw/i }).first().click();
    expect((await removed).status()).toBe(200);

    const mineRes = await fetch(`${API}/me/listings?size=100`, { headers });
    const mineBody = await mineRes.json();
    const mineRows = Array.isArray(mineBody) ? mineBody : (mineBody.content ?? []);
    const taken = mineRows.find((r) => String(r.id) === String(first.id));
    expect(taken, 'the listing should still be on file').toBeTruthy();
    expect(taken.archived).toBe(true);

    const retried = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Second Flat, Allowed', deal: 'rent', propertyType: 'flat', bhk: 2,
        price: 25000, locality: 'Baner', city: 'Pune', images: await uploadedListingPhotos(headers),
      }),
    });
    expect(retried.status, await retried.text()).toBe(201);
  });
});

test.describe('LIVE: listing moderation against the real API', () => {
  let errors;
  let apiFails;

  test.beforeEach(async ({ page }) => {
    errors = [];
    apiFails = [];
    watchApiFailures(page, apiFails);
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
  });

  test.afterEach(() => {
    expect(errors.filter((e) => !IGNORE.test(e)), `failed API calls: ${apiFails.join(', ') || 'none'}`).toEqual([]);
  });

  test('the admin list is served by /admin/properties and includes unapproved listings', async ({ page }) => {
    await signedInAsAdmin(page);

    // Exclude the concurrent recheck request so this capture targets the moderation queue.
    const queued = await captureJson(
      page,
      (url) => url.pathname === '/api/admin/properties' && url.searchParams.get('status') === 'pending',
    );
    await page.goto('/admin/properties');
    const body = await lastJson(queued);
    const pageBody = body.data ?? body;
    const rows = pageBody.content ?? pageBody.items ?? [];

    expect(pageBody.totalElements ?? pageBody.total ?? rows.length).toBeGreaterThanOrEqual(rows.length);
    expect(rows.some((r) => r.status !== 'approved')).toBe(true);
    expect(rows.every((r) => typeof r.archived === 'boolean')).toBe(true);
  });

  test('featured cannot be switched by hand: no console toggle and no route (D292)', async ({ page, request }) => {
    await signedInAsAdmin(page);
    await page.goto('/admin/properties');
    await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('button[title="Feature"], button[title="Unfeature"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Toggle featured' })).toHaveCount(0);

    const res = await request.post(`${API}/properties/00000000-0000-4000-8000-000000000000/toggle-featured`);
    expect([401, 403, 404, 405]).toContain(res.status());
  });
});

test.describe('LIVE: identity verification against the real API', () => {
  let errors;
  let apiFails;
  let apiCalls;

  test.beforeEach(async ({ page }) => {
    errors = [];
    apiFails = [];
    apiCalls = [];
    watchApiFailures(page, apiFails);
    watchApiCalls(page, apiCalls);
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
  });

  test.afterEach(() => {
    expect(errors.filter((e) => !IGNORE.test(e)), `failed API calls: ${apiFails.join(', ') || 'none'}`).toEqual([]);
  });

  test('the badge is read from GET /me/verification/identity and the seeded contact-gate flag does not grant it', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);
    await page.goto('/dashboard');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const status = await page.evaluate(async () => {
      const svc = await import('/src/services/verificationService.js');
      return svc.getAadhaarStatus();
    });

    expect(
      apiCalls.some((c) => /GET \/api\/me\/verification\/identity$/.test(c)),
      `saw: ${apiCalls.join(', ')}`,
    ).toBe(true);
    expect(status.verified).toBe(false);
    expect(status.status).toBe('none');
  });

  // Submitting queues a review; a client-side self-grant would be a security defect.
  test('submitting enters the review queue and grants no badge', async ({ page }) => {
    await signedInAsNew(page);
    await page.goto('/dashboard');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const { code, after } = await page.evaluate(async (b64) => {
      const tokens = JSON.parse(localStorage.getItem('draazyTokens') || sessionStorage.getItem('draazyTokens') || 'null');
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const png = new Blob([bytes], { type: 'image/png' });
      const challenge = await fetch('/api/me/verification/identity/challenge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      }).then((res) => (res.ok ? res.json() : null));
      const form = new FormData();
      form.set('docType', 'pan');
      form.set('consent', 'true');
      if (challenge?.token) form.set('challenge', challenge.token);
      form.set('front', png, 'front.png');
      form.set('selfie', png, 'selfie.png');
      const res = await fetch('/api/me/verification/identity', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        body: form,
      });
      const svc = await import('/src/services/verificationService.js');
      return { code: res.status, after: await svc.getAadhaarStatus() };
    }, PNG_1PX_BASE64);

    expect(code, 'acceptance into the queue is not a decision, so it is a 202').toBe(202);
    expect(after.status).toBe('pending');
    expect(after.verified).toBe(false);
  });

  test('the dev-only simulate endpoint finishes the badge where no reviewer sits (D122)', async ({ page }) => {
    await signedInAsNew(page);
    await page.goto('/dashboard');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const { simulate, after } = await page.evaluate(async (b64) => {
      const tokens = JSON.parse(localStorage.getItem('draazyTokens') || sessionStorage.getItem('draazyTokens') || 'null');
      const auth = { Authorization: `Bearer ${tokens.accessToken}` };
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const png = new Blob([bytes], { type: 'image/png' });
      const challenge = await fetch('/api/me/verification/identity/challenge', {
        method: 'POST',
        headers: auth,
      }).then((res) => (res.ok ? res.json() : null));
      const form = new FormData();
      form.set('docType', 'pan');
      form.set('consent', 'true');
      if (challenge?.token) form.set('challenge', challenge.token);
      form.set('front', png, 'front.png');
      form.set('selfie', png, 'selfie.png');
      await fetch('/api/me/verification/identity', { method: 'POST', headers: auth, body: form });
      const res = await fetch('/api/me/verification/identity/simulate', { method: 'POST', headers: auth });
      const body = await res.json();
      const svc = await import('/src/services/verificationService.js');
      const next = await svc.getAadhaarStatus();
      return { simulate: { code: res.status, body }, after: next };
    }, PNG_1PX_BASE64);

    expect(simulate.code).toBe(200);
    expect(simulate.body.status).toBe('verified');
    expect(after.verified).toBe(true);

    expect(
      apiCalls.some((c) => /POST \/api\/me\/verification\/identity\/simulate$/.test(c)),
      `saw: ${apiCalls.join(', ')}`,
    ).toBe(true);
  });
});
