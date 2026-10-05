import { test, expect } from '@playwright/test';
import { IGNORE as SHARED_IGNORE } from '../helpers/console.js';
import { signedInAs, signedInAsNew, apiLogin, uniqueMobile, authHeaders, API } from '../helpers/liveAuth.js';

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

const ADMIN = { mobile: '9000000000' };

const CHATTER = { mobile: '9708919481', name: 'Omkar Kulkarni' };

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
    // Reruns reuse the report fixture and therefore may receive the expected conflict.
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

    for (const feed of ['feed']) {
      await expect
        .poll(() => calls.filter((c) => new RegExp(`GET /api/flatmates/${feed}`).test(c)).length,
          { timeout: 20000, message: `API calls seen: ${calls.join(' | ') || 'none'}` })
        .toBeGreaterThanOrEqual(2);
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
        hostRole: 'owner',
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
      const feed = await svc.feed('move-in', {}, 0, 200);
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
      const all = await svc.feed('move-in', {}, 0, 200);
      const women = await svc.feed('move-in', { gender: 'female' }, 0, 200);
      const nonsense = await svc.feed('move-in', { gender: 'Female' }, 0, 200);
      return {
        total: all.total,
        offenders: women.items.filter((r) => r.roomType && r.gender !== 'female' && r.gender !== 'any').map((r) => r.gender),
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
    // A fresh account prevents the irreversible simulation from changing seeded fixtures.
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
        const r = await svc.submitServiceRequestPartyDetails(id, {
          tenants: 'Live Co-fill Tenant',
          _state: { tenants: [{ name: 'Live Co-fill Tenant' }] },
        });
        return r ? r.details : null;
      }, created.id);
      expect(filled).toMatchObject({
        tenants: 'Live Co-fill Tenant',
        ownerName: 'Live Co-fill Owner',
        _state: { tenants: [{ name: 'Live Co-fill Tenant' }] },
      });
    } finally {
      await inviteeContext.close();
    }

    const asOwner = await page.evaluate(async (id) => {
      const svc = await import('/src/services/serviceRequestService.js');
      const r = await svc.getServiceRequest(id);
      return r ? { details: r.details, parties: r.parties } : null;
    }, created.id);
    expect(asOwner, 'the requester lost sight of their own request').not.toBeNull();
    expect(asOwner.details).toMatchObject({
      tenants: 'Live Co-fill Tenant',
      _state: { tenants: [{ name: 'Live Co-fill Tenant' }] },
    });
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
