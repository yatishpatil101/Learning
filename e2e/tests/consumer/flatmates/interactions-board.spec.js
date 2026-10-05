import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { postAsSolo } from '../../../helpers/app.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const POST_BUTTON = /^Post(?: Property| property — Free)?$/;
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
      ...(await tenantRoomAgreement(hostToken)),
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
      title: `Group ${Number(uniqueMobile()).toString(36)}`,
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
  test('a seeker\'s live request is announced as theirs, earns match pills, and routes a second post into an update', async ({ page }) => {
    test.slow();
    const { mobile, accessToken } = await newSeeker();
    const NAME = `Own ${mobile.slice(-6)}`;

    await signedInAs(page, mobile);
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.sf-match')).toHaveCount(0);

    // Budget and locality chosen to overlap the seeded Baner seekers, so the band model scores.
    await seedPost(accessToken, { name: NAME, budget: 16000, localities: ['Baner'] });
    await page.reload();

    await test.step('a seeker\'s own live request is announced as theirs, not offered back as a card', async () => {
      // Another card anchors the own-card absence assertion against an empty or failed feed.
      await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Your live request')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.sf-card', { hasText: NAME })).toHaveCount(0);
    });

    await test.step('a live request earns match pills against the real feed', async () => {
      const pill = page.locator('.sf-match').first();
      await expect(pill).toBeVisible({ timeout: 10000 });
      await expect(pill).toContainText(/your Baner, ₹16k request/);
    });

    await test.step('a returning poster is routed into their live request, not into a second one', async () => {
      const before = (await fetch(`${API}/me/flatmate-posts?page=0&size=100`, { headers: auth(accessToken) }).then((r) => r.json())).content.length;
      // The guard runs only on this chooser branch, not when the sheet first opens.
      await postAsSolo(page);

      await expect(page.getByText(/already have a live request/i)).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('button', { name: /Update request/i })).toBeVisible();
      await expect(page.getByLabel('Lowest monthly budget')).toHaveValue('16,000');
      // And the guard did not quietly create the duplicate it was warning about.
      const after = (await fetch(`${API}/me/flatmate-posts?page=0&size=100`, { headers: auth(accessToken) }).then((r) => r.json())).content.length;
      expect(after).toBe(before);
    });
  });
  test('reporting a room from its detail page reaches the server, and the seeker is told so', async ({ page }) => {
    const host = await newSeeker();
    const room = await seedRoom(host.accessToken);
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates/room/${room.id}`);

    const flag = page.locator('.report-btn');
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
    await card.getByRole('link', { name: TITLE }).click();
    await expect(page).toHaveURL(new RegExp(`/flatmates/group/${group.id}$`));
    await page.locator('.report-btn').click();

    await expect(page.getByRole('dialog', { name: /Report this post/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Inappropriate or offensive content/i }).click();

    const posted = page.waitForResponse((r) => r.url().includes('/reports') && r.request().method() === 'POST', { timeout: 15000 });
    await page.getByRole('button', { name: /Submit report/i }).click();
    const res = await posted;
    expect(res.status()).toBe(201);

    const body = res.request().postDataJSON();
    expect(body.targetType).toBe('post');
    expect(String(body.targetId)).toBe(String(group.id));

    await expect(page.getByText(/our team will review this post/i)).toBeVisible({ timeout: 10000 });
  });

  test('the sort pill reorders the real feed, low to high', async ({ page }) => {
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=rooms`);
    await page.locator('.sf-card').first().waitFor({ timeout: 15000 });

    const sortPill = page.getByRole('button', { name: 'Sort posts' });
    await sortPill.click();
    const sorted = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/flatmates/feed') && url.searchParams.get('sort') === 'budget-low';
    });
    await page.getByRole('option', { name: 'Budget: Low to High' }).click();
    expect((await sorted).status()).toBe(200);
    await expect(sortPill).toContainText('Budget: Low to High');

    await expect.poll(async () => {
      const prices = await page.locator('.sf-card').evaluateAll((cards) => cards
        .map((card) => card.querySelector('.sf-price')?.textContent || ''));
      const nums = prices.map((t) => parseInt(t.replace(/[^0-9]/g, ''), 10)).filter((n) => !Number.isNaN(n));
      return { nums, sorted: nums.length > 1 && nums.every((n, i) => i === 0 || nums[i - 1] <= n) };
    }).toMatchObject({ sorted: true });
  });

  test('the empty state offers a way out, and the way out works', async ({ page }) => {
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    await page.getByPlaceholder(/Try: girl in baner/i).fill('zzznotarealmatch');
    await expect(page.locator('.sf-card')).toHaveCount(0);

    await expect(page.getByRole('button', { name: POST_BUTTON }).first()).toBeVisible();
    const clear = page.getByRole('button', { name: /Clear filters/i });
    await expect(clear).toBeVisible();
    await clear.click();
    // A populated grid confirms this empty state is escapable rather than a dead end.
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 10000 });
  });

  test('on a phone the sort sits beside the count on both tabs, as on /listings, and not in the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const seeker = await newSeeker();
    await signedInAs(page, seeker.mobile);
    await page.goto(`${BASE}/flatmates?view=rooms`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    const sortPill = page.getByRole('button', { name: 'Sort posts' });
    const count = page.getByText(/homes? with a room available/);
    await expect(sortPill).toBeVisible();
    const [s, c] = [await sortPill.boundingBox(), await count.boundingBox()];
    expect(Math.abs((s.y + s.height / 2) - (c.y + c.height / 2)), 'one row: count left, sort right').toBeLessThan(12);
    expect(s.x).toBeGreaterThan(c.x);

    const sorted = page.waitForResponse((r) => r.url().includes('/flatmates/feed') && new URL(r.url()).searchParams.get('sort') === 'budget-low');
    await sortPill.click();
    await page.getByRole('option', { name: 'Budget: Low to High' }).click();
    expect((await sorted).status()).toBe(200);
    await expect(sortPill).toContainText('Budget: Low to High');

    await page.getByRole('button', { name: 'Open filters' }).click();
    await expect(page.locator('.filter-panel')).toHaveClass(/open/);
    await expect(page.locator('.filter-panel').getByRole('button', { name: 'Sort posts' })).toHaveCount(0);
    await page.getByTestId('filter-drawer-actions').getByRole('button', { name: /^Show\b/ }).click();
    await expect(page.locator('.filter-panel')).not.toHaveClass(/open/);

    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Sort posts' })).toBeVisible();
  });

  test('on a phone the Filters trigger is a bottom-left capsule a guest can actually reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    const fab = page.getByRole('button', { name: 'Open filters' });
    await expect(fab).toBeVisible();

    const box = await fab.boundingBox();
    expect(box.x + box.width).toBeLessThan(195);
    expect(box.y + box.height).toBeLessThan(844);

    await fab.click();
    await expect(page.locator('.filter-panel')).toHaveClass(/open/);
    await expect(fab).toHaveAttribute('aria-expanded', 'true');
  });

  test('a phone is offered exactly one posting control on the flatmates board', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/flatmates?view=flatmates`);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByRole('button', { name: POST_BUTTON })).toHaveCount(1);
  });
});
