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
 *   # backend on :8081 under `dev,e2e` against punenest_e2e, then:
 *   cd e2e; npx playwright test tests/live-property-integration.spec.js --config=playwright.live.config.js
 *
 * Sign-in goes through `helpers/liveAuth.js`. It used to be done here, by scraping the OTP out of
 * the backend's log; under the `e2e` profile the code is a constant, so there is nothing to scrape
 * and `BACKEND_LOG` is no longer read. The failure mode that cost the most time — pointing at a
 * stale log, reading a long-dead code, and burning `MAX_SENDS_PER_WINDOW` on retries until the page
 * showed a cascade of 500s rather than "wrong OTP" — is gone with it.
 */
import { test, expect } from '@playwright/test';
import { pickDate } from '../helpers/datePicker.helper.js';
import { IGNORE as SHARED_IGNORE } from '../helpers/console.js';
import { signIn, signedInAs, signedInAsNew, authHeaders, API } from '../helpers/liveAuth.js';

// A seeded owner with four listings, one of them `flagged`. The flagged row is the point: public
// `/properties` is floored to approved + non-archived server-side, so a My Listings built from
// public search shows 3. Only `GET /me/listings` returns all 4. If this test sees 4, the endpoint is
// genuinely being used; if it sees 3, the page silently regressed to public search.
const OWNER = { mobile: '9470744469', name: 'Meera Deshpande', total: 4, publiclyVisible: 3 };
/** One of OWNER's seeded, approved listings — the property the deal tests transact on. */
const OWNER_LISTING = '1078d711-d3eb-5961-ab3c-30d4bdc5f377';

/** A 1×1 PNG. Small enough to sit inline, real enough that the server's sniffing accepts it. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Console errors that say nothing about this app.
 *
 * The bulk of it is the shared list (`helpers/console.js`) so this file cannot drift away from it —
 * a hand-maintained copy is the failure mode tech-debt D96 is about: the shared filter gains an
 * exemption, the copy does not, and this spec keeps failing on noise nothing else fails on.
 *
 * The three terms added on top are live-run-only and deliberately NOT pushed into the shared list:
 * this is the one spec that talks to a real backend through the corporate network, so it is the only
 * one that sees TLS interception (`ERR_CERT`) on third-party image hosts. Bare `CDN` and `net::ERR`
 * are short enough to appear inside a genuine application error — the shared filter dropped exactly
 * those two forms in D28 for that reason — so widening it would blind all ~200 mock specs to real
 * failures in order to quieten one spec that is excluded from the default run.
 *
 * The listeners themselves stay local too: this file needs the raw `String(e)` text and pairs it
 * with response-level attribution (`watchApiFailures`) rather than the shared helper's origin
 * heuristic, for the reason spelled out on `watchApiFailures` below.
 */
const IGNORE = new RegExp(`${SHARED_IGNORE.source}|CDN|net::ERR|ERR_CERT`, 'i');

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

/**
 * Record every API response as `"<status> <METHOD> <path>"`, for assertions about *provenance*.
 *
 * `page.waitForResponse` is the wrong tool for "did this page load from the API". It has to be
 * registered before the request and it silently discards anything its predicate rejects, so a
 * response that arrived with an unexpected status is indistinguishable from one that never came —
 * both surface as the same bare timeout, naming neither the endpoint nor what did happen.
 *
 * Recording every response and polling the log inverts that: the endpoint either shows up or the
 * failure message lists everything the page *did* ask for. It also removes the registration race
 * around a navigation, which is the other way that check goes quietly wrong.
 *
 * Reserve `waitForResponse` for a request triggered by a specific click, which is what it is good at.
 */
