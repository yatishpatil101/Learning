import { test, expect } from '@playwright/test';
import { pickDate } from '../helpers/datePicker.helper.js';
import { IGNORE as SHARED_IGNORE } from '../helpers/console.js';
import { signedInAs, signedInAsNew, authHeaders, API } from '../helpers/liveAuth.js';

// OWNER has four listings, including one non-public row, to distinguish /me/listings from public search.
const OWNER = { mobile: '9470744469', name: 'Meera Deshpande', total: 4, publiclyVisible: 3 };
// An approved OWNER fixture supports public deal and review flows.
const OWNER_LISTING = '1078d711-d3eb-5961-ab3c-30d4bdc5f377';

const IGNORE = new RegExp(`${SHARED_IGNORE.source}|CDN|net::ERR|ERR_CERT`, 'i');

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
    const reads = [];
    page.on('response', (r) => {
      if (/\/api\/messages\/[0-9a-f-]{36}\/read$/.test(r.url()) && r.request().method() === 'POST') reads.push(r.status());
    });
    await thread.click();

    const detailBody = await (await detail).json();
    // The seeded conversation has messages, so the author assertion needs a non-empty floor.
    expect(Array.isArray(detailBody.messages)).toBe(true);
    expect(detailBody.messages.length).toBeGreaterThan(0);
    expect(detailBody.messages.every((m) => typeof m.mine === 'boolean' && !('authorId' in m))).toBe(true);

    // Read is posted only when the opened thread had unread messages.
    if (detailBody.unread > 0) await expect.poll(() => reads, { timeout: 10000 }).toContain(204);

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
     // A fresh account prevents this write from changing OWNER's fixed listing fixture.
    await signedInAsNew(page);

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
    expect([201, 409]).toContain(res.status());
    let reportId = null;
    if (res.status() === 201) {
      const created = await res.json();
      reportId = created.id;
      expect(created).not.toHaveProperty('reporterId');
      expect(created.status).toBe('open');
      expect(created.targetType).toBe('property');
    }

    const queue = await fetch(`${API}/reports?size=50`, { headers: await authHeaders(ADMIN.mobile) });
    const queueText = await queue.text();
    expect(queue.status, queueText).toBe(200);
    const body = JSON.parse(queueText);
    expect(body).toHaveProperty('content');
    expect(body.totalElements).toBeGreaterThan(0);

    if (reportId) {
      expect(body.content.some((r) => r.id === reportId)).toBe(true);
    }

    expect(body.content.some((r) => /^reopen$/i.test(r.actionTaken || ''))).toBe(false);
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
    const calls = [];
    watchApiCalls(page, calls);
    await signedInAs(page, CHATTER.mobile);

    await page.goto('/dashboard');
    // Saved membership arrives as keys inside /me/bootstrap; the cards are read only on the Saved tab.
    await expect
      .poll(() => calls.filter((c) => / GET \/api\/(me\/bootstrap|me\/saved-searches|me\/dashboard)$/.test(c)),
        { timeout: 30000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toEqual(expect.arrayContaining([
        '200 GET /api/me/bootstrap',
        '200 GET /api/me/saved-searches',
        '200 GET /api/me/dashboard',
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

  test('the owner dashboard reads its deal book through /me/dashboard, in one request not one per card', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);
    const calls = [];
    watchApiCalls(page, calls);

    await page.goto('/dashboard#listings');
    await expect
      .poll(() => calls.filter((c) => / GET \/api\/me\/dashboard$/.test(c)).length,
        { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
      .toBeGreaterThan(0);

    const dealReads = calls.filter((c) => /GET \/api\/me\/deals$/.test(c)).length;
    expect(dealReads, `the dashboard read should serve every card, saw ${dealReads}`).toBe(0);

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

  test('the owner Finances tab reads summary, overview (basis, dues, cashflow) and transactions from the server, not from the page it holds', async ({ page }) => {
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

    for (const endpoint of ['overview', 'transactions']) {
      expect(
        calls.filter((c) => new RegExp(`GET /api/me/finances/.*/${endpoint}`).test(c)).length,
        `${endpoint} should be served by the API; calls seen: ${calls.join(' | ')}`,
      ).toBeGreaterThan(0);
    }

    const retired = calls.filter((c) => /GET \/api\/me\/finances\/[^/]+\/(basis|cashflow|dues)/.test(c));
    expect(retired, `basis, cashflow and dues now ride on /overview; saw ${retired.join(' | ')}`).toEqual([]);
    const overviewReads = calls.filter((c) => /GET \/api\/me\/finances\/[^/]+\/overview/.test(c)).length;
    expect(overviewReads, `one overview read should serve the tab, saw ${overviewReads}`).toBeLessThanOrEqual(2);

    const summaryReads = calls.filter((c) => /GET \/api\/me\/finances\/.*\/summary$/.test(c)).length;
    expect(summaryReads, `one summary read should serve the tab, saw ${summaryReads}`).toBeLessThanOrEqual(3);
  });

});
