import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Flatmates board — the interaction surfaces, driven through the browser against the real server.
 *
 * `live-interactions.spec.js` already owns the contract half of this slice: the three interest
 * doors, the duplicate 409, the shared budget, the outbox and withdrawal. It never opens a page.
 * This file is the other half — the board itself — and it exists because `interactions.spec.js`
 * asserted all of it against `localStorage`.
 *
 * That mattered more than usual here. The mock's own header lists the bugs it was written to
 * catch, and two of them are precisely the kind a store-backed test cannot see:
 *
 *   * "own post was leaking into the grid via a broken reference-equality filter" — a filter that
 *     compares the seeker's post to the feed's rows. Against the mock both sides are the same
 *     object, so reference equality WORKS and the test is green on a filter that fails the moment
 *     the two sides arrive from different places, which is exactly what the live feed does;
 *   * "room interest used to call the flatmate handler with the wrong argument shape and silently
 *     no-op" — the mock asserted only that the button flipped to "Interest sent". A button flip is
 *     client state. It flips just as happily when nothing was written, which is the definition of
 *     the bug it was supposed to be guarding.
 *
 * So the two tests below that cover those bugs assert the server, not the flip: the ask has to
 * appear in the seeker's outbox, and the seeker's own post has to be absent from a grid that is
 * demonstrably showing other people's.
 *
 * ## Sign-in order is load-bearing
 *
 * Every test here that needs both a browser session and an API token opens the API one FIRST and
 * signs the browser in LAST. The last login wins for `/auth/me`, so a browser that signed in
 * first is left holding a token that still works for resource fetches while `AuthContext` has no
 * user — the page renders, signed-out, and the failure reads like missing data. Resource tokens
 * from the earlier `apiLogin` keep working, which is why this order costs nothing.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const track = flatmateCleanup(test);

let adminToken;
async function approve(id) {
  adminToken ??= (await apiLogin(ACTORS.admin)).accessToken;
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(adminToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status).toBeLessThan(300);
}

/* An account that exists on the server before the browser ever sees it. */
async function newSeeker() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

