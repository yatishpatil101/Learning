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
 * dev `OtpSender` prints `[MOCK OTP] mobile=… code=…` rather than sending an SMS. **Set
 * `BACKEND_LOG` to the log of the backend you actually started.** The default below is only a
 * convenience, and pointing at a stale log from an earlier session is the failure mode to know:
 * the spec reads a long-dead code, sign-in fails, and the retries burn `MAX_SENDS_PER_WINDOW`, so
 * what you see is a cascade of `500 /api/auth/login` rather than "wrong OTP".
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

/**
 * Sign in **once per mobile per run**, then replay the stored session into later pages.
 *
 * `OtpService.SEND_COOLDOWN` is 60 seconds and the first login consumes the code, so a second
 * `signIn()` for the same number within a minute cannot succeed: the send is refused, no new code is
 * logged, and the spec sits on the mobile step until it times out. With five tests here needing a
 * session, that is the normal path rather than an edge case — and it is why the second owner test
 * failed the moment a third and fourth login joined the file.
 *
 * Replaying token storage rather than re-authenticating keeps each test independent without
 * pretending the rate limiter is not there. Both stores are captured because "remember me" decides
 * which one `lib/auth.js` writes to, and this must not depend on that choice.
 */
const sessions = new Map();

async function signedInAs(page, mobile) {
  if (sessions.has(mobile)) {
    // Storage is origin-scoped, so a document from the origin has to exist before writing to it.
    await page.goto('/');
    await page.evaluate(({ local, session }) => {
      for (const [k, v] of local) localStorage.setItem(k, v);
      for (const [k, v] of session) sessionStorage.setItem(k, v);
    }, sessions.get(mobile));
    return;
  }
  await signIn(page, mobile);
  sessions.set(mobile, await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  })));
}

/** Console errors that say nothing about this app — TLS interception on image CDNs, dev noise. */
const IGNORE = /favicon|leaflet|CDN|net::ERR|Download the React DevTools|ERR_CERT/i;

/**
 * Record every failed API response with its URL and status.
 *
 * `page.on('console')` reports "Failed to load resource: … 403" with no URL, which names a symptom
 * and hides the cause — a failure that could be any of a dozen requests the page made. Attaching to
 * `response` instead means a broken assertion says *which endpoint* broke.
 */
function watchApiFailures(page, sink) {
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) sink.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
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
    await signedInAs(page, OWNER.mobile);

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
    await signedInAs(page, OWNER.mobile);
    await page.goto('/dashboard');
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await expect(page).not.toHaveURL(/signin/);
  });
});

/**
 * LIVE: the listing moderation queue and the decisions taken on it.
 *
 * Same domain switch, different surface. Until `GET /admin/properties` shipped, the admin listings
 * page in http mode was structurally broken rather than merely incomplete: it asks for
 * `includeAllStatuses` + `includeArchived`, both of which the http provider dropped with a console
 * warning, so the page rendered the approved-only public catalogue. The Verification Queue — the one
 * tab whose entire purpose is unapproved listings — was therefore always empty, and the four
 * moderation buttons threw a "not shipped" error when clicked.
 *
 * The seeded admin signs in by OTP like anyone else: `users.email` and `password_hash` are NULL for
 * every seeded account, so `/auth/staff-login` is unusable here, but the role travels on the JWT and
 * that is what the server authorizes against.
 */
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

  /**
   * The load-bearing assertion of this block, and the mirror of "My Listings shows 4 not 3".
   *
   * The queue must return strictly more listings than public search and must include statuses public
   * search cannot express. Equality would mean the page had fallen back to `/properties` — which is
   * what it did before this slice, and which reads as an empty backlog rather than a broken request.
   */
  test('the admin list is served by /admin/properties and includes unapproved listings', async ({ page }) => {
    await signedInAs(page, ADMIN.mobile);

    const queued = page.waitForResponse(
      (r) => r.url().includes('/api/admin/properties') && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/admin/properties');
    const body = await (await queued).json();
    const rows = body.content ?? [];

    const publicTotal = await (await page.request.get('/api/properties?size=1')).json();
    expect(body.totalElements).toBeGreaterThan(publicTotal.totalElements);
    expect(rows.some((r) => r.status !== 'approved')).toBe(true);
    // `archived` had to be added to the response for the page to tell live rows from archived ones.
    expect(rows.every((r) => typeof r.archived === 'boolean')).toBe(true);
  });

  /**
   * A decision reaches the server and sticks.
   *
   * Featuring is chosen over approve/reject deliberately: it is the only one of the four that is
   * reversible by repetition, so the test restores the seeded dev database to the state it found it
   * in. Asserting the *request* as well as the UI matters — a regression to mock mode would still
   * update the screen, and only the wire says which code ran.
   */
  test('toggling featured issues a real request against the moderation route', async ({ page }) => {
    await signedInAs(page, ADMIN.mobile);
    await page.goto('/admin/properties');

    const toggle = page.locator('button[title="Feature"], button[title="Unfeature"]').first();
    await expect(toggle).toBeVisible({ timeout: 20000 });
    const before = await toggle.getAttribute('title');

    const call = page.waitForResponse((r) => /\/api\/properties\/[^/]+\/toggle-featured/.test(r.url()));
    await toggle.click();
    expect((await call).status()).toBe(200);

    // Put it back, so a re-run starts from the same place.
    const restore = page.waitForResponse((r) => /\/api\/properties\/[^/]+\/toggle-featured/.test(r.url()));
    await page.locator(`button[title="${before === 'Feature' ? 'Unfeature' : 'Feature'}"]`).first().click();
    await restore;
  });
});

