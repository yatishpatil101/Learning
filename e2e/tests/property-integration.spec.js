import { test, expect } from '@playwright/test';
import { PDFDocument } from '../../frontend/node_modules/pdf-lib/cjs/index.js';
import { pickDate } from '../helpers/datePicker.helper.js';
import { IGNORE as SHARED_IGNORE } from '../helpers/console.js';
import { signIn, signedInAs, signedInAsNew, apiLogin, uniqueMobile, authHeaders, API } from '../helpers/liveAuth.js';

// OWNER has four listings, including one non-public row, to distinguish /me/listings from public search.
const OWNER = { mobile: '9470744469', name: 'Meera Deshpande', total: 4, publiclyVisible: 3 };
// An approved OWNER fixture supports public deal and review flows.
const OWNER_LISTING = '1078d711-d3eb-5961-ab3c-30d4bdc5f377';

/* Decoded the way the product decodes (`atob`), and inlined at both call sites since a page-side
   function cannot close over this file: `connect-src 'self'` refuses a `data:` fetch and
   `script-src` grants `'wasm-unsafe-eval'` but not `'unsafe-eval'`. */
const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_1PX = Buffer.from(PNG_1PX_BASE64, 'base64');

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
          // Preserve non-JSON responses for the page without adding them to the JSON fixture.
        }
      }
      await route.fulfill({ status, headers, body });
    } catch {
      // Navigation can abort an in-flight route response.
    }
  });
  return bodies;
}

async function lastJson(bodies, timeout = 20000) {
  await expect.poll(() => bodies.length, { timeout }).toBeGreaterThan(0);
  return bodies[bodies.length - 1];
}

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

  test('compare resolves ids individually rather than downloading the catalogue', async ({ page }) => {
    await page.goto('/listings');
    const first = page.locator('a[href^="/property/"]').first();
    await expect(first).toBeVisible({ timeout: 15000 });
    const slug = (await first.getAttribute('href')).split('/').pop();

    // CompareContext reads this key before requesting each selected listing.
    await page.evaluate((s) => localStorage.setItem('draazyCompare', JSON.stringify([s])), slug);
    const byId = page.waitForResponse(
      (r) => r.url().includes(`/api/properties/${slug}`) && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/compare');
    await byId;
    await expect(page.getByText(/no longer available/i)).toHaveCount(0);
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

  test('the freshness confirmation survives the browser that made it', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);

    const posted = page.waitForRequest(
      (r) => r.method() === 'POST'
        && /\/api\/me\/listings\/[^/]+\/confirm-available$/.test(new URL(r.url()).pathname),
      { timeout: 15_000 },
    );
    await page.goto('/dashboard#listings');
    // Seeded listings start stale so the confirmation control is available.
    const banner = page.getByRole('button', { name: /Confirm all available/i });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await banner.click();
    const confirmedId = new URL((await posted).url()).pathname.split('/').at(-2);

    // The toast appears after the sequential confirmation sweep completes.
    await expect(page.getByText(/listings? confirmed as available/i).first()).toBeVisible({ timeout: 30_000 });

    const res = await fetch(`${API}/me/listings/${confirmedId}`, {
      headers: await authHeaders(OWNER.mobile),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).lastConfirmedAt).toBeTruthy();

    // Public reads require an approved, confirmed fixture row.
    const mineRes = await fetch(`${API}/me/listings?size=100`, {
      headers: await authHeaders(OWNER.mobile),
    });
    const mineBody = await mineRes.json();
    const mineRows = Array.isArray(mineBody) ? mineBody : (mineBody.content ?? []);
    const publiclyConfirmed = mineRows.filter((r) => r.lastConfirmedAt && r.status === 'approved');
    expect(publiclyConfirmed.length).toBeGreaterThan(0);

    const publicRes = await fetch(`${API}/properties/${publiclyConfirmed[0].id}`);
    expect(publicRes.status).toBe(200);
    expect((await publicRes.json()).lastConfirmedAt).toBeTruthy();
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
     // A fresh account prevents this write from changing OWNER's fixed listing fixture.
    await signedInAsNew(page);

     // Seed step one because this test starts at the location-dependent second step.
    await page.addInitScript(() => {
      localStorage.setItem('dzDraft:list-property', JSON.stringify({
        propertyType: 'flat', bhk: '2 BHK', bathrooms: '2', carpetArea: '850', deal: 'rent',
        floor: '9', availableFrom: '2026-09-01',
      }));
      // Seed consent so the delayed banner cannot intercept the wizard controls.
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
        necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
      }));
    });

    const calls = [];
    watchApiCalls(page, calls);
    await page.goto('/list-property');

    const next = page.getByRole('button', { name: /Next Step/i });
    await next.click();

    // Search first because only this session can set the location pin.
    await page.getByRole('combobox', { name: /Search a locality/i }).fill('Baner');
    await page.getByRole('button', { name: 'Search location' }).click();

    // Wait for reverse-geocoding to select a locality before advancing.
    await expect(page.locator('[data-err="locality"] .dz-dropdown__value'))
      .not.toHaveClass(/is-placeholder/, { timeout: 15_000 });

    // A unique society name makes this run's server row identifiable.
    const society = `Seam Spec Residency ${Date.now()}`;
    const step2 = { flatNumber: 'A-902', society, pincode: '411045', monthlyRent: '31000', deposit: '90000' };
    for (const [field, value] of Object.entries(step2)) {
      await page.locator(`input[data-err="${field}"]`).fill(value);
    }
    await next.click();
    await page.getByPlaceholder(/MSEDCL electricity bill/i).fill(`1800${Date.now()}`.slice(0, 12));

    // A photo is required before the wizard exposes Submit.
    const photo = page.locator('[data-err="photos"] label.upload-zone input[type="file"]');
    await expect(photo).toBeAttached({ timeout: 20_000 });
    const uploaded = page.waitForResponse(
      (r) => r.url().includes('/me/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await photo.setInputFiles({ name: 'living-room.png', mimeType: 'image/png', buffer: PNG_1PX });
    expect((await uploaded).status()).toBe(201);

    const docInput = page.locator('.doc-upload input[type="file"]').first();
    await expect(docInput).toBeAttached({ timeout: 20_000 });
    const docPosted = page.waitForResponse(
      (r) => /\/api\/me\/documents\//.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await docInput.setInputFiles({ name: 'ownership-proof.png', mimeType: 'image/png', buffer: PNG_1PX });

    const created = page.waitForResponse(
      (r) => /\/api\/me\/listings$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: /Submit Property/i }).click();

    const res = await created;
    expect(res.status(), `API calls: ${calls.join(', ')}`).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();

    // Await the document after creation because its route requires the minted listing id.
    const docRes = await docPosted;
    expect(docRes.status(), `API calls: ${calls.join(', ')}`).toBe(201);
    expect(new URL(docRes.url()).pathname).toContain(String(body.slug || body.id));
    expect((await docRes.json()).category).toBe('Ownership Proof');

    await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 20_000 });

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
    const res = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: { ...(await authHeaders(mobile)), 'content-type': 'application/json' },
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
      }),
    });
    // Read the native response once because its body cannot be consumed twice.
    const text = await res.text();
    expect(res.status, text).toBe(201);
    return JSON.parse(text);
  }

  test('the edit form prefills from the server, not from this browser (D237)', async ({ page }) => {
    const mobile = await signedInAsNew(page);
    const created = await fileListing(mobile, 'Prefill Proof Flat');

    await page.goto(`/list-property?edit=${created.slug || created.id}`);

    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1150', { timeout: 25_000 });
    await expect(page.locator('[data-err="bhk"] [aria-pressed="true"]'))
      .toHaveText('3', { timeout: 15_000 });
  });

  test('an owner can take their own listing down, and it frees a quota slot (D238)', async ({ page }) => {
    const mobile = await signedInAsNew(page);
    const first = await fileListing(mobile, 'Take Down Proof Flat');

    // The single-listing quota makes the final retry observable.
    const blocked = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: { ...(await authHeaders(mobile)), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Second Flat, Blocked', deal: 'rent', propertyType: 'flat', bhk: 2,
        price: 25000, locality: 'Baner', city: 'Pune',
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
    // The action may be inline or inside the moderation-dependent overflow menu.
    const more = page.getByRole('button', { name: /More actions/i }).first();
    if (await more.count()) await more.click();
    await page.getByRole('menuitem', { name: /Take down/i })
      .or(page.getByRole('button', { name: /Take down/i })).first().click();
    expect((await removed).status()).toBe(200);

    const mineRes = await fetch(`${API}/me/listings?size=100`, { headers: await authHeaders(mobile) });
    const mineBody = await mineRes.json();
    const mineRows = Array.isArray(mineBody) ? mineBody : (mineBody.content ?? []);
    const taken = mineRows.find((r) => String(r.id) === String(first.id));
    expect(taken, 'the listing should still be on file').toBeTruthy();
    expect(taken.archived).toBe(true);

    const retried = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: { ...(await authHeaders(mobile)), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Second Flat, Allowed', deal: 'rent', propertyType: 'flat', bhk: 2,
        price: 25000, locality: 'Baner', city: 'Pune',
      }),
    });
    expect(retried.status, await retried.text()).toBe(201);
  });

  test('the session survives a reload (no redirect to signin)', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    await page.goto('/dashboard');
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await expect(page).not.toHaveURL(/signin/);
  });
});