function watchApiCalls(page, sink) {
  page.on('response', (r) => {
    if (r.url().includes('/api/')) sink.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
}

/**
 * Collect the parsed JSON of every matching GET, for assertions about a response *body*.
 *
 * `waitForResponse(...).json()` cannot do this safely across a navigation. Chromium drops the body
 * buffer of any response whose document navigated away, so `.json()` throws "No resource with given
 * identifier found" — intermittently, because it only bites when the request the predicate matched
 * belonged to the *previous* page (the navbar polls several of these endpoints, so it often does).
 *
 * Reading inside a route handler is deterministic: `route.fetch()` reads the body while it still
 * belongs to the test, and `route.fulfill({ response })` hands the app the untouched original, so
 * the page under test behaves exactly as it would unrouted.
 *
 * Returns the sink array — assert on the last entry, after polling it non-empty.
 */
async function captureJson(page, urlRe) {
  const bodies = [];
  await page.route(urlRe, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    if (response.status() === 200) bodies.push(await response.json());
    await route.fulfill({ response });
  });
  return bodies;
}

/** Wait for `captureJson` to have seen at least one response, and return the most recent. */
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

    const mine = await captureJson(page, /\/api\/me\/listings(\?|$)/);
    await page.goto('/dashboard');
    const body = await lastJson(mine);
    const rows = Array.isArray(body) ? body : (body.content ?? []);

    // The load-bearing assertion of this whole file. 3 would mean the page fell back to public
    // search and quietly lost the owner's flagged listing.
    expect(rows.length).toBe(OWNER.total);
    expect(rows.length).toBeGreaterThan(OWNER.publiclyVisible);
    expect(rows.some((r) => r.status && r.status !== 'approved')).toBe(true);
  });

  test('the freshness confirmation survives the browser that made it', async ({ page }) => {
    // The defect this replaces: "still available" wrote `freshenedAt` into localStorage, so the
    // owner's phone showed a reset badge while every other reader -- including the owner's own
    // laptop, and every buyer -- carried on being told the listing was stale. The assertion is
    // therefore not "the button worked" but "somebody who was not this browser can see that it did".
    await signedInAs(page, OWNER.mobile);

    const posted = page.waitForRequest(
      (r) => r.method() === 'POST'
        && /\/api\/me\/listings\/[^/]+\/confirm-available$/.test(new URL(r.url()).pathname),
      { timeout: 15_000 },
    );
    await page.goto('/dashboard#listings');
    // Load-bearing on its own: the seeded listings are months old and have never been confirmed, so
    // they must read as needing attention. If the mapper stopped falling back to `createdAt` this
    // banner would vanish and every stale listing would silently look fresh.
    const banner = page.getByRole('button', { name: /Confirm all available/i });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await banner.click();
    const confirmedId = new URL((await posted).url()).pathname.split('/').at(-2);

    // The sweep posts sequentially, so the first request landing says nothing about the last. The
    // toast is emitted after the loop finishes -- the last observable effect, which is what a wait
    // has to anchor on if it is not to be a sleep with better manners.
    await expect(page.getByText(/listings? confirmed as available/i).first()).toBeVisible({ timeout: 30_000 });

    // Read back with a bare fetch on the owner's token: a different HTTP client entirely, which is
    // the whole point -- the browser's storage cannot be what is answering.
    const res = await fetch(`${API}/me/listings/${confirmedId}`, {
      headers: await authHeaders(OWNER.mobile),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).lastConfirmedAt).toBeTruthy();

    // The buyer-facing half. It has to be asserted on an *approved* row: this owner's four listings
    // include a flagged one, and `/properties/{id}` is floored to publicly visible, so confirming the
    // flagged row and then reading it anonymously is a 404 about moderation rather than freshness.
    // So ask the owner's own list which confirmed rows are public, and require at least one --
    // without that floor an empty sweep would pass silently.
    const mineRes = await fetch(`${API}/me/listings?size=100`, {
      headers: await authHeaders(OWNER.mobile),
    });
    const mineBody = await mineRes.json();
    const mineRows = Array.isArray(mineBody) ? mineBody : (mineBody.content ?? []);
    const publiclyConfirmed = mineRows.filter((r) => r.lastConfirmedAt && r.status === 'approved');
    expect(publiclyConfirmed.length).toBeGreaterThan(0);

    // Anonymous on purpose -- no headers. The freshness badge is a transparency signal, and a signal
    // only its author can see is not one.
    const publicRes = await fetch(`${API}/properties/${publiclyConfirmed[0].id}`);
    expect(publicRes.status).toBe(200);
    expect((await publicRes.json()).lastConfirmedAt).toBeTruthy();
  });

  test('the document vault round-trips upload and delete through /me/documents', async ({ page }) => {
    // The owner surface's list/upload/delete were flipped onto the http `document` provider (D124).
    // Prove the real endpoints, not the tile alone: a silent regression to lib/localStorage would
    // still render a plausible vault while never touching the API.
    await signedInAs(page, OWNER.mobile);

    // `/me/listings` feeds the property selector; wait for it so `docProp` resolves to a real listing
    // id (not the empty "portfolio" bucket) before we upload against it.
    const mine = page.waitForResponse((r) => r.url().includes('/api/me/listings') && r.status() === 200);
    await page.goto('/dashboard#documents');
    await mine;
    await expect(page.getByRole('heading', { name: 'Document Vault' })).toBeVisible();
    // The vault opens on Personal until `isOwner` resolves — the owner context appears once
    // /me/listings has landed, so wait for it rather than sampling it.
    const ownerCtx = page.getByRole('button', { name: 'Property docs' });
    await expect(ownerCtx).toBeVisible();
    await ownerCtx.click();

    // The dev seed ships no documents, so the first Title slot starts empty. Clear it first if an
    // earlier aborted run left a file behind — this test writes to a real database, and a failure
    // between upload and delete must not make every later run fail on a full slot.
    const stale = page.getByRole('button', { name: 'Remove Sale Deed' });
    if (await stale.count()) {
      await stale.click();
      await expect(stale).toHaveCount(0);
    }

    // Upload drives the flipped `uploadForCategory` → POST /me/documents/{propId} (multipart).
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
    await chooser.setFiles({ name: 'live-sale-deed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 live vault test') });
    // 201 Created — the upload mints a new vault row.
    expect((await posted).status()).toBe(201);

    // The freshly uploaded file is newest, so its slot now offers Remove.
    const removeBtn = page.getByRole('button', { name: 'Remove Sale Deed' });
    await expect(removeBtn).toBeVisible();

    // Remove drives the flipped `removeDoc` → DELETE /me/documents/{propId}/{docId}, restoring the
    // empty starting state.
    const deleted = page.waitForResponse(
      (r) => /\/api\/me\/documents\/[^/?]+\/[^/?]+$/.test(r.url()) && r.request().method() === 'DELETE',
      { timeout: 20000 },
    );
    await removeBtn.click();
    expect((await deleted).status()).toBeLessThan(300);
    await expect(page.getByRole('button', { name: 'Upload Sale Deed' })).toBeVisible();
  });

  test('the owner wizard creates the listing through POST /me/listings (D219)', async ({ page }) => {
    /* Until D219 the wizard's `persistListing` wrote a record into localStorage and stopped. The
       page said "Listed Successfully", the listing appeared in My Listings, and nothing had left
       the browser — so the server's duplicate detector, which runs inside `POST /me/listings`, was
       reachable only from admin post-on-behalf. The abuse it exists to catch (one flat listed
       twice, by two "owners") arrives through this form and nowhere else.

       Mock-mode specs cannot see that difference: the mock provider writes to the same localStorage
       the old code wrote to, so a regression would leave every one of them green. Only the wire
       distinguishes "the wizard saved" from "the wizard posted".

       This runs as a NEW account, never as OWNER. The database persists for the whole run and
       `My Listings uses /me/listings` above asserts an exact count of 4 for that seeded owner — a
       fifth listing filed under them would break a test that has nothing to do with this one. */
    await signedInAsNew(page);

    /* Step 1 comes from the draft the wizard restores from, the way `live-fees-and-photos.spec.js`
       does it: those answers are radio pills and chips, and a dozen clicks would say nothing this
       test is about. `floor` is seeded here rather than clicked because it is one of the three legs
       of the server's `(society, floor, bhk)` signal, and the leg the wizard holds as a string. */
    await page.addInitScript(() => {
      localStorage.setItem('pnDraft:list-property', JSON.stringify({
        propertyType: 'flat', bhk: '2 BHK', bathrooms: '2', carpetArea: '850', deal: 'rent',
        floor: '9', availableFrom: '2026-09-01',
      }));
      /* The cookie-consent banner is fixed to the bottom of the viewport at z-1400 and mounts a
         moment after the page does. Step 2 is long enough that "Next Step" sits at the bottom of
         the scroll, i.e. exactly underneath it, and Playwright refuses to click through an
         intercepting element — so the banner silently decides whether this test passes, purely on
         whether it mounted before or after the click. Consent is seeded (the same pattern as
         `doc-info.spec.js` / `deals-offers.spec.js`) so the banner never renders and the click is
         about the wizard rather than about timing. */
      localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({
        necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
      }));
    });

    const calls = [];
    watchApiCalls(page, calls);
    await page.goto('/list-property');

    const next = page.getByRole('button', { name: /Next Step/i });
    await next.click();

    /* Step 2 cannot be seeded whole: `useFormDraft` restores `form` but not `locationSet`, and the
       step fails with `err.location` until the pin has been placed in *this* session. The area
       search is the cheap way past that gate — `runMapSearch` resolves a known Pune locality from
       its own coordinate table before it ever calls Google. Address fields are typed after the
       search on purpose: moving the pin kicks off a reverse-geocode that fills whatever is blank,
       and typing afterwards both wins and marks the field owner-edited. */
    await page.getByRole('combobox', { name: /Search a locality/i }).fill('Baner');
    await page.getByRole('button', { name: 'Search location' }).click();

    /* Wait for the search to have actually resolved a locality before going on. The fill is async
       (`applyAddressFill` runs off the reverse-geocode), and without this the test raced it: on a
       slow lookup `form.locality` was still '' when Next was clicked, `validateStep2` set
       `err.locality`, and the wizard stayed on step 2 — which then failed further down at
       `toBeAttached()` on the step-3 photo input, twenty seconds and one very confusing error
       message away from the actual cause. `Select` marks an unset value with `is-placeholder`, so
       the absence of that class is the honest "a locality is now selected". */
    await expect(page.locator('[data-err="locality"] .pn-dropdown__value'))
      .not.toHaveClass(/is-placeholder/, { timeout: 15_000 });

    // A society name unique to this run: the point of the write is that a *server* row appears, and
    // a name shared with the seed would make "did it arrive" unanswerable.
    const society = `Seam Spec Residency ${Date.now()}`;
    const step2 = { flatNumber: 'A-902', society, pincode: '411045', monthlyRent: '31000', deposit: '90000' };
    for (const [field, value] of Object.entries(step2)) {
      await page.locator(`input[data-err="${field}"]`).fill(value);
    }
    // The optional meter box has no `data-err` — its placeholder is the stable handle. This is the
    // strongest duplicate signal the server has, and before D219 an owner had no way to send it.
    await page.getByPlaceholder(/MSEDCL electricity bill/i).fill(`1800${Date.now()}`.slice(0, 12));

    await next.click();

    // Step 3 — photos are the one hard requirement (`validateStep3`). The upload itself is proven by
    // `live-fees-and-photos.spec.js`; here it is a precondition for reaching Submit.
    const photo = page.locator('input[type="file"][accept*="image"]').first();
    await expect(photo).toBeAttached({ timeout: 20_000 });
    const uploaded = page.waitForResponse(
      (r) => r.url().includes('/me/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await photo.setInputFiles({ name: 'living-room.png', mimeType: 'image/png', buffer: PNG_1PX });
    expect((await uploaded).status()).toBe(201);

    const created = page.waitForResponse(
      (r) => /\/api\/me\/listings$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: /Submit Property/i }).click();

    // The decisive assertion. 201 and a server-minted id mean the row exists in Postgres and the
    // duplicate probe ran over it; anything else means the wizard saved to this tab and lied.
    const res = await created;
    expect(res.status(), `API calls: ${calls.join(', ')}`).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();

    await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 20_000 });

    /* And it must come back from the server, not from the localStorage mirror the wizard still
       keeps for edit prefill. `/dashboard` reads `myListings` through the seam, so a row here is a
       row the API returned. */
    const mine = await captureJson(page, /\/api\/me\/listings(\?|$)/);
    await page.goto('/dashboard');
    const rows = await lastJson(mine).then((b) => (Array.isArray(b) ? b : (b.content ?? [])));
    expect(rows.some((r) => String(r.id) === String(body.id))).toBe(true);
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

    // `recheck=` is excluded because the page issues *two* reads against this endpoint on mount:
    // the queue itself, and the stays-live re-check queue (Q14), which is `recheck=true&archived=
    // false` and is normally empty. Matching on the path alone caught whichever landed first, so
    // this asserted `0 > 16` roughly half the time — a race that reads as "the moderation queue is
    // broken" when the queue is fine and the *other* request answered.
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

    /* The navbar bell polls this endpoint too, so the response can be in flight on the
       previous document when `goto` runs — which is what made the old `waitForResponse`
       form fail intermittently. See `captureJson`. */
    const inbox = await captureJson(page, /\/api\/notifications(\?|$)/);
    await page.goto('/notifications');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    // A PageEnvelope, not a bare array — the provider unwraps `content`, and a shape change here
    // would silently produce an empty inbox rather than an error.
    const body = await lastJson(inbox);
    expect(body).toHaveProperty('content');
    expect(Array.isArray(body.content)).toBe(true);
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

  /**
   * Dismiss is now a server delete, not a localStorage tombstone (D93). The assertion is on the
   * wire — the X issues a real `DELETE /notifications/{id}` and the server answers 204 — and on the
   * effect: the row is gone after a reload, which a tombstone (cleared with site data) could not
   * guarantee. Skips when the seeded account's inbox is empty, since only flatmate flows and
   * message.received write server rows and this account may legitimately have none.
   */
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

    // The delete is durable: a fresh read from the server no longer returns the row.
    await page.reload();
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    await expect(rows).toHaveCount(before - 1);
  });
});

/**
 * LIVE: in-app messaging.
 *
 * A seeded account with a real thread, because every interesting assertion is about the *contents*
 * of a conversation rather than about whether the page loads.
 *
 * **One test, not four.** Each `test` gets a fresh browser context and therefore a fresh sign-in.
 * That used to be fatal - `OtpService`'s send cooldown refused a second code for the same mobile
 * inside 60 seconds, surfacing as a 500 rather than a 429 (tech-debt D90) - and the `e2e` profile
 * now sets the cooldown to 0, so it no longer is. Kept as one test anyway: every assertion here is
 * about the *contents* of one conversation, so splitting them would buy isolation between steps
 * that are not independent, at the cost of four sign-ins. Walking the flow once is also closer to
 * what a user does.
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
    const inbox = await captureJson(page, /\/api\/messages(\?|$)/);
    await page.goto('/messages');
    const body = await lastJson(inbox);
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
    /* The length floor comes first, and it is the whole assertion. `[].every(...)` is `true`, so a
       thread detail that returned no messages at all would satisfy the `authorId` check below —
       the one this block exists for — while proving nothing about it. The same test says as much
       thirty lines up about the negative assertions, and then this pair walked into the identical
       trap from the other direction. The seeded conversation has messages, so an empty array here
       is a server bug, not an empty inbox. */
    expect(Array.isArray(detailBody.messages)).toBe(true);
    expect(detailBody.messages.length).toBeGreaterThan(0);
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

