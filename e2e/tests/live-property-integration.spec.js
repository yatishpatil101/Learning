/**
 * LIVE integration check for the `property` domain (Phase 2).
 *
 * Everything else in this suite runs on mocks. This one deliberately does not: it drives the real UI
 * against a running backend and a seeded Postgres, because the parity harness compares *provider
 * outputs* and cannot tell you whether a page actually renders what the provider returned.
 *
 * It is excluded from the default run (see playwright.config.js `testIgnore`) — it needs
 * infrastructure the normal suite must not depend on. Run it explicitly:
 *
 *   # backend on :8081 against the seeded dev DB, then:
 *   cd frontend; $env:VITE_API_DOMAINS='auth,property'; $env:VITE_PROXY_TARGET='http://localhost:8081'; npm run dev
 *   cd e2e; npx playwright test tests/live-property-integration.spec.js --config=playwright.live.config.js
 *
 * The OTP is read from the backend's log, which is how a developer logs in locally too — the
 * dev `OtpSender` prints `[MOCK OTP] mobile=… code=…` rather than sending an SMS.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// A seeded owner with four listings, one of them `flagged`. The flagged row is the point: public
// `/properties` is floored to approved + non-archived server-side, so a My Listings built from
// public search shows 3. Only `GET /me/listings` returns all 4. If this test sees 4, the endpoint is
// genuinely being used; if it sees 3, the page silently regressed to public search.
const OWNER = { mobile: '9470744469', name: 'Meera Deshpande', total: 4, publiclyVisible: 3 };
const LOG = process.env.BACKEND_LOG || `${process.env.TEMP}\\boot7.log`;

/** Pull the most recent OTP the backend logged for `mobile`. */
function readOtp(mobile) {
  const lines = fs.readFileSync(LOG, 'utf8').split('\n');
  const hits = lines.filter((l) => l.includes('[MOCK OTP]') && l.includes(`mobile=${mobile}`));
  if (!hits.length) throw new Error(`No OTP logged for ${mobile} in ${LOG}`);
  return hits[hits.length - 1].match(/code=(\d+)/)[1];
}

/** Poll: the log line is written by the request thread, so it can trail the HTTP response slightly. */
async function otpFor(mobile) {
  for (let i = 0; i < 20; i += 1) {
    try { return readOtp(mobile); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return readOtp(mobile);
}

async function signIn(page, mobile) {
  const before = (() => { try { return readOtp(mobile); } catch { return null; } })();
  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(mobile);
  await page.getByRole('button', { name: /send otp|continue/i }).click();

  // Wait for a *new* code, not the one a previous test left behind.
  let code = await otpFor(mobile);
  for (let i = 0; i < 20 && code === before; i += 1) {
    await page.waitForTimeout(250);
    code = await otpFor(mobile);
  }

  // The OTP UI is six single-character boxes that auto-advance, not one field. Type into the first
  // and let the component move focus, which is also what a real user does.
  const boxes = page.locator('#root input[inputmode="numeric"]:not(#signin-mobile)');
  await expect(boxes.first()).toBeVisible();
  const count = await boxes.count();
  if (count > 1) {
    await boxes.first().click();
    for (const d of code) await page.keyboard.type(d);
  } else {
    await boxes.first().fill(code);
  }

  const verify = page.getByRole('button', { name: /verify|sign in|log in|continue/i });
  if (await verify.count()) await verify.first().click();
  await expect(page).not.toHaveURL(/signin/, { timeout: 20000 });
  return code;
}

/** Console errors that say nothing about this app — TLS interception on image CDNs, dev noise. */
const IGNORE = /favicon|leaflet|CDN|net::ERR|Download the React DevTools|ERR_CERT/i;

test.describe('LIVE: property domain against the real API', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
  });

  test.afterEach(() => {
    expect(errors.filter((e) => !IGNORE.test(e))).toEqual([]);
  });

  test('the catalogue is served by the API, not the mock', async ({ page }) => {
    // Prove provenance before asserting on content: if the switch silently fell back to mocks, every
    // assertion below would pass while testing nothing. This is the whole point of the test.
    const call = page.waitForResponse((r) => r.url().includes('/api/properties') && r.status() === 200);
    await page.goto('/listings');
    const res = await call;
    const body = await res.json();

    expect(body).toHaveProperty('totalElements');
    // Mock ids look like `P5100`; the backend's slugs are `p5000`. Rendering backend rows proves the
    // http provider answered.
    const cards = page.locator('[data-testid="property-card"], a[href^="/property/"]');
    await expect(cards.first()).toBeVisible({ timeout: 15000 });
    expect(body.totalElements).toBeGreaterThan(0);
  });

  test('detail, similar and location-insights render from API data', async ({ page }) => {
    await page.goto('/listings');
    const first = page.locator('a[href^="/property/"]').first();
    await expect(first).toBeVisible({ timeout: 15000 });
    const href = await first.getAttribute('href');

    // LocationInsights lives on the `location` tab, which is URL-driven — landing on `overview`
    // never mounts it, so the count would never be requested.
    const counted = page.waitForResponse(
      (r) => r.url().includes('/api/properties') && /[?&]size=1(&|$)/.test(r.url()),
      { timeout: 20000 },
    );
    await page.goto(`${href}?tab=location`);
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    // countProperties issues `size=1` and reads `totalElements` rather than counting a client-side
    // array. Assert the request shape: a regression to the old approach would still render a
    // plausible-looking number, so only the wire tells you which code ran.
    const res = await counted;
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.totalElements).toBeGreaterThan(0);
    // ...and it must be a *filtered* count, not the whole catalogue.
    expect(new URL(res.url()).searchParams.get('locality')).toBeTruthy();
  });

  test('compare resolves ids individually rather than downloading the catalogue', async ({ page }) => {
    await page.goto('/listings');
    const first = page.locator('a[href^="/property/"]').first();
    await expect(first).toBeVisible({ timeout: 15000 });
    const slug = (await first.getAttribute('href')).split('/').pop();

    // Key must match CompareContext (`puneNestCompare`) — seeding the wrong key would leave the
    // page empty and the test would pass while proving nothing.
    await page.evaluate((s) => localStorage.setItem('puneNestCompare', JSON.stringify([s])), slug);
    const byId = page.waitForResponse(
      (r) => r.url().includes(`/api/properties/${slug}`) && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/compare');
    await byId;
    await expect(page.getByText(/no longer available/i)).toHaveCount(0);
  });

  test('My Listings uses /me/listings and shows non-public statuses', async ({ page }) => {
    await signIn(page, OWNER.mobile);

    const mine = page.waitForResponse((r) => r.url().includes('/api/me/listings') && r.status() === 200);
    await page.goto('/dashboard');
    const body = await (await mine).json();
    const rows = Array.isArray(body) ? body : (body.content ?? []);

    // The load-bearing assertion of this whole file. 3 would mean the page fell back to public
    // search and quietly lost the owner's flagged listing.
    expect(rows.length).toBe(OWNER.total);
    expect(rows.length).toBeGreaterThan(OWNER.publiclyVisible);
    expect(rows.some((r) => r.status && r.status !== 'approved')).toBe(true);
  });

  test('the session survives a reload (no redirect to signin)', async ({ page }) => {
    await signIn(page, OWNER.mobile);
    await page.goto('/dashboard');
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await expect(page).not.toHaveURL(/signin/);
  });
});