/**
 * LIVE: the notification inbox.
 *
 * The risk in this domain is not that it breaks loudly — it is that it *works quietly and wrongly*.
 * Only the flatmate flows write notification rows server-side today, so a seeded demo account's
 * inbox is legitimately empty against the API, and almost any mistake here produces a plausible
 * empty page rather than an error. So these assert on the **wire**, not on rendered rows: that the
 * page asks the server at all, and that the seeded localStorage inbox is no longer being read.
 */
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

    const call = page.waitForResponse(
      (r) => r.url().includes('/api/notifications') && r.request().method() === 'GET' && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/notifications');
    const body = await (await call).json();

    // A PageEnvelope, not a bare array — the provider unwraps `content`, and a shape change here
    // would silently produce an empty inbox rather than an error.
    expect(body).toHaveProperty('content');
    expect(Array.isArray(body.content)).toBe(true);
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
  });

  /**
   * The seed must not run in http mode.
   *
   * `seedNotifsIfEmpty` writes eight fabricated rows to localStorage. Against the API those would be
   * indelible (not the server's to delete), invisible from any other device, and indistinguishable
   * from genuine platform messages. This is the assertion that the domain gate actually holds — and
   * it is checkable precisely because the seeded ids are known and stable.
   */
  test('the demo seed is not written to localStorage in http mode', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    await page.goto('/notifications');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    const seeded = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('pnNotifications:'));
      if (!key) return null;
      try { return JSON.parse(localStorage.getItem(key)); } catch { return 'unparseable'; }
    });
    // Either the key was never created, or it exists from an earlier mock-mode run but this visit
    // added nothing to it. Both are fine; a freshly written seed set is not.
    if (Array.isArray(seeded)) {
      expect(seeded.some((n) => String(n.id).startsWith('n-match-') || String(n.id) === 'n-system-welcome')).toBe(false);
    } else {
      expect(seeded).toBeNull();
    }
  });

  /** Mark-all is the one write with an endpoint, and an empty id list is what means "all". */
  test('mark all read posts to /notifications/read', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    await page.goto('/notifications');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    const markAll = page.getByRole('button', { name: /mark all/i });
    // Only rendered when something is unread — a seeded owner may have nothing to mark.
    if (!(await markAll.count())) {
      test.skip(true, 'nothing unread in this account; only flatmate flows write server notifications');
    }
    const call = page.waitForResponse(
      (r) => r.url().includes('/api/notifications/read') && r.request().method() === 'POST',
    );
    await markAll.first().click();
    expect((await call).status()).toBe(204);
  });
});

/**
 * LIVE: in-app messaging.
 *
 * A seeded account with a real thread, because every interesting assertion is about the *contents*
 * of a conversation rather than about whether the page loads.
 *
 * **One test, not four.** Each `test` gets a fresh browser context and therefore a fresh sign-in,
 * and `OtpService.SEND_COOLDOWN` refuses a second code for the same mobile inside 60 seconds —
 * which currently surfaces as a 500 rather than a 429 (tech-debt D90). Splitting these would make
 * the suite fail on the rate limiter rather than on anything about messaging. Signing in once and
 * walking the flow is also closer to what a user does.
 */
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

    // ── 1. the inbox comes from the API ──────────────────────────────────────────────────────
    const inbox = page.waitForResponse(
      (r) => /\/api\/messages(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/messages');
    const body = await (await inbox).json();
    // A PageEnvelope, not a bare array — the provider unwraps `content`, and a shape change here
    // would render an empty inbox rather than raise anything.
    expect(body).toHaveProperty('content');
    expect(body.totalElements).toBeGreaterThan(0);

    // The thread list must actually render. Asserted before the negative checks below, because a
    // signed-out page would satisfy every "X is absent" assertion trivially.
    const thread = page.locator('.pc-conv').first();
    await expect(thread).toBeVisible({ timeout: 15000 });

    // ── 2. the seeded demo threads must not appear ───────────────────────────────────────────
    // `lib/chat.js` seeds four fabricated conversations (`c1`–`c4`, "Sneha Deshpande") whenever
    // localStorage is empty. In http mode they must never render: they are indistinguishable from
    // real threads, cannot be replied to, and would be messages nobody sent.
    const seededIds = await page.evaluate(() => {
      try { return (JSON.parse(localStorage.getItem('pnConversations') || '[]') || []).map((c) => c.id); }
      catch { return []; }
    });
    expect(seededIds).not.toContain('c1');
    await expect(page.getByText('Sneha Deshpande')).toHaveCount(0);

    // ── 3. opening a thread reads it, and messages are attributed by id ──────────────────────
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
    expect(Array.isArray(detailBody.messages)).toBe(true);
    // The field the `authorId` contract addition exists for. Without it the client cannot tell
    // whose message is whose except by display name, which two users can share.
    expect(detailBody.messages.every((m) => typeof m.authorId === 'string')).toBe(true);

    expect((await read).status()).toBe(204);

    // Every bubble lands on exactly one side — never both, never neither. `.pc-row` carries the
    // side as a class (`pc-row me` / `pc-row them`), which is what `MessageBubble` renders from
    // `m.from` — the field the mapper derives from `authorId`.
    const bubbles = page.locator('.pc-row');
    await expect(bubbles.first()).toBeVisible({ timeout: 10000 });
    const sides = await bubbles.evaluateAll((els) => els.map((e) => ({
      me: e.classList.contains('me'),
      them: e.classList.contains('them'),
    })));
    expect(sides.length).toBeGreaterThan(0);
    expect(sides.every((s) => s.me !== s.them)).toBe(true);
    // A real thread has both sides in it — if everything landed on one side the attribution is
    // broken in a way that "exactly one class each" would not catch.
    expect(sides.some((s) => s.me)).toBe(true);
    expect(sides.some((s) => s.them)).toBe(true);
  });
});