/**
 * The property review the two `/property/:id` tests below read back.
 *
 * The seeded database contains **no property reviews at all** — verified by walking every listing
 * from `GET /properties?size=100` and reading each one's review list — so these tests mint their
 * own fixture rather than trusting one, for the same reason the locality test does (D100).
 *
 * The body text is a fixed string and not `Date.now()`-suffixed on purpose. `ReviewService` allows
 * one review per author per target and answers `409` forever after, so the row written on the first
 * run against a given database is the row every later run reads back — a unique body would be
 * unassertable from the second run onwards. Nothing keys on this constant at read time either (the
 * assertions compare the DOM against the *list response*, not against this object); it is here so a
 * fresh database gets a review with a distinctive sentence and a deliberately sparse category map.
 *
 * `value` and `owner` are omitted from `categories` deliberately: `categoryAverages` is sparse by
 * contract, and an aspect nobody rated must stay absent rather than appear at 0.0, so the fixture
 * has to leave some aspects unrated for that to be observable at all.
 */
const PROPERTY_REVIEW = {
  rating: 4,
  body: 'Row house was exactly as listed; the society gate is manned round the clock.',
  categories: { locality: 5, condition: 4, accuracy: 4 },
  recommend: true,
};

/**
 * The bearer token behind a cached session, so a fixture can act as somebody the page is not.
 *
 * Minting a reviewable standing needs two identities in one test — the visitor books the visit and
 * only the **owner** may mark it completed — and `signedInAs` can only put one of them in the page
 * at a time. Reading the token out of the session `signedInAs` already cached costs no extra login,
 * which matters: `OtpService` rate-limits sends per mobile, and the whole reason `signedInAs` exists
 * is that this file logs in more times than that budget allows.
 *
 * Calling this leaves `page` signed in as `mobile`, exactly as `signedInAs` would.
 */
async function tokenFor(page, mobile) {
  await signedInAs(page, mobile);
  // Read it off the page rather than out of `signedInAs`'s cache: that Map is module-private to
  // liveAuth.js and exporting it would publish an implementation detail to every spec. Both storage
  // areas are checked because "remember me" decides which one `lib/auth.js` writes to, and no spec
  // should depend on that choice.
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('puneNestTokens') || sessionStorage.getItem('puneNestTokens');
    return JSON.parse(raw || 'null')?.accessToken;
  });
  expect(token, `no access token cached for ${mobile}`).toBeTruthy();
  return token;
}

/**
 * Give `CHATTER` a published review on `OWNER_LISTING`, creating whatever it takes to be allowed one.
 *
 * **This is the fixture the file previously said it could not mint.** Writing a property review
 * needs `ReviewerStanding` — a completed visit or a tenancy — and the note on the locality test used
 * to conclude the badge half of the contract was therefore untestable here. It is not: a tenancy
 * only opens by closing a rent deal, but a *completed visit* is three ordinary API calls, and the
 * server derives `context: 'visit'` from it. That is what makes the property page's badge assertable
 * against a real backend for the first time.
 *
 * The visit lifecycle runs over the API rather than the UI on purpose. It is plumbing, not the
 * subject: `updateVisitStatus` is the owner's control and driving it through the owner dashboard
 * would put three unrelated screens between this fixture and the thing it exists to enable. The
 * review write is over the API for the harder reason — it can only ever succeed *once* per database,
 * so a UI write would give a success path that is unreachable from the second run onwards. What the
 * tests actually cover is the **read**, which is where both `❌` rows in COVERAGE.md were.
 *
 * Idempotent in all three steps, because every run after the first meets its own leftovers:
 *   - a live visit already exists → reuse it rather than take the `409` `schedule` throws;
 *   - it is already `completed` → skip the transitions, which `canTransition` would reject as a
 *     move out of a terminal state, and prefer it over a live one so that repeat runs take no
 *     other test's reschedulable visit away;
 *   - the review already exists → `409`, tolerated exactly as the locality test tolerates it.
 *
 * Returns the listing's slug, asserted to be something other than its UUID — see the navigation
 * comment in the first test for why the difference is the point.
 */
async function seedPropertyReview(page, request) {
  const owner = await tokenFor(page, OWNER.mobile);
  // Second, so the page is left as CHATTER — the identity both tests browse as.
  const chatter = await tokenFor(page, CHATTER.mobile);
  const as = (t) => ({ Authorization: `Bearer ${t}` });

  const listing = await (await request.get(`/api/properties/${OWNER_LISTING}`)).json();
  expect(listing.slug, 'the fixture listing needs a slug distinct from its UUID').toBeTruthy();
  expect(listing.slug).not.toBe(OWNER_LISTING);

  // ── 1. a visit on the listing ────────────────────────────────────────────────────────────────
  const mine = await (await request.get('/api/visits?size=50', { headers: as(chatter) })).json();
  // `cancelled` and `no-show` are terminal and evidence nothing, so a run that finds only those has
  // to book again rather than try to transition one of them.
  const usable = (mine.content ?? []).filter(
    (v) => v.propertyId === OWNER_LISTING && !['cancelled', 'no-show'].includes(v.status),
  );
  /* An already-completed visit is preferred over a live one, so that on every run after the first
     this fixture consumes nothing: `scheduled`/`confirmed` visits belong to whoever else is testing
     the visit lifecycle, and completing one would take away their Reschedule control. It cannot be
     avoided altogether — `VisitService.schedule` answers 409 to a second live visit *on the same
     property*, so when the only candidate is live there is nothing to do but use it. */
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

  // ── 2. the owner marks it completed ──────────────────────────────────────────────────────────
  // Two hops, not one: `scheduled → completed` is not a legal transition. And it must be the owner
  // who makes them — `VisitService` returns 403 to a visitor asking for anything but `cancelled`,
  // precisely so a reviewer cannot manufacture their own evidence.
  for (const next of ['confirmed', 'completed']) {
    if (visit.status === 'completed') break;
    const res = await request.patch(`/api/visit-requests/${visit.id}/status`, {
      headers: as(owner),
      data: { status: next },
    });
    expect(res.status(), `PATCH visit status → ${next}: ${await res.text()}`).toBe(200);
    visit = { ...visit, status: next };
  }

  // ── 3. the review ────────────────────────────────────────────────────────────────────────────
  const res = await request.post(`/api/properties/${OWNER_LISTING}/reviews`, {
    headers: as(chatter),
    data: PROPERTY_REVIEW,
  });
  expect([201, 409], `POST review: ${res.status()} ${await res.text()}`).toContain(res.status());
  if (res.status() === 201) {
    // The badge, derived server-side from the visit above and never from the request body — which
    // did not mention it. This is the half of the contract the locality route cannot exercise,
    // because a locality has no visit to evidence.
    expect((await res.json()).context).toBe('visit');
  }
  return listing.slug;
}

/**
 * The mounted, visible "Ratings & Reviews" section of a property page.
 *
 * Two things stand between a `goto` and being able to assert on this block, and both fail as an
 * element that is present but never visible rather than as anything that names itself:
 *
 *   - the section sits behind a `.fade-in`, held at `opacity: 0` until an IntersectionObserver adds
 *     `.visible`. `scrollIntoViewIfNeeded` deadlocks on that, so force the class the observer would
 *     have added — the same workaround `consumer/property/reviews-summary.spec.js` uses;
 *   - on phone widths `MobileCollapse` hides the panel behind a header row. This project runs
 *     `Desktop Chrome`, where that toggle is `lg:hidden` and the panel is `lg:block`, so nothing is
 *     needed here — but it is the first thing to check if these tests are ever run at a mobile size.
 */
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