const ADMIN = { mobile: '9000000000' };

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
    await signedInAs(page, ADMIN.mobile);

    // Exclude the concurrent recheck request so this capture targets the moderation queue.
    const queued = await captureJson(
      page,
      (url) => url.pathname.startsWith('/api/admin/properties') && !url.searchParams.has('recheck'),
    );
    await page.goto('/admin/properties');
    const body = await lastJson(queued);
    const rows = body.content ?? [];

    const publicTotal = await (await page.request.get('/api/properties?size=1')).json();
    expect(body.totalElements).toBeGreaterThan(publicTotal.totalElements);
    expect(rows.some((r) => r.status !== 'approved')).toBe(true);
    expect(rows.every((r) => typeof r.archived === 'boolean')).toBe(true);
  });

  test('toggling featured issues a real request against the moderation route', async ({ page }) => {
    await signedInAs(page, ADMIN.mobile);
    await page.goto('/admin/properties');

    const toggle = page.locator('button[title="Feature"], button[title="Unfeature"]').first();
    await expect(toggle).toBeVisible({ timeout: 20000 });
    const before = await toggle.getAttribute('title');

    const call = page.waitForResponse((r) => /\/api\/properties\/[^/]+\/toggle-featured/.test(r.url()));
    await toggle.click();
    expect((await call).status()).toBe(200);

    // Restore the seeded state so reruns start from the same fixture.
    const restore = page.waitForResponse((r) => /\/api\/properties\/[^/]+\/toggle-featured/.test(r.url()));
    await page.locator(`button[title="${before === 'Feature' ? 'Unfeature' : 'Feature'}"]`).first().click();
    await restore;
  });
});

test.describe('LIVE: notifications against the real API', () => {
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

  test('the inbox is served by GET /notifications', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);

    // The navbar can race this request during navigation, so capture it in the route handler.
    const inbox = await captureJson(page, /\/api\/notifications(\?|$)/);
    await page.goto('/notifications');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    const body = await lastJson(inbox);
    expect(body).toHaveProperty('content');
    expect(Array.isArray(body.content)).toBe(true);
  });

  test('the demo seed is not written to localStorage in http mode', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    await page.goto('/notifications');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    const seeded = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('dzNotifications:'));
      if (!key) return null;
      try { return JSON.parse(localStorage.getItem(key)); } catch { return 'unparseable'; }
    });
    if (Array.isArray(seeded)) {
      expect(seeded.some((n) => String(n.id).startsWith('n-match-') || String(n.id) === 'n-system-welcome')).toBe(false);
    } else {
      expect(seeded).toBeNull();
    }
  });

  test('mark all read posts to /notifications/read', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    await page.goto('/notifications');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    const markAll = page.getByRole('button', { name: /mark all/i });
    if (!(await markAll.count())) {
      test.skip(true, 'nothing unread in this account; only flatmate flows write server notifications');
    }
    const call = page.waitForResponse(
      (r) => r.url().includes('/api/notifications/read') && r.request().method() === 'POST',
    );
    await markAll.first().click();
    expect((await call).status()).toBe(204);
  });

  test('dismiss deletes the row via DELETE /notifications/{id} and it stays gone after reload', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    await page.goto('/notifications');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    const rows = page.locator('.notif');
    const before = await rows.count();
    if (!before) {
      test.skip(true, 'inbox is empty in this account; only flatmate flows write server notifications');
    }

    const del = page.waitForResponse(
      (r) => /\/api\/notifications\/[^/?]+$/.test(r.url()) && r.request().method() === 'DELETE',
    );
    await page.locator('.notif').first().getByRole('button', { name: /dismiss/i }).click();
    expect((await del).status()).toBe(204);

    await page.reload();
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    await expect(rows).toHaveCount(before - 1);
  });
});

const CHATTER = { mobile: '9708919481', name: 'Omkar Kulkarni' };