async function seedRoom(hostToken, over = {}) {
  const res = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(hostToken),
    body: JSON.stringify({
      roomType: 'Private room',
      locality: 'Baner',
      rentShare: 18000,
      bhk: '2',
      attachedBath: 'attached',
      furnishing: 'semi',
      hostRole: 'tenant',
      photos: ['https://example.test/room.jpg'],
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  const room = await res.json();
  track('rooms', room.id, hostToken);
  await approve(room.id);
  return room;
}

async function seedPost(token, over = {}) {
  const res = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      name: 'Own Post Tester',
      gender: 'female',
      age: 26,
      occupation: 'Software Engineer',
      budget: 16000,
      localities: ['Baner'],
      moveIn: '2026-12-01',
      flatPref: 'women',
      roomPref: 'private',
      tags: ['Vegetarian'],
      note: 'Looking for a place to stay',
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  const post = await res.json();
  track('posts', post.id, token);
  await approve(post.id);
  return post;
}

async function seedGroup(hostToken, over = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(hostToken),
    body: JSON.stringify({
      title: `Group ${uniqueMobile()}`,
      name: 'Asha K',
      locality: 'Baner',
      rent: 30000,
      seats: 3,
      seatsOpen: 2,
      policy: 'any',
      role: 'tenant',
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  const group = await res.json();
  track('groups', group.id, hostToken);
  await approve(group.id);
  return group;
}

/* The seeker's own outbox — the end of the interest row that answers "did my ask land?". */async function myAsks(token) {
  const res = await fetch(`${API}/me/flatmate-interests`, { headers: auth(token) });
  expect(res.status).toBe(200);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.content ?? []);
}

test.describe('Flatmates board', () => {
  test('a seeker\'s own live request is announced as theirs, not offered back as a card', async ({ page }) => {
    const { mobile, accessToken } = await newSeeker();
    const NAME = `Own ${mobile.slice(-6)}`;
    await seedPost(accessToken, { name: NAME });

    await signedInAs(page, mobile);
    await page.goto(`${BASE}/flatmates?view=flatmates`);

    /* The positive anchor, and the whole reason this test is worth running live. The claim is an
       absence — "my card is not in the grid" — and an absence is satisfied by an empty grid, a
       failed fetch, or a board that renders nothing at all. Requiring OTHER people's cards first
       means the filter is being asked to distinguish, which is the thing that broke: the original
       bug was a reference-equality check between the seeker's post and the feed's rows, and
       against a mock those are the same object. */
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('Your live request')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.sf-card', { hasText: NAME })).toHaveCount(0);
  });

  test('"Message owner" writes the ask to the server, not just to the button', async ({ page }) => {
    const host = await newSeeker();
    const room = await seedRoom(host.accessToken);
    const seeker = await newSeeker();

    expect(await myAsks(seeker.accessToken)).toHaveLength(0);

    await signedInAs(page, seeker.mobile);
    /* Deep-linked to the seeded room rather than clicking the first card on the board: the feed is
       shared with every other spec in this lane, so "the first room" is whoever posted last. */
    await page.goto(`${BASE}/flatmates?view=rooms&focus=${room.id}`);

    const card = page.locator('.sf-card').filter({ hasText: 'Baner' }).first();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    const msgBtn = card.getByRole('button', { name: /Message owner/i });
    await msgBtn.click();

    await expect(card.getByRole('button', { name: /Interest sent/i })).toBeVisible({ timeout: 10000 });

    /* The assertion the mock could not make. "Interest sent" is client state and flips whether or
       not anything was written — the no-op bug this test's ancestor was written for did exactly
       that. Poll because the click's request is in flight. */
    await expect
      .poll(async () => (await myAsks(seeker.accessToken)).length, { timeout: 10000 })
      .toBeGreaterThan(0);
  });

  test('reporting a room reaches the server, and the seeker is told so', async ({ page }) => {
    const host = await newSeeker();
    await seedRoom(host.accessToken);
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=rooms`);

    const flag = page.locator('.report-btn').first();
    await flag.waitFor({ state: 'visible', timeout: 15000 });
    await flag.click();

    await expect(page.getByRole('dialog', { name: /Report this post/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Spam or duplicate post/i }).click();

    /* Armed before the click that causes it. The confirmation toast is drawn from client state, so
       asserting only the toast would pass against a report that 500'd — the same shape of hole as
       the "Interest sent" flip above. */
    const posted = page.waitForResponse((r) => r.url().includes('/reports') && r.request().method() === 'POST', { timeout: 15000 });
    await page.getByRole('button', { name: /Submit report/i }).click();
    expect((await posted).status()).toBe(201);

    await expect(page.getByText(/our team will review this post/i)).toBeVisible({ timeout: 10000 });
  });

  test('reporting a group files against that group, under the wire\'s word for a share', async ({ page }) => {
    const host = await newSeeker();
    const TITLE = `Reportable ${uniqueMobile().slice(-6)}`;
    const group = await seedGroup(host.accessToken, { title: TITLE });
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=groups`);

    /* Scoped to the seeded group's own card, not `.report-btn` first. The feed is shared with
       every other spec in this lane, so "the first card" is whoever posted last — and this test's
       whole point is that the id on the wire is the id of the thing that was flagged. */
    const card = page.locator('.sf-card').filter({ hasText: TITLE }).first();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await card.locator('.report-btn').first().click();

    await expect(page.getByRole('dialog', { name: /Report this post/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Inappropriate or offensive content/i }).click();

    const posted = page.waitForResponse((r) => r.url().includes('/reports') && r.request().method() === 'POST', { timeout: 15000 });
    await page.getByRole('button', { name: /Submit report/i }).click();
    const res = await posted;
    expect(res.status()).toBe(201);

    /* Reading the body, because the toast is client state and would look identical over a report
       filed against the wrong row. This is the fourth field in this wave whose client word and
       wire word differ: the page says `kind: 'share'` and the wire wants `targetType: 'post'`,
       with `toTargetType` in between — and a flatmate group, room and seeker post all collapse
       onto that one wire value. The mapper's own docblock records the bug where `Flatmates.jsx`
       passed `kind: 'user'`, which the server would have 400'd on every flatmate report while the
       mock stored it happily. So `targetType` is asserted for the translation and `targetId` for
       the identity; together they are what a mock-backed test structurally cannot check. */
    const body = res.request().postDataJSON();
    expect(body.targetType).toBe('post');
    expect(String(body.targetId)).toBe(String(group.id));

    await expect(page.getByText(/our team will review this post/i)).toBeVisible({ timeout: 10000 });
  });

  test('a live request earns match pills against the real feed', async ({ page }) => {
    const { mobile, accessToken } = await newSeeker();

    await signedInAs(page, mobile);
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    /* The negative half. Match tiers are scored against the reader's own request, so with no
       request on file there is nothing to score and no pill can be honest. Without this the test
       cannot tell "the pill appeared because I posted" from "the pill is always there". */
    await expect(page.locator('.sf-match')).toHaveCount(0);

    // Budget and locality chosen to overlap the seeded Baner seekers, so the band model scores.
    await seedPost(accessToken, { budget: 16000, localities: ['Baner'] });
    await page.reload();

    await expect(page.getByText('Your live request')).toBeVisible({ timeout: 15000 });
    const pill = page.locator('.sf-match').first();
    await expect(pill).toBeVisible({ timeout: 10000 });
    await expect(pill).toContainText(/match/i);
  });

  test('the sort pill reorders the real feed, low to high', async ({ page }) => {
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=rooms`);
    await page.locator('.sf-card').first().waitFor({ timeout: 15000 });

    const sortPill = page.getByRole('button', { name: 'Sort posts' });
    await sortPill.click();
    await page.getByRole('option', { name: 'Budget: Low to High' }).click();
    await expect(sortPill).toContainText('Budget: Low to High');

    const prices = await page.locator('.sf-card .gradient-text').allInnerTexts();
    const nums = prices.map((t) => parseInt(t.replace(/[^0-9]/g, ''), 10)).filter((n) => !Number.isNaN(n));
    /* Two is the minimum that can be out of order. With one row, or none, `toEqual(sorted)` is
       true of any sort implementation including none at all. */
    expect(nums.length).toBeGreaterThan(1);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  test('the empty state offers a way out, and the way out works', async ({ page }) => {
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    await page.getByPlaceholder(/Try: girl in baner/i).fill('zzznotarealmatch');
    await expect(page.locator('.sf-card')).toHaveCount(0);

    await expect(page.getByRole('button', { name: /^Post$/ }).first()).toBeVisible();
    const clear = page.getByRole('button', { name: /Clear filters/i });
    await expect(clear).toBeVisible();
    await clear.click();

    // Clearing is the half that can silently rot: an empty state that cannot be escaped is a
    // dead end, and only the round trip back to a populated grid proves it is not one.
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 10000 });
  });

  test('a returning poster is routed into their live request, not into a second one', async ({ page }) => {
    const { mobile, accessToken } = await newSeeker();
    await seedPost(accessToken, { budget: 16000 });

    await signedInAs(page, mobile);
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.getByText('Your live request')).toBeVisible({ timeout: 15000 });

    const before = (await fetch(`${API}/me/flatmate-posts?page=0&size=100`, { headers: auth(accessToken) }).then((r) => r.json())).content.length;

    /* The guard lives in `openPostModal()`, which the chooser only reaches on its "still looking
       → just me" branch. The Post button alone does not go through it, and neither does the
       `?post=1` deep link — that one fires from a mount effect, before `myPost` has come back
       from the server, so `myPost` is still null and the guard cannot see it. Walking the chooser
       is therefore not incidental: it is the one path where the guard has the data it needs. */
    await page.getByRole('button', { name: /^Post$/ }).first().click();
    const chooser = page.locator('.sf-modal');
    await chooser.getByRole('button', { name: /I'm still looking for a place/i }).click();
    await chooser.getByRole('button', { name: /Just me/i }).click();

    await expect(page.getByText(/already have a live request/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Update request/i })).toBeVisible();
    // Opened ON the existing request, not on a blank form that merely refuses to submit.
    await expect(page.locator('input[placeholder="₹ e.g. 15000"]')).toHaveValue('16000');

    // And the guard did not quietly create the duplicate it was warning about.
    const after = (await fetch(`${API}/me/flatmate-posts?page=0&size=100`, { headers: auth(accessToken) }).then((r) => r.json())).content.length;
    expect(after).toBe(before);
  });

  test('on a phone the filters collapse behind a drawer, and the drawer still sorts', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=rooms`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    const openBtn = page.getByRole('button', { name: 'Open filters' });
    await expect(openBtn).toBeVisible();
    await expect(page.locator('.filter-panel')).not.toHaveClass(/open/);

    await openBtn.click();
    await expect(page.locator('.filter-panel')).toHaveClass(/open/);

    const sortPill = page.getByRole('button', { name: 'Sort posts' });
    await sortPill.click();
    await page.getByRole('option', { name: 'Budget: Low to High' }).click();
    await expect(sortPill).toContainText('Budget: Low to High');

    await page.getByRole('button', { name: 'Show results' }).click();
    await expect(page.locator('.filter-panel')).not.toHaveClass(/open/);
  });
});