/**
 * LIVE: reviews.
 *
 * Four things are worth driving through a real browser here, and none is visible to the parity
 * harness — which compares provider *output* and cannot see what the page does with it.
 *
 * 1. **The badge must not be invented.** `context` is the "Verified resident" / "Visited" chip and
 *    it is null on every locality review, because there is no visit or tenancy to evidence for a
 *    locality. The card used to render the chip unconditionally and fall through to "Visited" for a
 *    null, so the page asserted standing the server never granted. That is a *rendering* bug: the
 *    provider returned the correct null.
 * 2. **The locality key.** Reviews used to key on `activeName.toLowerCase()` — the display name —
 *    while the rest of the page used the slug. For a one-word locality the two agree, which is how
 *    it survived; a write followed by a read proves the page and the server settled on one key,
 *    because a mismatch means the review posts and then does not come back.
 * 3. **`/property/:id` is a different controller, and was 404ing.** `listPropertyReviews` shipped
 *    pointing at `/reviews/property/{id}`, which is not a route — that URI matches
 *    `/reviews/{entityType}/{entityId}` and `entityType` is `society|locality|owner`, so the server
 *    rejected `property` on every single live read. `ReviewsSection` catches a failed review read,
 *    so a total outage rendered as "No reviews yet" on every listing on the platform, and the entire
 *    mock-mode suite stayed green because in mock mode neither read is a request at all.
 * 4. **A summary read that fails while the list succeeds.** The aggregate grid needs the summary;
 *    the cards need only the list. Losing one read must show cards without stars rather than claim
 *    the listing is unreviewed — and that branch is *unreachable* on mocks, where both providers
 *    read the same `localStorage` rows and `page.route(...).abort()` intercepts nothing.
 *
 * The two property tests below therefore assert on values taken **off the wire** — the body text in
 * the list response, the numbers in the summary response — rather than on the absence of an error
 * message. An assertion that a 404 and an empty database both satisfy is what let (3) ship.
 *
 * **This writes its own fixture rather than trusting one.** The first version asserted on seeded
 * locality reviews — and there are none: the four rows that made it pass were written by
 * `review-parity.mjs` on earlier runs (D100). A test whose fixture is another tool's litter passes
 * until somebody cleans up.
 *
 * **And the write happens at most once, ever.** `ReviewService` enforces one review per author per
 * target and answers `409` on a second — correctly, since a review is an opinion and a user has one.
 * So this tolerates both outcomes: `201` and `409`. Since the live run resets `punenest_e2e` to its
 * seeded baseline before the first test, `201` is now the expected path every time; the `409` arm
 * stays because it costs one condition and it is what keeps this passing if you re-run against a
 * database on purpose (`E2E_SKIP_RESET=1`) while debugging a failure.
 *
 * The sign-in replays the cached session for `CHATTER`, established by the conversations block
 * above - a saved round trip rather than a necessity now that the `e2e` profile sets the send
 * cooldown to 0.
 */
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
    // The 409 below is an expected, correct answer — not a failure to report.
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

    // A PageEnvelope, not a bare array — the mapper unwraps `content`, and a shape change would
    // render an empty panel rather than raise anything.
    const before = await (await first).json();
    expect(before).toHaveProperty('content');

    // The reviews block lives behind a tab, so nothing in it is mounted until this click. Note the
    // fetch above already happened: the page loads reviews on mount regardless of which tab is
    // showing, which is what makes the assertion on `first` meaningful before this point.
    await page.getByRole('tab', { name: /reviews/i }).first().click();

    // ── write (once per user per target, forever) ────────────────────────────────────────────
    const body = `Living here since 2019 ${Date.now()}`;
    const posted = page.waitForResponse(
      (r) => /\/api\/reviews\/locality\/aundh$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );

    const form = page.locator('form', { has: page.locator('textarea') }).first();
    await expect(form.locator('textarea')).toBeVisible({ timeout: 15000 });
    await form.locator('textarea').fill(body);
    // A rating is required — the form posts nothing without one.
    await form.locator('button[type="button"]').nth(4).click();
    await form.getByRole('button', { name: /post/i }).click();

    const res = await posted;
    expect([201, 409]).toContain(res.status());
    if (res.status() === 201) {
      const created = await res.json();
      // The badge the client is not allowed to claim. A locality has no visit and no tenancy to
      // evidence, so the server returns none — and ignored the request body either way.
      expect(created.context ?? null).toBeNull();
      expect(created.rating).toBeGreaterThan(0);
      // Same slug on both sides. If the page had kept keying reviews on the display name, this
      // write would land under `aundh` and the re-read would look somewhere else.
      await expect(page.getByText(body)).toBeVisible({ timeout: 15000 });
    }

    // ── read ─────────────────────────────────────────────────────────────────────────────────
    // Runs on both paths: this user has a review on `aundh` either way, so the panel must show it.
    const listed = await page.evaluate(async () => {
      const r = await fetch('/api/reviews/locality/aundh');
      return r.json();
    });
    expect(listed.totalElements).toBeGreaterThan(0);
    expect(listed.content.every((rv) => rv.context == null)).toBe(true);
    await expect(page.getByText('Living here since 2019', { exact: false }).first())
      .toBeVisible({ timeout: 15000 });

    /* No badge assertion here, deliberately.
     *
     * The obvious `expect(getByText('Verified resident')).toHaveCount(0)` is **vacuous on this
     * page**: `locality/ReviewsBlock.jsx` renders a name, stars and the text, and has no badge at
     * all. It passes whatever the mapper does — verified by mutating the mapper to
     * `context: r.context ?? 'visit'` and watching this test stay green.
     *
     * The badge lives on `property/ReviewsSection.jsx`. This note used to end by saying the fixture
     * for it — a completed visit or a tenancy — was one this suite could not mint; `seedPropertyReview`
     * above mints it, and the property test below asserts the chip against a badge the server
     * actually granted. What stays true is that the assertion does not belong *here*, on a page with
     * no badge in it. The two halves are guarded where they can each fail:
     *   - **the mapper** must not default a null badge → `npm run parity:review` (caught the
     *     mutation above, twice);
     *   - **the server** must not evidence a locality → the wire assertion two lines up.
     * A green assertion that cannot go red is worse than no assertion: it reads like coverage. */
  });

  /**
   * The read that was 404ing for weeks while every listing page said "No reviews yet".
   *
   * Every assertion below is anchored to something the server sent in *this* run: the review body
   * comes out of the list response, the average and the five bar counts come out of the summary
   * response. That is the point. The bug this replaces produced a page that looked entirely correct
   * — friendly empty state, no error, no console noise — so any assertion an empty answer can also
   * satisfy is worthless here, and "the page did not show an error" is the emptiest of them.
   */
  test('the property review list and its summary are both served by the live API', async ({ page, request }) => {
    const slug = await seedPropertyReview(page, request);

    /* Both reads, matched on the exact pathname and the method but **not** on the status.
     *
     * Matching `r.status() === 200` inside the predicate is the trap: `waitForResponse` silently
     * discards anything the predicate rejects, so a 404 — the actual historical failure — would
     * arrive, be dropped, and surface as a bare timeout indistinguishable from a request that was
     * never made. Catching the timeout into `null` and asserting on the status separately keeps
     * "the server said no" and "the page never asked" as two different failures with two different
     * messages, and `calls` names what the page did ask for either way. */
    const calls = [];
    watchApiCalls(page, calls);
    const path = `/api/properties/${OWNER_LISTING}/reviews`;
    const arrival = (want) => page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === want,
      { timeout: 25_000 },
    ).catch(() => null);
    const listArrived = arrival(path);
    const summaryArrived = arrival(`${path}/summary`);

    /* Navigate by the **slug**, and note that the paths above are the **UUID**.
     *
     * `/property/:id` takes the slug because the seam's `p.id` is one, while the review routes bind
     * `@PathVariable UUID propId` and need `p.uuid`. A page that reused its own URL token for the
     * review read would 404 on every slugged listing — which is every curated listing on the
     * platform — so navigating by UUID here would hide exactly the class of bug this test exists
     * for. `?tab=amenities` because `PropertyTabs` only mounts the reviews block on that tab. */
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

    /* A bare array by ruling D8.6, not the `PageEnvelope` the entity route answers with — the two
       review routes genuinely differ in shape, and `toViewModelListPage` is what hides that from
       the page. A silent switch to an envelope would render zero cards and raise nothing. */
    const rows = await listRes.json();
    expect(Array.isArray(rows), `expected a bare array, got ${JSON.stringify(rows).slice(0, 200)}`).toBe(true);
    const mine = rows.find((r) => r.author === CHATTER.name);
    expect(mine, `no review by ${CHATTER.name} in ${JSON.stringify(rows).slice(0, 400)}`).toBeTruthy();
    expect(mine.targetType).toBe('property');
    expect(mine.targetId).toBe(OWNER_LISTING);

    const section = await openReviewsSection(page);

    /* The text is read off the response rather than compared to `PROPERTY_REVIEW.body`, because the
       write happens at most once per database and a later run reads back whatever the first one
       wrote. Wire-derived is also the stronger assertion: it says the DOM rendered *this* payload,
       not that the DOM contains a string the test already knew. */
    await expect(section.getByText(mine.body, { exact: false }).first()).toBeVisible();
    await expect(section.getByText(CHATTER.name, { exact: false }).first()).toBeVisible();

    /* The badge, on the page that has one. `context` was derived from the completed visit the
       fixture minted; the request body never mentioned it. This is the property-side half of the
       "no fabricated badge" contract the locality test above cannot reach.

       `exact: true` matters: the filter chip above the cards is labelled "Visited (1)", so a
       substring match would pass on the filter row alone and prove nothing about the card. */
    expect(mine.context).toBe('visit');
    await expect(section.getByText('Visited', { exact: true }).first()).toBeVisible();

    // ── the aggregate is the summary payload, not a tally of the cards ─────────────────────────
    const sum = await summaryRes.json();
    expect(sum.reviewCount, 'the fixture should have left at least one published review').toBeGreaterThan(0);

    const aggregate = section.getByTestId('reviews-aggregate');
    await expect(aggregate).toBeVisible();
    await expect(section.getByTestId('reviews-average')).toHaveText(Number(sum.avgRating).toFixed(1));
    await expect(aggregate).toContainText(`${sum.reviewCount} review${sum.reviewCount === 1 ? '' : 's'}`);

    /* Bucket alignment by position. `distribution` arrives with string keys `"1"…"5"` and is drawn
       from a 0-based array, so an off-by-one lands the 5★ count on the 4★ bar and still renders a
       perfectly plausible chart — there is no way to see it except one bar at a time. */
    for (const star of [5, 4, 3, 2, 1]) {
      await expect(section.getByTestId(`reviews-bar-${star}`))
        .toHaveText(String(sum.distribution[String(star)] ?? 0));
    }

    /* Sparse by contract, both ways. An aspect somebody rated must appear; an aspect nobody rated
       must stay absent rather than show 0.0, which would be a claim no reviewer made. Scoped to the
       aspect card, because every review card prints its own category chips and a section-wide text
       scrape passes even when this card is missing entirely. */
    const cats = section.getByTestId('reviews-cat-averages');
    const rated = Object.keys(sum.categoryAverages ?? {});
    expect(rated.length, 'the fixture rates some aspects and leaves others unrated').toBeGreaterThan(0);
    for (const key of ['locality', 'condition', 'value', 'owner', 'accuracy']) {
      /* A plain substring, no `\b` on either side. The card renders each label glued to its average
         with no separator — "Locality5.0Condition4.0" — so both boundaries sit between two word
         characters and never match. Substring is precise enough because no aspect label contains
         another, and this locator is scoped to the aspect card, which holds nothing but the five
         labels and their numbers — no review prose that could coincidentally contain "value". */
      const label = new RegExp(key, 'i');
      if (rated.includes(key)) await expect(cats).toContainText(label);
      else await expect(cats).not.toContainText(label);
    }
    for (const key of rated) await expect(cats).toContainText(Number(sum.categoryAverages[key]).toFixed(1));

    // The empty state is a claim about the listing, and this listing has a review on it.
    await expect(section).not.toContainText(/no reviews yet/i);
    await expect(section.getByTestId('property-reviews-unavailable')).toHaveCount(0);
  });

  /**
   * A summary read that fails while the list succeeds — `e2e/COVERAGE.md` line 91.
   *
   * `ReviewsSection` splits "are there reviews to show" from "is there an aggregate to draw" so
   * that losing one of the two reads shows cards without stars, and says the rating is unavailable,
   * instead of announcing that the listing has no reviews. Before that split, `!summary.count` alone
   * chose the empty panel and every card lived in the other branch: a listing with a screenful of
   * reviews told the visitor it had none.
   *
   * This can only be written against a live config. In mock mode both providers read the same
   * `localStorage` rows, so neither read is a request, `page.route(...).abort()` intercepts nothing,
   * and a test written there would pass without ever entering the branch — which is worse than not
   * having one. See the closing note in `consumer/property/reviews-summary.spec.js`.
   */
  test('a failed summary read leaves the reviews rendered and says the rating is unavailable', async ({ page, request }) => {
    const slug = await seedPropertyReview(page, request);

    const path = `/api/properties/${OWNER_LISTING}/reviews`;
    // Exact pathname, so the list read one segment up is untouched — the whole point is that only
    // one of the two fails. `abort` rather than a 500 body: a dropped connection is the failure the
    // page has the least warning about, and it exercises the same `.catch` a status error would.
    await page.route(
      (u) => u.pathname === `${path}/summary`,
      (route) => route.abort('failed'),
    );

    const listArrived = page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === path,
      { timeout: 25_000 },
    ).catch(() => null);
    await page.goto(`/property/${slug}?tab=amenities`);

    /* The list must genuinely have succeeded, with rows in it. Skip this and the test passes on a
       page where *both* reads failed — which is a different branch rendering a different sentence,
       and asserting the aggregate is absent would be satisfied by it. */
    const listRes = await listArrived;
    expect(listRes, `no GET ${path} arrived`).not.toBeNull();
    expect(listRes.status()).toBe(200);
    const rows = await listRes.json();
    const mine = rows.find((r) => r.author === CHATTER.name);
    expect(mine, 'the fixture review should still be readable — only the summary was aborted').toBeTruthy();

    const section = await openReviewsSection(page);
    // Settled, not still in flight: every assertion below is about a state the skeleton has left.
    await expect(section.getByTestId('reviews-summary-skeleton')).toHaveCount(0);

    // The cards are there, drawn from the read that worked.
    await expect(section.getByText(mine.body, { exact: false }).first()).toBeVisible();

    // The aggregate is not, and is not faked from the cards either — `ReviewsSection` deliberately
    // keeps no client-side reduce as a fallback, because that reduce is the thing D79 replaced and
    // a copy of it would mean a broken summary endpoint never surfaces.
    await expect(section.getByTestId('reviews-aggregate')).toHaveCount(0);
    await expect(section.getByTestId('reviews-average')).toHaveCount(0);

    // Named in place of the missing average, rather than silently dropped: a listing with reviews
    // and no rating is not a state the server can produce, so the page has to say what happened.
    await expect(section.getByTestId('property-rating-unavailable')).toBeVisible();

    /* The two sentences that must NOT appear. "No reviews yet" is the regression this whole row
       exists for — it is a claim about the listing, and one failed read is no basis for it. The
       whole-section failure notice is wrong too: the list arrived, so there is something to show. */
    await expect(section).not.toContainText(/no reviews yet/i);
    await expect(section.getByTestId('property-reviews-unavailable')).toHaveCount(0);
  });
});