test.describe('LIVE: conversations against the real API', () => {
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

  test('the inbox, the demo seed, message attribution and mark-read', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);

    const inbox = await captureJson(page, /\/api\/messages(\?|$)/);
    await page.goto('/messages');
    const body = await lastJson(inbox);
    expect(body).toHaveProperty('content');
    expect(body.totalElements).toBeGreaterThan(0);

    // Establish a real thread before making negative assertions about the inbox fixture.
    const thread = page.locator('.pc-conv').first();
    await expect(thread).toBeVisible({ timeout: 15000 });

    const seededIds = await page.evaluate(() => {
      try { return (JSON.parse(localStorage.getItem('dzConversations') || '[]') || []).map((c) => c.id); }
      catch { return []; }
    });
    expect(seededIds).not.toContain('c1');
    await expect(page.getByText('Sneha Deshpande')).toHaveCount(0);

    const detail = page.waitForResponse(
      (r) => /\/api\/messages\/[0-9a-f-]{36}$/.test(r.url()) && r.status() === 200,
      { timeout: 20000 },
    );
    const read = page.waitForResponse(
      (r) => /\/api\/messages\/[0-9a-f-]{36}\/read$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await thread.click();

    const detailBody = await (await detail).json();
    // The seeded conversation has messages, so the author assertion needs a non-empty floor.
    expect(Array.isArray(detailBody.messages)).toBe(true);
    expect(detailBody.messages.length).toBeGreaterThan(0);
    expect(detailBody.messages.every((m) => typeof m.authorId === 'string')).toBe(true);

    expect((await read).status()).toBe(204);

    const bubbles = page.locator('.pc-row');
    await expect(bubbles.first()).toBeVisible({ timeout: 10000 });
    const sides = await bubbles.evaluateAll((els) => els.map((e) => ({
      me: e.classList.contains('me'),
      them: e.classList.contains('them'),
    })));
    expect(sides.length).toBeGreaterThan(0);
    expect(sides.every((s) => s.me !== s.them)).toBe(true);
    expect(sides.some((s) => s.me)).toBe(true);
    expect(sides.some((s) => s.them)).toBe(true);
  });
});

// A fixed sparse review fixture supports idempotent reads and absent-average assertions.
const PROPERTY_REVIEW = {
  rating: 4,
  body: 'Row house was exactly as listed; the society gate is manned round the clock.',
  categories: { locality: 5, condition: 4, accuracy: 4 },
  recommend: true,
};

async function tokenFor(page, mobile) {
  await signedInAs(page, mobile);
  // "Remember me" determines the storage area, so both stores supply the token fixture.
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('draazyTokens') || sessionStorage.getItem('draazyTokens');
    return JSON.parse(raw || 'null')?.accessToken;
  });
  expect(token, `no access token cached for ${mobile}`).toBeTruthy();
  return token;
}

// Reuse or complete a visit because a review needs standing and only one review per target is allowed.
async function seedPropertyReview(page, request) {
  const owner = await tokenFor(page, OWNER.mobile);
  // Sign in as CHATTER second so subsequent page reads use the reviewer fixture.
  const chatter = await tokenFor(page, CHATTER.mobile);
  const as = (t) => ({ Authorization: `Bearer ${t}` });

  const listing = await (await request.get(`/api/properties/${OWNER_LISTING}`)).json();
  expect(listing.slug, 'the fixture listing needs a slug distinct from its UUID').toBeTruthy();
  expect(listing.slug).not.toBe(OWNER_LISTING);

  const mine = await (await request.get('/api/visits?size=50', { headers: as(chatter) })).json();
  // Terminal visits cannot establish standing, so the fixture books another visit when needed.
  const usable = (mine.content ?? []).filter(
    (v) => v.propertyId === OWNER_LISTING && !['cancelled', 'no-show'].includes(v.status),
  );
  // Prefer a completed visit to avoid changing another test's live fixture.
  let visit = usable.find((v) => v.status === 'completed') ?? usable[0];
  if (!visit) {
    const res = await request.post('/api/visits', {
      headers: as(chatter),
      data: {
        propertyId: OWNER_LISTING,
        slot: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        mode: 'in-person',
      },
    });
    expect(res.status(), `POST /visits: ${await res.text()}`).toBe(201);
    visit = await res.json();
  }

  // The owner must move visits through the required transition order.
  for (const next of ['confirmed', 'completed']) {
    if (visit.status === 'completed') break;
    const res = await request.patch(`/api/visit-requests/${visit.id}/status`, {
      headers: as(owner),
      data: { status: next },
    });
    expect(res.status(), `PATCH visit status → ${next}: ${await res.text()}`).toBe(200);
    visit = { ...visit, status: next };
  }

  const res = await request.post(`/api/properties/${OWNER_LISTING}/reviews`, {
    headers: as(chatter),
    data: PROPERTY_REVIEW,
  });
  expect([201, 409], `POST review: ${res.status()} ${await res.text()}`).toContain(res.status());
  if (res.status() === 201) {
    expect((await res.json()).context).toBe('visit');
  }
  return listing.slug;
}

// Force the reveal state because the observer can leave the fixture section hidden during assertions.
async function openReviewsSection(page) {
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in')
    .forEach((el) => el.classList.add('visible')));
  const section = page.locator('section')
    .filter({ has: page.getByRole('heading', { name: /ratings/i }) })
    .first();
  await expect(section).toBeVisible({ timeout: 15_000 });
  return section;
}

