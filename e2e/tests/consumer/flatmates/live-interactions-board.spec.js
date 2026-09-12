import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { postAsSolo } from '../../../helpers/app.js';

/** Live board coverage verifies persisted interest actions and hides the seeker's own post. */

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

async function myAsks(token) {
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

    // Another card anchors the own-card absence assertion against an empty or failed feed.
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('Your live request')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.sf-card', { hasText: NAME })).toHaveCount(0);
  });

  test('"Message owner" writes the ask to the server, not just to the button', async ({ page }) => {
    const host = await newSeeker();
    // Use a unique rendered rent because shared-locality `.first()` locators drift as the feed grows.
    await seedRoom(host.accessToken, { rentShare: 18777 });
    const seeker = await newSeeker();

    expect(await myAsks(seeker.accessToken)).toHaveLength(0);

    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=rooms`);

    const card = page.locator('.sf-card').filter({ hasText: '18,777' }).first();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    const msgBtn = card.getByRole('button', { name: /Message owner/i });
    await msgBtn.click();

    await expect(card.getByRole('button', { name: /Interest sent/i })).toBeVisible({ timeout: 10000 });

    // Poll the server outbox because the button state can update before the request persists.
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

    // Arm the response wait first because the confirmation toast is browser state.
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

    // Scope to the seeded card because the shared feed makes the first report button nondeterministic.
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

    // The initial absence ensures the later pill comes from this seeker's request.
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
    // Two values are required for an ordering assertion to distinguish a no-op sort.
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

    // A populated grid confirms this empty state is escapable rather than a dead end.
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 10000 });
  });

  test('a returning poster is routed into their live request, not into a second one', async ({ page }) => {
    const { mobile, accessToken } = await newSeeker();
    await seedPost(accessToken, { budget: 16000 });

    await signedInAs(page, mobile);
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.getByText('Your live request')).toBeVisible({ timeout: 15000 });

    const before = (await fetch(`${API}/me/flatmate-posts?page=0&size=100`, { headers: auth(accessToken) }).then((r) => r.json())).content.length;

    // The guard runs only on this chooser branch, not when the sheet first opens.
    await postAsSolo(page);

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

  // Guests expose cookie-banner overlap with the fixed filter control.
  test('on a phone the Filters trigger is a bottom-left capsule a guest can actually reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    const fab = page.getByRole('button', { name: 'Open filters' });
    await expect(fab).toBeVisible();

    // Left half of the screen: the Draaz FAB owns the bottom-right corner and intercepted taps
    // on this pill when it sat there. A pill that merely *exists* bottom-right still fails a user.
    const box = await fab.boundingBox();
    expect(box.x + box.width).toBeLessThan(195);
    // Above the floating bottom nav, not behind it.
    expect(box.y + box.height).toBeLessThan(844);

    /* The one assertion a bounding box cannot make: `toBeVisible()` and a box are both satisfied
       by a control with something painted over it. Playwright's actionability check is not — it
       refuses a click the banner would receive instead, which is the guest bug stated as a tap. */
    await fab.click();
    await expect(page.locator('.filter-panel')).toHaveClass(/open/);
    await expect(fab).toHaveAttribute('aria-expanded', 'true');
  });

  /* Below 1024px the bottom bar's `+` is the whole posting story: the hero CTA was deleted and
     `.sf-post-cta` is hidden. The two rules are complements written in different languages -
     a `max-width: 1023px` media query in routes/flatmates.css and Tailwind's `lg:hidden` on the
     nav - so nothing but a count catches the day one of them moves and they overlap or gap. */
  test('a phone is offered exactly one posting control on the flatmates board', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByRole('button', { name: /^Post( Property)?$/ })).toHaveCount(1);
  });
});