/**
 * LIVE: support tickets.
 *
 * The wiring is the least interesting part; what is worth driving through a browser is that **three
 * controls the mock offers have no server behind them**, and the page has to stop offering them
 * rather than let them silently do nothing:
 *
 * 1. **Priority** — not on `SupportTicket` *or* `SupportTicketCreate`. An unknown property is
 *    ignored rather than rejected, so a form that still sent it would show a success toast for a
 *    ticket nobody ever sees as urgent.
 * 2. **Image attachments** — `MessageCreate` is `{ body }`; the contract states an attachment field
 *    would be accepted and dropped.
 * 3. **Identity** — the mock keys tickets on a typed mobile, the server on the session.
 *
 * Unlike the reviews block, these assertions **can** go red: the controls exist in the DOM on mocks
 * and must not exist here, so `toHaveCount(0)` is a real constraint rather than a statement about a
 * page that never had them. Verified by flipping `richTicket` to a constant `true` and watching this
 * fail.
 *
 * The write is repeatable — there is no one-per-user rule on tickets — so this raises a fresh one
 * each run and asserts on that specific subject.
 */
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

    // A bare array, not a PageEnvelope — the contract keeps this list unpaged because it grows with
    // one person's own support history. The provider maps it directly, so a shape change here would
    // render an empty ticket list rather than raise anything.
    const body = await (await listed).json();
    expect(Array.isArray(body)).toBe(true);

    // ── the dead controls must be absent ─────────────────────────────────────────────────────
    await expect(page.getByText('Priority', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Attach screenshots')).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    // ── raise one ────────────────────────────────────────────────────────────────────────────
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
    // Every ticket opens `open`; `new` is a mock-only status the server has never heard of.
    expect(ticket.status).toBe('open');
    // The identity fields the form still collects are *not* on the schema — the raiser is the
    // session. Asserted on the wire so a mapper that started sending them fails here.
    expect(ticket).not.toHaveProperty('priority');
    expect(ticket).not.toHaveProperty('mobile');

    // The thread opens on submit and the new ticket appears in the list.
    await expect(page.getByText(subject).first()).toBeVisible({ timeout: 15000 });

    // ── reply ────────────────────────────────────────────────────────────────────────────────
    const replied = page.waitForResponse(
      (r) => /\/api\/support\/tickets\/[^/]+\/messages$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    const reply = `Following up ${Date.now()}`;
    await page.getByPlaceholder(/type your reply/i).fill(reply);
    await page.getByRole('button', { name: /^send$/i }).click();

    expect((await replied).status()).toBe(201);
    // `.first()` because the reply lands in two places at once — the open thread and the ticket
    // card's preview line — and a bare getByText is a strict-mode violation the moment both render.
    await expect(page.getByText(reply).first()).toBeVisible({ timeout: 15000 });
  });
});