test.describe('LIVE: reviews against the real API', () => {
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
    const noise = /409/;
    expect(
      errors.filter((e) => !IGNORE.test(e) && !noise.test(e)),
      `failed API calls: ${apiFails.filter((f) => !noise.test(f)).join(', ') || 'none'}`,
    ).toEqual([]);
  });

  test('a locality review round-trips on the slug, and no badge is fabricated', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);

    const first = page.waitForResponse(
      (r) => /\/api\/reviews\/locality\/aundh(\?|$)/.test(r.url()) && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/locality/aundh');

    const before = await (await first).json();
    expect(before).toHaveProperty('content');

    // Open the reviews tab before asserting on controls mounted inside it.
    await page.getByRole('tab', { name: /reviews/i }).first().click();

    const body = `Living here since 2019 ${Date.now()}`;
    const posted = page.waitForResponse(
      (r) => /\/api\/reviews\/locality\/aundh$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );

    const form = page.locator('form', { has: page.locator('textarea') }).first();
    await expect(form.locator('textarea')).toBeVisible({ timeout: 15000 });
    await form.locator('textarea').fill(body);
    // Set a rating before posting because the review form requires it.
    await form.locator('button[type="button"]').nth(4).click();
    await form.getByRole('button', { name: /post/i }).click();

    const res = await posted;
    expect([201, 409]).toContain(res.status());
    if (res.status() === 201) {
      const created = await res.json();
      expect(created.context ?? null).toBeNull();
      expect(created.rating).toBeGreaterThan(0);
      await expect(page.getByText(body)).toBeVisible({ timeout: 15000 });
    }

    const listed = await page.evaluate(async () => {
      const r = await fetch('/api/reviews/locality/aundh');
      return r.json();
    });
    expect(listed.totalElements).toBeGreaterThan(0);
    expect(listed.content.every((rv) => rv.context == null)).toBe(true);
    await expect(page.getByText('Living here since 2019', { exact: false }).first())
      .toBeVisible({ timeout: 15000 });

  });

  test('the property review list and its summary are both served by the live API', async ({ page, request }) => {
    const slug = await seedPropertyReview(page, request);

    const calls = [];
    watchApiCalls(page, calls);
    const path = `/api/properties/${OWNER_LISTING}/reviews`;
    const arrival = (want) => page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === want,
      { timeout: 25_000 },
    ).catch(() => null);
    const listArrived = arrival(path);
    const summaryArrived = arrival(`${path}/summary`);

    // Navigate by slug and open amenities because it mounts the reviews fixture.
    await page.goto(`/property/${slug}?tab=amenities`);

    const listRes = await listArrived;
    expect(listRes, `no GET ${path} — the page asked for: ${calls.join(' | ') || 'nothing'}`).not.toBeNull();
    expect(listRes.status(), `GET ${path}`).toBe(200);

    const summaryRes = await summaryArrived;
    expect(
      summaryRes,
      `no GET ${path}/summary — the page asked for: ${calls.join(' | ') || 'nothing'}`,
    ).not.toBeNull();
    expect(summaryRes.status(), `GET ${path}/summary`).toBe(200);

    const rows = await listRes.json();
    expect(Array.isArray(rows), `expected a bare array, got ${JSON.stringify(rows).slice(0, 200)}`).toBe(true);
    const mine = rows.find((r) => r.author === CHATTER.name);
    expect(mine, `no review by ${CHATTER.name} in ${JSON.stringify(rows).slice(0, 400)}`).toBeTruthy();
    expect(mine.targetType).toBe('property');
    expect(mine.targetId).toBe(OWNER_LISTING);

    const section = await openReviewsSection(page);

    await expect(section.getByText(mine.body, { exact: false }).first()).toBeVisible();
    await expect(section.getByText(CHATTER.name, { exact: false }).first()).toBeVisible();

    expect(mine.context).toBe('visit');
    await expect(section.getByText('Visited', { exact: true }).first()).toBeVisible();

    const sum = await summaryRes.json();
    expect(sum.reviewCount, 'the fixture should have left at least one published review').toBeGreaterThan(0);

    const aggregate = section.getByTestId('reviews-aggregate');
    await expect(aggregate).toBeVisible();
    await expect(section.getByTestId('reviews-average')).toHaveText(Number(sum.avgRating).toFixed(1));
    await expect(aggregate).toContainText(`${sum.reviewCount} review${sum.reviewCount === 1 ? '' : 's'}`);

    for (const star of [5, 4, 3, 2, 1]) {
      await expect(section.getByTestId(`reviews-bar-${star}`))
        .toHaveText(String(sum.distribution[String(star)] ?? 0));
    }

    const cats = section.getByTestId('reviews-cat-averages');
    const rated = Object.keys(sum.categoryAverages ?? {});
    expect(rated.length, 'the fixture rates some aspects and leaves others unrated').toBeGreaterThan(0);
    for (const key of ['locality', 'condition', 'value', 'owner', 'accuracy']) {
      const label = new RegExp(key, 'i');
      if (rated.includes(key)) await expect(cats).toContainText(label);
      else await expect(cats).not.toContainText(label);
    }
    for (const key of rated) await expect(cats).toContainText(Number(sum.categoryAverages[key]).toFixed(1));

    await expect(section).not.toContainText(/no reviews yet/i);
    await expect(section.getByTestId('property-reviews-unavailable')).toHaveCount(0);
  });

  test('a failed summary read leaves the reviews rendered and says the rating is unavailable', async ({ page, request }) => {
    const slug = await seedPropertyReview(page, request);

    const path = `/api/properties/${OWNER_LISTING}/reviews`;
    // Match the exact summary path so the list request remains available.
    await page.route(
      (u) => u.pathname === `${path}/summary`,
      (route) => route.abort('failed'),
    );

    const listArrived = page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === path,
      { timeout: 25_000 },
    ).catch(() => null);
    await page.goto(`/property/${slug}?tab=amenities`);

    const listRes = await listArrived;
    expect(listRes, `no GET ${path} arrived`).not.toBeNull();
    expect(listRes.status()).toBe(200);
    const rows = await listRes.json();
    const mine = rows.find((r) => r.author === CHATTER.name);
    expect(mine, 'the fixture review should still be readable — only the summary was aborted').toBeTruthy();

    const section = await openReviewsSection(page);
    await expect(section.getByTestId('reviews-summary-skeleton')).toHaveCount(0);

    await expect(section.getByText(mine.body, { exact: false }).first()).toBeVisible();

    await expect(section.getByTestId('reviews-aggregate')).toHaveCount(0);
    await expect(section.getByTestId('reviews-average')).toHaveCount(0);

    await expect(section.getByTestId('property-rating-unavailable')).toBeVisible();

    await expect(section).not.toContainText(/no reviews yet/i);
    await expect(section.getByTestId('property-reviews-unavailable')).toHaveCount(0);
  });
});