/**
 * LIVE: abuse reports — the consumer's complaint and the ops queue that answers it.
 *
 * The first domain in the seam whose **two ends have different audiences**: anyone signed in may
 * file, only staff/admin may read. So this walks the whole loop across two sessions, which is also
 * the only way to prove the report actually arrived — a create that returns 201 into a queue nobody
 * can see is not evidence of anything.
 *
 * Three server rules the mock has no equivalent for, and each one changed a control:
 *
 * 1. **A duplicate is a 409.** The modal used to close and toast success unconditionally, because a
 *    localStorage write cannot fail. Live, a second live report of the same target gets refused —
 *    and thanking somebody for a report nobody received is the one outcome worth avoiding.
 * 2. **The reason is validated against the target type.** `SHARE_REPORT_REASONS` + `kind='user'`
 *    (what Flatmates.jsx sent) is a 400: `filled` is not something you can say about a person.
 * 3. **Terminal is terminal.** A decided report cannot be reopened, so the queue's Reopen button is
 *    gone rather than left to 409 on click.
 *
 * `CHATTER` files and `ADMIN` moderates — both sessions are already cached by the blocks above, so
 * this adds no sign-in and stays clear of the OTP rate limiter (D90).
 */
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
    // A 409 on the second submission is the expected, correct answer — not a failure to report.
    const expected = /409/;
    expect(
      errors.filter((e) => !IGNORE.test(e) && !expected.test(e)),
      `failed API calls: ${apiFails.filter((f) => !expected.test(f)).join(', ') || 'none'}`,
    ).toEqual([]);
  });

  test('a report reaches the ops queue, and a duplicate is refused', async ({ page }) => {
    // ── file one, as an ordinary user ────────────────────────────────────────────────────────
    await signedInAs(page, CHATTER.mobile);

    await page.goto('/listings');
    const card = page.locator('a[href^="/property/"]').first();
    await expect(card).toBeVisible({ timeout: 20000 });
    // Navigate by href rather than clicking: a listing card carries a heart and a compare toggle
    // that can intercept the click, and this test is not about the card.
    await page.goto(await card.getAttribute('href'));

    // The report entry point on a property page is the trust strip, not the reviews header — that
    // one only renders behind the `reviewsEnabled` flag and further down the page.
    const reportBtn = page.getByRole('button', { name: /report/i }).first();
    await expect(reportBtn).toBeVisible({ timeout: 20000 });
    await reportBtn.click();
    const modal = page.getByRole('dialog', { name: /report/i });
    await expect(modal).toBeVisible({ timeout: 10000 });
    // Any listing reason; `fake` is in FOR_PROPERTY on both sides.
    await modal.getByRole('button', { name: /fake photos or misleading info/i }).click();

    // Registered here, not before the navigation: the whole browse-and-open journey would
    // otherwise burn the timeout before the request that is actually being waited for is made.
    const filed = page.waitForResponse(
      (r) => /\/api\/reports$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await modal.getByRole('button', { name: /submit report/i }).click();

    const res = await filed;
    // 201 the first time this user reports this listing, 409 on every rerun. Both are correct, and
    // asserting only on 201 would make the suite pass exactly once and fail forever.
    expect([201, 409]).toContain(res.status());
    let reportId = null;
    if (res.status() === 201) {
      const created = await res.json();
      reportId = created.id;
      // The reporter is the principal, never the body. Asserted on the wire so a mapper that
      // started sending one fails here rather than turning the queue into an abuse vector.
      expect(created).not.toHaveProperty('reporterId');
      expect(created.status).toBe('open');
      expect(created.targetType).toBe('property');
    }

    // ── moderate it, as an admin ─────────────────────────────────────────────────────────────
    /* The "a consumer gets 403" half is asserted in `npm run parity:report`, not here.
     *
     * The obvious browser probe — `page.evaluate(() => fetch('/api/reports'))` — proves nothing:
     * a bare fetch carries no Authorization header, because the app attaches it in `services/http.js`.
     * It answers 401-unauthenticated, not 403-wrong-role, which is a different and much weaker
     * claim. The harness signs in as a real consumer and asserts the real 403. */
    await signedInAs(page, ADMIN.mobile);

    const queue = page.waitForResponse(
      (r) => /\/api\/reports(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.status() === 200,
      { timeout: 20000 },
    );
    await page.goto('/admin/reports');
    const body = await (await queue).json();
    // A PageEnvelope — the queue is paged since the spec fix, because every signed-in user can add
    // to it and only ops can take anything out.
    expect(body).toHaveProperty('content');
    expect(body.totalElements).toBeGreaterThan(0);

    if (reportId) {
      // The report we just filed is actually in the moderator's queue. This is the assertion the
      // whole test exists for: create + list on their own prove only that two endpoints answered.
      expect(body.content.some((r) => r.id === reportId)).toBe(true);
    }

    // A decided report offers no Reopen — the control was removed because the server refuses the
    // transition. Asserted on the page rather than the wire: it is a rendering decision.
    await expect(page.getByRole('button', { name: /^reopen$/i })).toHaveCount(0);
  });
});

/*
 * The four domains that shipped an http provider in `e330cd3` but were never added to
 * `VITE_API_DOMAINS`, so no browser had ever run them. Their parity harnesses passed the whole
 * time — the harness drives the provider directly, which is exactly the blind spot these tests
 * close: it cannot see a React call site that never awaits, or a request fired for a visitor who
 * has no session.
 */
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
    /* The gate answers "where does *this caller* stand with this owner". A visitor with no session
       has by definition made no request, so the server can only ever say 401 — and the property page
       mounts the hook from several places, so this fired four doomed requests per view.
       `afterEach` would catch the console noise; this asserts the cause directly so a regression
       names the endpoint rather than a red console. */
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
    /* One test, three domains, one sign-in. `OtpService` enforces a per-mobile send budget as well
       as the 60s cooldown, so a spec that logs in once per domain runs out of codes before it runs
       out of assertions — which fails as a timeout on the OTP screen and looks like a product bug. */
    const calls = [];
    watchApiCalls(page, calls);
    await signedInAs(page, CHATTER.mobile);

    await page.goto('/dashboard');
    // Provenance: if any of these had fallen back to its mock, the rest of the assertions would pass
    // while proving nothing — which is exactly how these four domains stayed untested for so long.
    // Polling the recorded log rather than racing `waitForResponse` against the navigation, and the
    // message names everything the page *did* request when it goes wrong.
    await expect
      .poll(() => calls.filter((c) => / GET \/api\/(me\/saved|me\/saved-searches|visits|me\/visit-requests)$/.test(c)),
        { timeout: 30000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toEqual(expect.arrayContaining([
        '200 GET /api/me/saved',
        '200 GET /api/me/saved-searches',
        // Both sides of the visit relationship, deliberately separate: the dashboard serves one
        // person who may be both a seeker and an owner, and a single unscoped read would have shown
        // them strangers' visits.
        '200 GET /api/visits',
        '200 GET /api/me/visit-requests',
      ]));

    /* Reschedule now has a server home: D87 added `PATCH /visits/{id}/slot`, which moves the slot in
       place and resets the visit to scheduled. The control is offered in http mode again; drive it
       and prove the write reaches the new endpoint rather than trusting the optimistic toast.

       `#visits` matters: the provenance poll above passes on bare `/dashboard` because the dashboard
       loads every domain up front, but Reschedule is rendered by `VisitsTab`, which only mounts on
       the Scheduled Visits tab. Without the hash this waited ten seconds on the Overview screen for
       a button that was never going to be there and reported it as a missing control. */
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

    /* `PageEnvelope` names the current page `page`, not Spring's raw `number`. Four providers read
       the wrong one behind a fallback that hid it, so this is asserted on the wire. */
    const saved = await page.evaluate(async () => {
      const tokens = JSON.parse(localStorage.getItem('puneNestTokens') || sessionStorage.getItem('puneNestTokens') || 'null');
      const res = await fetch('/api/me/saved?size=5', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
      return res.json();
    });
    expect(saved).toHaveProperty('page');
    expect(saved).toHaveProperty('totalElements');

    // The heart is optimistic, so the write is the only proof it reached the server. Registered
    // immediately before the click that triggers it — the one thing `waitForResponse` is good at.
    await page.goto('/listings');
    /* Asserted present rather than guarded. The control disappearing from the results page is
       precisely the regression that breaks saving, and an `if (await heart.count())` around the
       whole block would report success in exactly that case — the test would stop testing at the
       moment it started mattering. The seeded catalogue always has approved listings, so a missing
       heart is a real failure and not an environment difference. */
    const heart = page.locator('button[aria-label*="save" i], button[aria-label*="shortlist" i]').first();
    await expect(heart).toBeVisible({ timeout: 15000 });
    const wrote = page.waitForResponse(
      (r) => /\/api\/me\/saved/.test(r.url()) && ['PUT', 'POST', 'DELETE'].includes(r.request().method()),
      { timeout: 20000 },
    );
    await heart.click();
    // Idempotent on both sides: saving twice is not an error, and neither is unsaving.
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
    /* The catalogue read is public, and this is the page that exists to convert someone who has not
       signed in. A provider that short-circuited on a missing session — which is the right thing for
       every caller-scoped read in this suite — would blank it for exactly that visitor. */
    await page.context().clearCookies();
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto('/plans');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    await expect
      .poll(() => calls.filter((c) => / GET \/api\/plans$/.test(c)),
        { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toContain('200 GET /api/plans');

    // No 401 on the way: a public read must not be attempted with, or blocked by, a missing session.
    expect(apiFails.filter((f) => /\/api\/plans/.test(f))).toEqual([]);
  });

  test('buying a paid plan leaves it pending, and the entitlement it gates stays shut', async ({ page }) => {
    /* The whole point of this domain. `POST /me/subscription` on a priced plan creates the row
       `pending` against a payment-gateway order; only the signature-verified payment webhook moves
       it to `active`. Nothing the browser does can.

       So the assertion is not "the purchase succeeded" — it is that the app tells the truth about a
       purchase that has not settled, and does not hand over the entitlement early. */
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
    // Asserted on the wire, because this is the field the entitlement is derived from.
    expect(body.status).toBe('pending');

    // The screen says pending, not "payment successful" — and offers no onward link that depends on
    // a ceiling the caller does not have yet.
    await expect(page.getByText(/pending/i).first()).toBeVisible({ timeout: 15000 });

    // The gate itself: a pending purchase must not unlock the paid-owner Feature action.
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
    /* `isDealClosed(owner, id)` used to be a synchronous localStorage read per listing row. Against
       the API that is one request per card, which is the N+1 this seam exists to avoid — so the
       panel makes a single `/me/deals` call and indexes it.

       Asserting the *count* is what makes this a real check: asserting only that the endpoint was
       called would still pass if every card called it separately. */
    await signedInAs(page, OWNER.mobile);
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto('/dashboard#listings');
    await expect
      .poll(() => calls.filter((c) => / GET \/api\/me\/deals$/.test(c)).length,
        { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toBeGreaterThan(0);

    // The owner has four listings. One read covers all of them; a per-card read would be four.
    const dealReads = calls.filter((c) => /GET \/api\/me\/deals$/.test(c)).length;
    expect(dealReads, `one read should serve every card, saw ${dealReads}`).toBeLessThanOrEqual(2);

    // And no per-property probe: `/me/deals/{id}` is the single-listing route the panel must not use.
    expect(calls.filter((c) => /GET \/api\/me\/deals\/[0-9a-f-]{36}$/.test(c))).toEqual([]);
  });

  test('a signed-out visitor on a listing asks the deal API nothing at all', async ({ page }) => {
    /* Every route in this domain is caller-scoped, so for a visitor with no session they can only
       answer 401. Firing them anyway is the defect the contact gate had: four 401s per page view,
       each one a round trip spent to be told something the client already knew.

       The panel is also the place a buyer would learn a listing is sold — and cannot, because
       `/me/deals` is owner-only. It must not try. */
    await page.context().clearCookies();
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto(`/property/${OWNER_LISTING}`);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    const dealCalls = calls.filter((c) => /\/api\/(me\/deals|me\/offers|offers\/mine|me\/finalization-requests|finalization\/)/.test(c));
    expect(dealCalls, `a signed-out visitor should ask the deal API nothing, saw: ${dealCalls.join(' | ')}`).toEqual([]);
  });

  test('a buyer offer round-trips, and the buyer is refused the owner\'s decisions', async ({ page }) => {
    /* The security property of this slice, exercised through the UI rather than the harness.

       `OfferService.respond` reserves accept and decline for the listing owner: otherwise a buyer
       could mark a price agreed with no owner involvement and, through the status-driven contact
       reveal, unmask a mobile the owner never chose to share. The property page used to offer the
       buyer an "Accept" button that did exactly that against the mock.

       So this asserts two things at once: the offer really reaches the API, and the control that
       would have broken is not on the page. */
    await signedInAs(page, CHATTER.mobile);
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto(`/property/${OWNER_LISTING}`);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    // The buyer's own offers are read from `/offers/mine`, never from the owner's book.
    await expect
      .poll(() => calls.filter((c) => / GET \/api\/offers\/mine$/.test(c)),
        { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .not.toEqual([]);

    // A buyer must never be shown the owner-only endpoints, even signed in.
    expect(calls.filter((c) => /GET \/api\/me\/offers$/.test(c))).toEqual([]);
    expect(calls.filter((c) => /GET \/api\/me\/deals/.test(c))).toEqual([]);

    // And no bare "Accept" control on the buyer's side of the negotiation: agreeing is expressed as
    // a counter at the owner's number, which is the one response the server allows them.
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

  test('Pay Rent loads tenancy, payout and history from the API, and asks for none of it signed out', async ({ page }) => {
    /* Every read on this page is caller-scoped. For a visitor with no session they can only answer
       401, so firing them is a round trip spent to be told something the client already knows —
       the defect the contact gate had, four times per page view.

       The page also reads a **payout account**, which is the one place a bank account could leak
       into a public page. It must not be requested at all without a session. */
    await page.context().clearCookies();
    const anonCalls = [];
    watchApiCalls(page, anonCalls);
    await page.goto('/pay-rent');
    await page.waitForTimeout(1500);
    const leaked = anonCalls.filter((c) => /\/api\/(me\/tenancies|me\/rent-payments|me\/rent-ledger|me\/payout-account|me\/rent-mandate)/.test(c));
    expect(leaked, `a signed-out visitor asked the rent API for: ${leaked.join(' | ')}`).toEqual([]);

    // Signed in, the same page is served by the API rather than localStorage.
    await signedInAs(page, OWNER.mobile);
    const calls = [];
    watchApiCalls(page, calls);
    await page.goto('/pay-rent');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    await expect
      .poll(() => calls.filter((c) => / GET \/api\/me\/tenancies$/.test(c)),
        { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .not.toEqual([]);
    // The owner's payout settings and the tenant's history come from the API too, not the store.
    expect(calls.filter((c) => /GET \/api\/me\/payout-account$/.test(c)).length).toBeGreaterThan(0);
    expect(calls.filter((c) => /GET \/api\/me\/rent-payments/.test(c)).length).toBeGreaterThan(0);
  });

  test('the owner Finances tab reads summary, cashflow and dues from the server, not from the page it holds', async ({ page }) => {
    /* These three were client-side reductions over the transaction list. The ledger is **paged**, so
       reducing over what the client had downloaded produced a summary of page one wearing the label
       of a summary — right until an owner had more than one page of transactions.

       Asserting all three endpoints are actually called is what makes the move real: keeping the
       local reductions and never noticing would look identical on screen. */
    await signedInAs(page, OWNER.mobile);
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto('/dashboard#finances');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    /* A user who both owns and rents gets a context toggle, and it opens on whichever side the
       dashboard thinks they are. The owner ledger lives behind "My properties" — without this the
       test measures the Rent Wallet and reports that the finance endpoints were never called. */
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

    // One read per endpoint per property, not one per card or per render.
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
    /* The three feeds are **public** — the whole point of the page is that someone can browse before
       they have an account. That makes this the mirror image of the rent test above: there, calling
       an endpoint signed-out was the defect; here, NOT calling it is.

       The board also has to actually have something on it. Before this slice the page merged a
       hard-coded demo seed in the view, so switching the domain on would have left a page that
       loaded, rendered its tabs, called the API — and showed nothing. Every assertion about
       provenance would still have passed. */
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

    // The tab counts are rendered from the fetched rows, so a non-zero count is the cheapest proof
    // that the payload arrived and mapped — not merely that the request was made.
    await expect(moveIn).toHaveAttribute('aria-label', /\d+ homes/);
    const label = await moveIn.getAttribute('aria-label');
    expect(Number(label.match(/(\d+) homes/)[1]), `the move-in tab is empty: ${label}`).toBeGreaterThan(0);
  });

  test('a room posted through the API reaches the public board once it is moderated', async ({ page, request }) => {
    /* A write that returns 201 and is never seen again is the failure this whole slice exists to
       catch, and it is invisible to any test that only asserts the response status. The room is
       created through the page's own service so the mapper runs in both directions.

       `budget` is the field under test as much as the round trip is: the seam briefly renamed it to
       `rent`, which returned a perfectly good 201 and then rendered ₹0 on every card.

       **The round trip goes through moderation, because that is the actual contract.** This test
       used to assert that a freshly posted room was immediately public, and it had been wrong since
       V41 (D72), which made every room, post and group start at `mod_status='pending'` — "visible to
       its author, to nobody else". Reading the room back straight after the write therefore found
       nothing, and the failure read as a broken mapper rather than as a test asserting a rule the
       product had deliberately reversed.

       Asserting the absence *first* is what keeps this a round-trip test rather than a weaker one:
       it pins the gate (a pending room really is invisible, so `approved` is doing the work) and
       then pins the mapping (`budget` survives, `publiclyVisible` flips) on the same row. */
    await signedInAs(page, OWNER.mobile);
    const marker = `live probe ${Date.now()}`;
    const created = await page.evaluate(async (note) => {
      const svc = await import('/src/services/flatmateService.js');
      const room = await svc.createRoom({
        locality: 'Baner',
        rent: 14000,
        bhk: '2',
        // `roomType` is @NotBlank and the vocabulary is `Private room` / `Shared room` — the
        // human-readable strings, not slugs. Omitting it answers 422, not a default.
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

    // Read it back through the public feed, which is a different endpoint and a different mapper path.
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

    /* Approved over the API rather than through the admin screen: the moderation UI has its own
       coverage, and driving it here would put three unrelated screens between this test and the
       thing it is about. `authHeaders` also keeps the page signed in as the owner, so the read
       below is still made by an ordinary consumer session. */
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
    /* The three feed endpoints now filter on every facet in the database (D116) — `gender=female`
       returns only female-or-`any` rooms, not everyone. This test guards the two properties that a
       server-side facet must hold: a real value narrows to matching rows (with the `any` wildcard
       for preference facets), and an out-of-vocabulary value is *dropped* rather than passed through.

       Asserted as "every row that came back matches", not "fewer rows came back": a facet that does
       nothing returns the SAME count, so a count comparison cannot go red. */
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
    // An out-of-vocabulary value must be dropped by `vocab()`, not sent — otherwise one casing slip
    // reaches the server and empties the page, looking like "there is nothing in Pune".
    expect(result.nonsenseTotal, 'an unknown gender value narrowed the board instead of being ignored').toBe(result.total);
  });
});

/**
 * LIVE: service requests — the consumer's own view of a concierge service the ops desk delivers.
 *
 * The largest and most divergent slice. The mock (`lib/serviceFlow.js`) models the whole two-sided
 * flow — multipart draft/final uploads, a per-request document checklist, co-fill invites, unread
 * receipts, staff transitions — and the customer API carries only the honest subset a signed-in
 * requester can actually reach: **list / get / create / message / decide-draft**. Everything the
 * server has no customer-facing endpoint for stays mock-only and is documented in
 * `docs/system/frontend-data-seam.md`; this suite asserts the wired subset and proves the mock
 * store is not the source of truth in http mode.
 *
 * The write path is driven through the page's own service (dynamic `import`), the same technique the
 * flatmate slice uses — the three landing forms fill through i18n placeholders, which are the wrong
 * thing to couple a provenance test to. The parity harness (`scripts/serviceRequest-parity.mjs`)
 * pins the provider outputs directly; this closes the blind spot the harness cannot see — a React
 * call site that never awaits, or the mock leaking back in for a signed-in requester.
 */
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

    // Snapshot the mock's per-user store before the visit. In http mode nothing should write to it;
    // if the domain gate failed and the mock provider ran, `load`/`create` would touch this key.
    const before = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.toLowerCase().includes('servicereq'));
      return k ? localStorage.getItem(k) : null;
    });

    const listed = page.waitForResponse(
      (r) => /\/api\/service-requests(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.status() === 200,
      { timeout: 20000 },
    );
    // `/services/interior-renovation`, not `/services/interior` — the shorter path is the *type*
    // filter, not the route, and App.jsx has no entry for it. Guessed wrong it renders the 404 page,
    // which mounts no tracker, issues no read, and fails here as "the endpoint was never called".
    await page.goto('/services/interior-renovation');

    // A PageEnvelope, unwrapped by the provider — a shape change here empties the tracker silently.
    const body = await (await listed).json();
    expect(body).toHaveProperty('content');
    expect(Array.isArray(body.content)).toBe(true);

    // The tracker rendered from that fetch, not from a mock write: the store is unchanged by the
    // visit (still absent, or still whatever a prior mock-mode run left — never freshly written).
    const after = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.toLowerCase().includes('servicereq'));
      return k ? localStorage.getItem(k) : null;
    });
    expect(after).toBe(before);
  });

  test('a request created through the service round-trips and carries no mock-only fields', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);
    await page.goto('/services/property-valuation');
    // Named, not `getByRole('heading').first()`: the 404 page has a heading too, so the loose
    // version stayed green on a route that does not exist and left the rest of this test running
    // against nothing — which is how the wrong path survived here in the first place.
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
    // Every request opens `new` server-side, which the mapper shows as `submitted`.
    expect(created.status).toBe('submitted');
    expect(created.type).toBe('valuation');
    // A human-readable service label is derived, never echoed from the wire.
    expect(created.service).toBe('Property Valuation');
    // D119: `details` round-trips. The structured fields the form sent are stored as jsonb and read
    // back on the DTO — no longer flattened to a write-only string.
    expect(created.details).toMatchObject({ property: 'Aundh, Pune', size: '2 BHK', note: marker });
    // A fresh request has no shared draft, no final document, and an empty checklist — the multipart
    // surfaces that would fill these are mock-only.
    expect(created.draft).toBeNull();
    expect(created.finalDoc).toBeNull();
    expect(created.docs).toEqual([]);

    // Post a message and read it back through get — the one reply path the customer actually has.
    const threaded = await page.evaluate(async (id) => {
      const svc = await import('/src/services/serviceRequestService.js');
      await svc.addServiceRequestMessage(id, 'Following up from the live suite.');
      const r = await svc.getServiceRequest(id);
      return r ? { count: r.messages.length, last: r.messages[r.messages.length - 1] } : null;
    }, created.id);

    expect(threaded, `the created request could not be read back (id ${created.id})`).not.toBeNull();
    expect(threaded.count).toBeGreaterThan(0);
    expect(threaded.last.text).toContain('Following up');
    // A customer-authored message maps to the `user` side; only staff/admin roles become `staff`.
    expect(threaded.last.from).toBe('user');
  });

  test('the co-fill party list has no endpoint and returns empty rather than guessing', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);
    await page.goto('/services/interior');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });

    // Co-fill invites are a mock-only flow; the http provider returns [] rather than inventing a
    // call the server cannot answer — the tracker spreads this into its merge, so it may not be
    // undefined.
    const party = await page.evaluate(async () => {
      const svc = await import('/src/services/serviceRequestService.js');
      return svc.listPartyServiceRequests();
    });
    expect(party).toEqual([]);
  });
});