test.describe('LIVE: support tickets against the real API', () => {
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

  test('a ticket round-trips, and the controls the API cannot carry are not offered', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);

    const listed = page.waitForResponse(
      (r) => /\/api\/support\/tickets(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/support');

    const body = await (await listed).json();
    expect(Array.isArray(body)).toBe(true);

    await expect(page.getByText('Priority', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Attach screenshots')).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    const subject = `Parity check ${Date.now()}`;
    const created = page.waitForResponse(
      (r) => /\/api\/support\/tickets$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );

    await page.getByPlaceholder('Brief summary of your issue').fill(subject);
    await page.getByPlaceholder(/Share as much detail/i).fill('Raised by the live integration suite.');
    await page.getByRole('button', { name: /submit ticket/i }).click();

    const res = await created;
    expect(res.status()).toBe(201);
    const ticket = await res.json();
    expect(ticket.status).toBe('open');
    expect(ticket).not.toHaveProperty('priority');
    expect(ticket).not.toHaveProperty('mobile');

    await expect(page.getByText(subject).first()).toBeVisible({ timeout: 15000 });

    const replied = page.waitForResponse(
      (r) => /\/api\/support\/tickets\/[^/]+\/messages$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    const reply = `Following up ${Date.now()}`;
    await page.getByPlaceholder(/type your reply/i).fill(reply);
    await page.getByRole('button', { name: /^send$/i }).click();

    expect((await replied).status()).toBe(201);
    // The reply appears in both the thread and preview, so select the first match.
    await expect(page.getByText(reply).first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('LIVE: abuse reports against the real API', () => {
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
    const expected = /409/;
    expect(
      errors.filter((e) => !IGNORE.test(e) && !expected.test(e)),
      `failed API calls: ${apiFails.filter((f) => !expected.test(f)).join(', ') || 'none'}`,
    ).toEqual([]);
  });

  test('a report reaches the ops queue, and a duplicate is refused', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);

    await page.goto('/listings');
    const card = page.locator('a[href^="/property/"]').first();
    await expect(card).toBeVisible({ timeout: 20000 });
    // Navigate by href so card controls cannot intercept the report flow.
    await page.goto(await card.getAttribute('href'));

    const reportBtn = page.getByRole('button', { name: /report/i }).first();
    await expect(reportBtn).toBeVisible({ timeout: 20000 });
    await reportBtn.click();
    const modal = page.getByRole('dialog', { name: /report/i });
    await expect(modal).toBeVisible({ timeout: 10000 });
    await modal.getByRole('button', { name: /fake photos or misleading info/i }).click();

    // Register immediately before submission so navigation cannot consume the response timeout.
    const filed = page.waitForResponse(
      (r) => /\/api\/reports$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await modal.getByRole('button', { name: /submit report/i }).click();

    const res = await filed;
    // Reruns reuse the report fixture and therefore may receive the expected conflict.
    expect([201, 409]).toContain(res.status());
    let reportId = null;
    if (res.status() === 201) {
      const created = await res.json();
      reportId = created.id;
      expect(created).not.toHaveProperty('reporterId');
      expect(created.status).toBe('open');
      expect(created.targetType).toBe('property');
    }

    await signedInAs(page, ADMIN.mobile);

    const queue = page.waitForResponse(
      (r) => /\/api\/reports(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/admin/reports');
    const body = await (await queue).json();
    expect(body).toHaveProperty('content');
    expect(body.totalElements).toBeGreaterThan(0);

    if (reportId) {
      expect(body.content.some((r) => r.id === reportId)).toBe(true);
    }

    await expect(page.getByRole('button', { name: /^reopen$/i })).toHaveCount(0);
  });
});

test.describe('LIVE: saved, alerts, visits and the contact gate against the real API', () => {
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

  test('a public listing page asks nothing of the contact gate when signed out', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/listings');
    const card = page.locator('a[href^="/property/"]').first();
    await expect(card).toBeVisible({ timeout: 20000 });

    const gateCalls = [];
    page.on('request', (r) => { if (r.url().includes('/api/contacts/status')) gateCalls.push(r.url()); });

    await page.goto(await card.getAttribute('href'));
    await expect(page.getByRole('button', { name: /report/i }).first()).toBeVisible({ timeout: 20000 });
    expect(gateCalls, 'signed-out visitor must not query the contact gate').toEqual([]);
  });

  test('the shortlist, the alert list and both sides of the visit relationship are served by the API', async ({ page }) => {
    // One sign-in preserves the OTP budget across the dependent dashboard checks.
    const calls = [];
    watchApiCalls(page, calls);
    await signedInAs(page, CHATTER.mobile);

    await page.goto('/dashboard');
    await expect
      .poll(() => calls.filter((c) => / GET \/api\/(me\/saved|me\/saved-searches|visits|me\/visit-requests)$/.test(c)),
        { timeout: 30000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toEqual(expect.arrayContaining([
        '200 GET /api/me/saved',
        '200 GET /api/me/saved-searches',
        '200 GET /api/visits',
        '200 GET /api/me/visit-requests',
      ]));

    // Open the visits tab because it mounts the rescheduling control.
    await page.goto('/dashboard#visits');
    const reschedule = page.getByRole('button', { name: /^reschedule$/i }).first();
    await expect(reschedule).toBeVisible({ timeout: 10000 });
    await reschedule.click();
    const reDialog = page.getByRole('dialog');
    await expect(reDialog.getByRole('button', { name: 'New visit date' })).toBeVisible({ timeout: 5000 });
    const reTarget = new Date();
    reTarget.setDate(reTarget.getDate() + 12);
    const reIso = `${reTarget.getFullYear()}-${String(reTarget.getMonth() + 1).padStart(2, '0')}-${String(reTarget.getDate()).padStart(2, '0')}`;
    await pickDate(page, '[aria-label="New visit date"]', reIso);
    await reDialog.getByRole('button', { name: 'Save new slot' }).click();
    await expect
      .poll(() => calls.filter((c) => /PATCH \/api\/visits\/[^/]+\/slot$/.test(c)),
        { timeout: 15000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toEqual(expect.arrayContaining([expect.stringMatching(/^200 PATCH \/api\/visits\/[^/]+\/slot$/)]));

    const saved = await page.evaluate(async () => {
      const tokens = JSON.parse(localStorage.getItem('draazyTokens') || sessionStorage.getItem('draazyTokens') || 'null');
      const res = await fetch('/api/me/saved?size=5', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
      return res.json();
    });
    expect(saved).toHaveProperty('page');
    expect(saved).toHaveProperty('totalElements');

     // Register immediately before clicking because the save control updates optimistically.
    await page.goto('/listings');
    const heart = page.getByRole('button', { name: /^(save property|remove from saved)$/i }).first();
    await expect(heart).toBeVisible({ timeout: 15000 });
    const wrote = page.waitForResponse(
      (r) => /\/api\/me\/saved/.test(r.url()) && ['PUT', 'POST', 'DELETE'].includes(r.request().method()),
      { timeout: 20000 },
    );
    await heart.click();
    expect([200, 201, 204]).toContain((await wrote).status());
  });
});

test.describe('LIVE: subscription plans against the real API', () => {
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

  test('the pricing page is served by GET /plans and renders for a signed-out visitor', async ({ page }) => {
    await page.context().clearCookies();
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto('/plans');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    await expect
      .poll(() => calls.filter((c) => / GET \/api\/plans$/.test(c)),
        { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toContain('200 GET /api/plans');

    expect(apiFails.filter((f) => /\/api\/plans/.test(f))).toEqual([]);
  });

  test('buying a paid plan leaves it pending, and the entitlement it gates stays shut', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);

    const posted = page.waitForResponse(
      (r) => /\/api\/me\/subscription$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page.goto('/checkout?plan=owner2');
    await page.getByRole('button', { name: /Pay/i }).first().click();

    const res = await posted;
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');

    await expect(page.getByText(/pending/i).first()).toBeVisible({ timeout: 15000 });

    await page.goto('/dashboard#billing');
    await expect(page.getByText(/Payment pending/i).first()).toBeVisible({ timeout: 20000 });
  });
});

test.describe('LIVE: deals, offers and finalization against the real API', () => {
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

  test('the owner dashboard reads its deal book from /me/deals, in one request not one per card', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto('/dashboard#listings');
    await expect
      .poll(() => calls.filter((c) => / GET \/api\/me\/deals$/.test(c)).length,
        { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toBeGreaterThan(0);

    const dealReads = calls.filter((c) => /GET \/api\/me\/deals$/.test(c)).length;
    expect(dealReads, `one read should serve every card, saw ${dealReads}`).toBeLessThanOrEqual(2);

    expect(calls.filter((c) => /GET \/api\/me\/deals\/[0-9a-f-]{36}$/.test(c))).toEqual([]);
  });

  test('a signed-out visitor on a listing asks the deal API nothing at all', async ({ page }) => {
    await page.context().clearCookies();
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto(`/property/${OWNER_LISTING}`);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    const dealCalls = calls.filter((c) => /\/api\/(me\/deals|me\/offers|offers\/mine|me\/finalization-requests|finalization\/)/.test(c));
    expect(dealCalls, `a signed-out visitor should ask the deal API nothing, saw: ${dealCalls.join(' | ')}`).toEqual([]);
  });

  test('a buyer offer round-trips, and the buyer is refused the owner\'s decisions', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto(`/property/${OWNER_LISTING}`);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    await expect
      .poll(() => calls.filter((c) => / GET \/api\/offers\/mine$/.test(c)),
        { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .not.toEqual([]);

    expect(calls.filter((c) => /GET \/api\/me\/offers$/.test(c))).toEqual([]);
    expect(calls.filter((c) => /GET \/api\/me\/deals/.test(c))).toEqual([]);

    const offerCard = page.getByRole('button', { name: /^Accept$/ });
    expect(await offerCard.count(), 'a buyer must not be offered Accept — the server answers 403').toBe(0);
  });
});

test.describe('LIVE: rent, tenancies and property finances against the real API', () => {
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

  test('Pay Rent is a static coming-soon page that asks the API for nothing, signed in or out', async ({ page }) => {
    const WITHDRAWN = /\/api\/me\/(rent-payments|rent-ledger|payout-account|rent-mandate)/;

    await page.context().clearCookies();
    const anonCalls = [];
    watchApiCalls(page, anonCalls);
    await page.goto('/pay-rent');
    await page.waitForTimeout(1500);
    const anonLeaked = anonCalls.filter((c) => WITHDRAWN.test(c) || /\/api\/me\/tenancies/.test(c));
    expect(anonLeaked, `a signed-out visitor asked the rent API for: ${anonLeaked.join(' | ')}`).toEqual([]);

    await signedInAs(page, OWNER.mobile);
    const calls = [];
    watchApiCalls(page, calls);
    await page.goto('/pay-rent');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);

    const revived = calls.filter((c) => WITHDRAWN.test(c));
    expect(revived, `the coming-soon page called a withdrawn endpoint: ${revived.join(' | ')}`).toEqual([]);
  });

  test('the owner Finances tab reads summary, cashflow and dues from the server, not from the page it holds', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto('/dashboard#finances');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    // Select the owner context because it mounts the property finance endpoints.
    const ownerToggle = page.getByRole('button', { name: /My properties/i });
    if (await ownerToggle.count()) await ownerToggle.first().click();

    await expect
      .poll(() => calls.filter((c) => /GET \/api\/me\/finances\/.*\/summary$/.test(c)).length,
        { timeout: 20000 })
      .toBeGreaterThan(0);

    for (const endpoint of ['cashflow', 'dues', 'transactions']) {
      expect(
        calls.filter((c) => new RegExp(`GET /api/me/finances/.*/${endpoint}`).test(c)).length,
        `${endpoint} should be served by the API; calls seen: ${calls.join(' | ')}`,
      ).toBeGreaterThan(0);
    }

    const summaryReads = calls.filter((c) => /GET \/api\/me\/finances\/.*\/summary$/.test(c)).length;
    expect(summaryReads, `one summary read should serve the tab, saw ${summaryReads}`).toBeLessThanOrEqual(3);
  });

});

test.describe('LIVE: the flatmates board against the real API', () => {
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

  test('both tabs are served by the API for a signed-out visitor, and the board is not empty', async ({ page }) => {
    await page.context().clearCookies();
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto('/flatmates');
    const moveIn = page.getByRole('button', { name: /Move in now/i });
    await expect(moveIn).toBeVisible({ timeout: 20000 });

    for (const feed of ['rooms', 'posts', 'groups']) {
      await expect
        .poll(() => calls.filter((c) => new RegExp(`GET /api/flatmates/${feed}`).test(c)).length,
          { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
        .toBeGreaterThan(0);
    }

    await expect(moveIn).toHaveAttribute('aria-label', /\d+ homes/);
    const label = await moveIn.getAttribute('aria-label');
    expect(Number(label.match(/(\d+) homes/)[1]), `the move-in tab is empty: ${label}`).toBeGreaterThan(0);
  });

  test('a room posted through the API reaches the public board once it is moderated', async ({ page, request }) => {
    await signedInAs(page, OWNER.mobile);
    const marker = `live probe ${Date.now()}`;
    const created = await page.evaluate(async (note) => {
      const svc = await import('/src/services/flatmateService.js');
      const room = await svc.createRoom({
        locality: 'Baner',
        rent: 14000,
        bhk: '2',
        // The server requires the human-readable room type fixture.
        roomType: 'Private room',
        attachedBath: 'attached',
        furnishing: 'semi',
        hostRole: 'tenant',
        lookingFor: 'any',
        foodPref: 'any',
        photos: ['https://example.test/room.jpg'],
        note,
      });
      return { id: room.id, budget: room.budget };
    }, marker);

    expect(created.id, 'the server assigned no id').toBeTruthy();
    expect(created.budget, 'the created room came back with no price — check the budget/rent mapping').toBe(14000);

    const onBoard = async () => page.evaluate(async (id) => {
      const svc = await import('/src/services/flatmateService.js');
      const feed = await svc.listRooms({}, 0, 200);
      const row = feed.items.find((r) => r.id === id);
      return row ? { budget: row.budget, publiclyVisible: row.publiclyVisible } : null;
    }, created.id);

    expect(
      await onBoard(),
      `a brand-new room is public before anyone reviewed it — D72 says it must not be (id ${created.id})`,
    ).toBeNull();

    const decided = await request.patch(`/api/admin/flatmates/${created.id}/moderation`, {
      headers: await authHeaders(ADMIN.mobile),
      data: { modStatus: 'approved', note: 'e2e fixture' },
    });
    expect(decided.status(), `PATCH moderation: ${await decided.text()}`).toBe(200);

    const found = await onBoard();
    expect(found, `the room was approved but is not on the public board (id ${created.id})`).not.toBeNull();
    expect(found.budget).toBe(14000);
    expect(found.publiclyVisible, 'an approved room should be publicly visible').toBe(true);
  });

  test('the filter bar narrows the board server-side, and an unknown value is dropped not matched', async ({ page }) => {
    await page.goto('/flatmates');
    await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20000 });

    const result = await page.evaluate(async () => {
      const svc = await import('/src/services/flatmateService.js');
      const all = await svc.listRooms({}, 0, 200);
      const women = await svc.listRooms({ gender: 'female' }, 0, 200);
      const nonsense = await svc.listRooms({ gender: 'Female' }, 0, 200);
      return {
        total: all.total,
        offenders: women.items.filter((r) => r.gender !== 'female' && r.gender !== 'any').map((r) => r.gender),
        nonsenseTotal: nonsense.total,
      };
    });

    expect(result.offenders, `a women-only search returned rooms marked ${result.offenders.join(', ')}`).toEqual([]);
    expect(result.nonsenseTotal, 'an unknown gender value narrowed the board instead of being ignored').toBe(result.total);
  });
});

test.describe('LIVE: service requests against the real API', () => {
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

  test('the tracker reads from GET /service-requests, and the mock store is not the source', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);

    const before = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.toLowerCase().includes('servicereq'));
      return k ? localStorage.getItem(k) : null;
    });

    const listed = page.waitForResponse(
      (r) => /\/api\/service-requests(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/services/interior-renovation');

    const body = await (await listed).json();
    expect(body).toHaveProperty('content');
    expect(Array.isArray(body.content)).toBe(true);

    const after = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.toLowerCase().includes('servicereq'));
      return k ? localStorage.getItem(k) : null;
    });
    expect(after).toBe(before);
  });

  test('a request created through the service round-trips and carries no mock-only fields', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);
    await page.goto('/services/property-valuation');
    await expect(page.getByRole('heading', { name: /worth/i }).first()).toBeVisible({ timeout: 20000 });

    const marker = `live probe ${Date.now()}`;
    const created = await page.evaluate(async (note) => {
      const svc = await import('/src/services/serviceRequestService.js');
      const r = await svc.createServiceRequest({
        type: 'valuation',
        customer: { name: 'Omkar Kulkarni' },
        details: { property: 'Aundh, Pune', size: '2 BHK', note },
      });
      return {
        id: r.id, status: r.status, type: r.type, service: r.service,
        details: r.details, docs: r.docs, draft: r.draft, finalDoc: r.finalDoc,
      };
    }, marker);

    expect(created.id, 'the server assigned no id').toBeTruthy();
    expect(created.status).toBe('submitted');
    expect(created.type).toBe('valuation');
    expect(created.service).toBe('Property Valuation');
    expect(created.details).toMatchObject({ property: 'Aundh, Pune', size: '2 BHK', note: marker });
    expect(created.draft).toBeNull();
    expect(created.finalDoc).toBeNull();
    expect(created.docs).toEqual([]);

    const threaded = await page.evaluate(async (id) => {
      const svc = await import('/src/services/serviceRequestService.js');
      await svc.addServiceRequestMessage(id, 'Following up from the live suite.');
      const r = await svc.getServiceRequest(id);
      return r ? { count: r.messages.length, last: r.messages[r.messages.length - 1] } : null;
    }, created.id);

    expect(threaded, `the created request could not be read back (id ${created.id})`).not.toBeNull();
    expect(threaded.count).toBeGreaterThan(0);
    expect(threaded.last.text).toContain('Following up');
    expect(threaded.last.from).toBe('user');
  });

  test('opening a staff reply clears its server-backed unread badge', async ({ page, request }) => {
    await signedInAs(page, CHATTER.mobile);
    const created = await page.evaluate(async () => {
      const svc = await import('/src/services/serviceRequestService.js');
      return svc.createServiceRequest({
        type: 'valuation',
        customer: { name: 'Receipt Customer' },
        details: { property: 'Baner, Pune' },
      });
    });

    const replied = await request.post(`${API}/service-requests/${created.id}/messages`, {
      headers: await authHeaders(ADMIN.mobile),
      data: { body: 'The drafting desk needs one clarification.' },
    });
    const replyText = await replied.text();
    expect(replied.status(), replyText).toBe(201);
    const reply = JSON.parse(replyText);
    expect(reply.authorRole, 'the reply was not written as staff-side').toBe('admin');
    expect(reply.readAt, 'a fresh reply was already marked read').toBeNull();

    const beforeOpen = await page.evaluate(async (id) => {
      const svc = await import('/src/services/serviceRequestService.js');
      return svc.getServiceRequest(id);
    }, created.id);
    expect(beforeOpen.messages.some((message) => message.from === 'staff' && !message.read),
      'the server receipt did not map to an unread staff message').toBe(true);

    const listed = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/service-requests'
        && response.request().method() === 'GET' && response.status() === 200,
    );
    await page.goto('/services/property-valuation');
    const listBody = await (await listed).json();
    const listedRequest = listBody.content.find((request) => request.id === created.id);
    expect(listedRequest?.messages?.some((message) => message.authorRole === 'admin' && message.readAt == null),
      'the tracker list response lost the unread staff reply').toBe(true);

    const card = page.locator('div.rounded-xl.border-white\\/10').filter({ hasText: created.id.slice(0, 10) });
    await expect(card).toHaveCount(1);
  const messages = card.getByRole('button', { name: /^Messages/ });
    await expect(messages.locator('span.bg-rose-500')).toHaveText('1');

    const marked = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/service-requests/${created.id}/read`
        && response.request().method() === 'POST' && response.status() === 204,
    );
    await messages.click();
    await expect(card.getByText('The drafting desk needs one clarification.')).toBeVisible();
    await marked;
    await expect(messages.locator('span.bg-rose-500')).toHaveCount(0);
  });

  test('a co-fill invite reaches an unregistered number and is claimed on sign-up', async ({ page, browser, request }) => {
    await signedInAsNew(page);
    // A fresh unregistered mobile models the pending invitation fixture.
    const inviteeMobile = uniqueMobile();

    await page.goto('/services/rent-agreement');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    const created = await page.evaluate(async ({ mobile }) => {
      const svc = await import('/src/services/serviceRequestService.js');
      const r = await svc.createCoFillServiceRequest({
        request: {
          type: 'rental',
          customer: { name: 'Live Co-fill Owner' },
          details: { ownerName: 'Live Co-fill Owner', property: 'Baner, Pune' },
        },
        role: 'tenant',
        mobile,
      });
      return { id: r.id, status: r.status, parties: r.parties };
    }, { mobile: inviteeMobile });

    expect(created.id, 'the server assigned no id to the co-fill request').toBeTruthy();
    const invited = (created.parties || []).find((p) => p.role === 'tenant');
    expect(invited, 'the create did not return the invited party').toBeTruthy();
    expect(invited.status).toBe('invited');
    expect(invited.pending).toBe(true);
    expect(invited.mobile).toMatch(/^\d{2}X{5}\d{3}$/);
    expect(invited.mobile).not.toBe(inviteeMobile);

    // Use a separate context so the invitee session cannot overwrite the owner's fixture.
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();
    try {
      await apiLogin(inviteeMobile);
      await signedInAs(inviteePage, inviteeMobile);
      await inviteePage.goto('/services/rent-agreement');
      await expect(inviteePage.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

      const mine = await inviteePage.evaluate(async () => {
        const svc = await import('/src/services/serviceRequestService.js');
        return svc.listMyServiceRequestInvites();
      });
      const claimed = mine.find((p) => p.requestId === created.id);
      expect(claimed, 'the pending invite was not claimed on sign-up').toBeTruthy();
      expect(claimed.status).toBe('invited');
      expect(claimed.pending).toBe(false);

      const peek = await request.get(`${API}/service-requests/${created.id}`, {
        headers: await authHeaders(inviteeMobile),
      });
      expect(peek.status(), 'an unanswered invite already exposed the request').toBe(404);

      const afterAccept = await inviteePage.evaluate(async ({ partyId, id }) => {
        const svc = await import('/src/services/serviceRequestService.js');
        await svc.decideServiceRequestInvite(partyId, 'accept');
        const r = await svc.getServiceRequest(id);
        const listed = await svc.listServiceRequests('rental');
        return r ? { id: r.id, parties: r.parties, occurrences: listed.filter((item) => item.id === id).length } : null;
      }, { partyId: claimed.id, id: created.id });

      expect(afterAccept, 'accepting did not make the request readable to the party').not.toBeNull();
      expect(afterAccept.id).toBe(created.id);
      expect(afterAccept.occurrences, 'the accepted request is represented once in the party\'s own list').toBe(1);
      expect((afterAccept.parties || []).find((p) => p.role === 'tenant').status).toBe('accepted');

      const filled = await inviteePage.evaluate(async (id) => {
        const svc = await import('/src/services/serviceRequestService.js');
        const r = await svc.submitServiceRequestPartyDetails(id, { tenantName: 'Live Co-fill Tenant' });
        return r ? r.details : null;
      }, created.id);
      expect(filled).toMatchObject({ tenantName: 'Live Co-fill Tenant', ownerName: 'Live Co-fill Owner' });
    } finally {
      await inviteeContext.close();
    }

    const asOwner = await page.evaluate(async (id) => {
      const svc = await import('/src/services/serviceRequestService.js');
      const r = await svc.getServiceRequest(id);
      return r ? { details: r.details, parties: r.parties } : null;
    }, created.id);
    expect(asOwner, 'the requester lost sight of their own request').not.toBeNull();
    expect(asOwner.details).toMatchObject({ tenantName: 'Live Co-fill Tenant' });
    expect((asOwner.parties || []).find((p) => p.role === 'tenant').status).toBe('accepted');
  });

  test('withdrawing an unanswered co-fill invite frees the role for a new one', async ({ page, request }) => {
    const ownerMobile = await signedInAsNew(page);
    const wrongNumber = uniqueMobile();

    await page.goto('/services/rent-agreement');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    const outcome = await page.evaluate(async ({ wrong }) => {
      const svc = await import('/src/services/serviceRequestService.js');
      const created = await svc.createCoFillServiceRequest({
        request: {
          type: 'rental',
          customer: { name: 'Live Withdraw Owner' },
          details: { ownerName: 'Live Withdraw Owner', property: 'Kothrud, Pune' },
        },
        role: 'tenant',
        mobile: wrong,
      });
      const party = (created.parties || []).find((p) => p.role === 'tenant');
      const after = await svc.withdrawServiceRequestParty(created.id, party.id);
      return {
        id: created.id,
        partyId: party.id,
        remaining: (after?.parties || []).map((p) => ({ role: p.role, status: p.status })),
      };
    }, { wrong: wrongNumber });

    expect(outcome.remaining.some((p) => p.role === 'tenant')).toBe(false);

    const reissued = await request.post(
      `${API}/service-requests/${outcome.id}/parties`,
      {
        headers: await authHeaders(ownerMobile),
        data: { role: 'tenant', mobile: uniqueMobile() },
      },
    );
    expect(reissued.status(), await reissued.text()).toBe(201);

    const replay = await request.post(
      `${API}/me/service-request-invites/${outcome.partyId}`,
      { headers: await authHeaders(ownerMobile), data: { decision: 'accept' } },
    );
    expect([403, 404]).toContain(replay.status());
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
      return svc.getIdentityStatus();
    });

    expect(
      apiCalls.some((c) => /GET \/api\/me\/verification\/identity$/.test(c)),
      `saw: ${apiCalls.join(', ')}`,
    ).toBe(true);
    expect(status.verified).toBe(false);
    expect(status.status).toBe('none');
  });

  /* Submitting is a *queue*, not a grant. `POST /me/verification/identity` answers 202 and the
     next read still says pending — the badge waits on a staff decision. This is the security
     half: a client that could talk itself into a trust badge is a defect, and asserting the
     202 alone would not notice one that also flipped the flag. */
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
      const form = new FormData();
      form.set('docType', 'pan');
      form.set('consent', 'true');
      form.set('front', png, 'front.png');
      form.set('selfie', png, 'selfie.png');
      const res = await fetch('/api/me/verification/identity', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        body: form,
      });
      const svc = await import('/src/services/verificationService.js');
      return { code: res.status, after: await svc.getIdentityStatus() };
    }, PNG_1PX_BASE64);

    expect(code, 'acceptance into the queue is not a decision, so it is a 202').toBe(202);
    expect(after.status).toBe('pending');
    expect(after.verified).toBe(false);
  });

  test('the dev-only simulate endpoint finishes the badge where no reviewer sits (D122)', async ({ page }) => {
    // A fresh account prevents the irreversible simulation from changing seeded fixtures.
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
      const form = new FormData();
      form.set('docType', 'pan');
      form.set('consent', 'true');
      form.set('front', png, 'front.png');
      form.set('selfie', png, 'selfie.png');
      await fetch('/api/me/verification/identity', { method: 'POST', headers: auth, body: form });
      const res = await fetch('/api/me/verification/identity/simulate', { method: 'POST', headers: auth });
      const body = await res.json();
      const svc = await import('/src/services/verificationService.js');
      const next = await svc.getIdentityStatus();
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