/**
 * LIVE: the opt-in identity (Aadhaar) badge.
 *
 * The badge is a trust signal, never a gate (ADR-019), so the failure here is the quiet kind. A
 * seeded account carries `users.aadhaar_verified = true` for the contact gate — but that boolean is
 * NOT what the badge endpoint reads. The badge lives in its own `identity_verifications` row, which
 * no seed writes, so a seeded account must read the badge as honestly *absent*. And a `start` must
 * hand back a pending DigiLocker consent handle, never a granted badge: only the signed webhook
 * grants, and nothing the browser does can make that happen.
 *
 * Everything is driven through `verificationService.js`. With `verification` in VITE_API_DOMAINS the
 * service dispatches to the http provider, so a service call *is* the wire, and the response sink
 * proves the browser really asked the server rather than a mock answering locally.
 */
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

  test('the badge is read from GET /me/verification/aadhaar and the seeded contact-gate flag does not grant it', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);
    await page.goto('/dashboard');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const status = await page.evaluate(async () => {
      const svc = await import('/src/services/verificationService.js');
      return svc.getAadhaarStatus();
    });

    // Provenance: the caller's badge came off the wire, not a mock answering from localStorage.
    expect(
      apiCalls.some((c) => /GET \/api\/me\/verification\/aadhaar$/.test(c)),
      `saw: ${apiCalls.join(', ')}`,
    ).toBe(true);
    // The load-bearing assertion: `users.aadhaar_verified` may be seeded true for the contact gate,
    // but the badge has its own unseeded row, so the badge itself is never granted here. (Kept as
    // `verified:false` rather than `status:'none'` so a re-run — which leaves a pending row on this
    // account — still holds; the strict none→pending transition is pinned by the parity harness.)
    expect(status.verified).toBe(false);
    // Never on the wire; carried as '' so mock and live answer the context with the same keys.
    expect(status.aadhaarMobile).toBe('');
  });

  test('starting DigiLocker returns a pending consent handle, not a granted badge', async ({ page }) => {
    await signedInAs(page, CHATTER.mobile);
    await page.goto('/dashboard');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const { handle, after } = await page.evaluate(async () => {
      const svc = await import('/src/services/verificationService.js');
      const started = await svc.startAadhaar({ source: 'digilocker' });
      const next = await svc.getAadhaarStatus();
      return { handle: started, after: next };
    });

    // A 202 is a consent url, not a badge: pending and unverified, carrying the `ref` the webhook
    // correlates on and the hosted url the modal would redirect the browser to.
    expect(handle.pending).toBe(true);
    expect(handle.verified).toBe(false);
    expect(handle.ref).toBeTruthy();
    expect(handle.verificationUrl).toBeTruthy();
    // The growth perk is mock-only; the live handle never fabricates one.
    expect(handle.perk).toBeNull();
    // The write is durable server-side: the very next read reports the pending state. `start` always
    // (re)sets the row to pending, so this holds on a re-run too.
    expect(after.status).toBe('pending');
    expect(after.verified).toBe(false);

    // The POST really reached the wire, not a mock grant in localStorage.
    expect(
      apiCalls.some((c) => /POST \/api\/me\/verification\/aadhaar$/.test(c)),
      `saw: ${apiCalls.join(', ')}`,
    ).toBe(true);
  });

  test('the dev-only simulate endpoint finishes the badge where no real webhook lands (D122)', async ({ page }) => {
    /* A throwaway account, not `CHATTER`.
     *
     * This is the one test in the block that *writes*, and the write is durable and irreversible:
     * `VerificationService` sets `users.verified` and then back-fills the badge onto every listing
     * the account holds. Run against a seeded actor it does not merely dirty a row — it silently
     * republishes their listings as owner-verified for the rest of the run.
     *
     * It did. `CHATTER` is Omkar Kulkarni, who owns `p5007`, which is the anchor
     * `platform/auth/live-verify-payoff.spec.js` uses as its *unverified* owner. That spec passed
     * alone and failed in the full suite, which is the worst shape a failure can have. The rule was
     * already written down — see `signedInAsNew` in `helpers/liveAuth.js`, which says a spec that
     * flips a seeded actor's state is breaking the next spec's premise rather than testing a
     * transition. This test is that spec, and now obeys it.
     *
     * Using a fresh account also drops the ordering constraint this test used to carry: it no
     * longer has to run after the two read tests to leave their premise intact, because it no
     * longer touches the account they read.
     */
    await signedInAsNew(page);
    await page.goto('/dashboard');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const { simulate, after } = await page.evaluate(async () => {
      // The dev affordance is a backend tool, not a service method, so it is called on the raw wire
      // with the session token `services/http.js` would otherwise attach.
      const tokens = JSON.parse(localStorage.getItem('puneNestTokens') || sessionStorage.getItem('puneNestTokens') || 'null');
      const res = await fetch('/api/me/verification/aadhaar/simulate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      const body = await res.json();
      const svc = await import('/src/services/verificationService.js');
      const next = await svc.getAadhaarStatus();
      return { simulate: { code: res.status, body }, after: next };
    });

    // The endpoint grants the badge the signed webhook otherwise would — a 200 carrying a verified row.
    expect(simulate.code).toBe(200);
    expect(simulate.body.badge).toBe(true);
    expect(simulate.body.status).toBe('verified');
    // And it is durable: the very next honest read off GET /me/verification/aadhaar reports the badge,
    // so the earned-badge state is now demonstrable in http/dev mode (the whole point of D122).
    expect(after.verified).toBe(true);

    expect(
      apiCalls.some((c) => /POST \/api\/me\/verification\/aadhaar\/simulate$/.test(c)),
      `saw: ${apiCalls.join(', ')}`,
    ).toBe(true);
  });
});

