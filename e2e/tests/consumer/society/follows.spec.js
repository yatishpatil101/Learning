import { test, expect } from '@playwright/test';

/**
 * Society follows, once they became an account fact rather than a browser fact (D227).
 *
 * Following used to live in `pnFollowedSocieties`, a localStorage array read synchronously by five
 * separate surfaces. Following on a laptop did not follow on a phone, and the follower count the
 * hub renders — which the server computes from `society_follows` — counted nobody, because nothing
 * ever wrote a row.
 *
 * These specs assert the *behaviour that survives the port*, so they hold identically against the
 * mock store and against Postgres: the five surfaces agree, and following on one shows on the rest.
 * That is deliberately not the same as asserting on a storage key, which is one build's detail and
 * was exactly the assertion that would have gone green while the phone showed nothing.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
// A mobile with no seeded listings, so the dashboard renders the seeker overview — `isOwner` is
// derived from inventory, not from the stored role, and the followed-societies tile is seeker-side.
const CONSUMER = '9000000034';

async function loginConsumer(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Follow Spec Seeker', mobile, role: 'seeker', loginAt: Date.now() }));
  }, CONSUMER);
}

/** A directory card, addressed by the society it is for. */
const cardFor = (page, name) => page.locator('.glass.rounded-2xl')
  .filter({ has: page.getByRole('link', { name, exact: true }) }).first();

/**
 * Follow the first society on the directory still offering to be followed, and return its name.
 *
 * The card is re-addressed by name before the click. "First card offering Follow" is a locator that
 * stops matching the moment the click lands, so holding onto it would silently assert against the
 * *next* card — which is still unfollowed, so the assertion fails for a reason that has nothing to
 * do with the code under test.
 */
async function followFirstUnfollowed(page) {
  const loose = page.locator('.glass.rounded-2xl')
    .filter({ has: page.getByRole('button', { name: 'Follow', exact: true }) }).first();
  await expect(loose).toBeVisible({ timeout: 10000 });
  const name = (await loose.getByRole('link').first().innerText()).trim();

  const card = cardFor(page, name);
  await card.getByRole('button', { name: 'Follow', exact: true }).click();
  // Optimistic: the badge flips without waiting for a reload, which is the whole point of holding
  // the set in a context rather than re-reading a store after every write.
  await expect(card.getByRole('button', { name: 'Following', exact: true })).toBeVisible({ timeout: 8000 });
  return name;
}

test('following a society on the directory shows on its hub and on the dashboard', async ({ page }) => {
  await loginConsumer(page);
  await page.goto(`${BASE}/societies`);

  const name = await followFirstUnfollowed(page);

  // Same fact, different surface. The hub asks per-society; the dashboard panel asks "which ones?".
  // Those are two different reads against the server and this is the spec that keeps them agreeing.
  await cardFor(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Following', exact: true }).first()).toBeVisible({ timeout: 8000 });

  await page.goto(`${BASE}/dashboard#alerts`);
  await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible({ timeout: 10000 });
});

test('unfollowing from the dashboard panel clears it everywhere', async ({ page }) => {
  await loginConsumer(page);
  await page.goto(`${BASE}/societies`);

  const name = await followFirstUnfollowed(page);

  await page.goto(`${BASE}/dashboard#alerts`);
  const unfollow = page.getByRole('button', { name: `Unfollow ${name}` });
  await expect(unfollow).toBeVisible({ timeout: 10000 });
  await unfollow.click();
  await expect(unfollow).toHaveCount(0, { timeout: 8000 });

  // Back on the directory the card must offer to follow again. This is the direction that matters:
  // a stale "Following" badge claims an alert the user will never get.
  await page.goto(`${BASE}/societies`);
  await expect(cardFor(page, name).getByRole('button', { name: 'Follow', exact: true }))
    .toBeVisible({ timeout: 10000 });
});

test('the dashboard follow tile counts what the panel lists', async ({ page }) => {
  await loginConsumer(page);
  await page.goto(`${BASE}/societies`);

  // Two different societies: the first is no longer "still offering Follow" once it is followed.
  const first = await followFirstUnfollowed(page);
  const second = await followFirstUnfollowed(page);
  expect(second).not.toBe(first);

  await page.goto(`${BASE}/dashboard`);
  // The tile used to be a render-body `getFollowedSocieties().length` — a different reader from the
  // panel's, which is how the two could disagree. Both now read one context.
  await expect(page.getByLabel('View followed societies')).toContainText('2', { timeout: 10000 });
});

test('a society this browser minted stays followed even though the server cannot know it', async ({ page }) => {
  await loginConsumer(page);
  await page.goto(`${BASE}/dashboard#alerts`);

  const finder = page.getByPlaceholder(/Search your society/i);
  await expect(finder).toBeVisible({ timeout: 10000 });
  const NAME = 'Follow Spec Nest 2031';
  await finder.fill(NAME);

  const addRow = page.getByRole('button', { name: /^Add /i });
  await expect(addRow).toBeVisible({ timeout: 8000 });
  await addRow.click();

  // The mint is local, so a live server 404s the follow — correctly, it will not write a dangling
  // foreign key. `FollowContext` keeps that follow in a browser-only set and retries it on every
  // load, so the user who just named their building stays subscribed and the follow lands by itself
  // the day ops promote the slug. Either way, this list must show it.
  await expect(page.getByRole('link', { name: NAME })).toBeVisible({ timeout: 10000 });

  await page.reload();
  await expect(page.getByRole('link', { name: NAME })).toBeVisible({ timeout: 10000 });
});

test('signing out empties the follow set rather than leaving the last user\u2019s', async ({ page }) => {
  await loginConsumer(page);
  await page.goto(`${BASE}/societies`);

  await followFirstUnfollowed(page);

  await page.evaluate(() => { localStorage.removeItem('puneNestUser'); });
  await page.goto(`${BASE}/societies`);

  // Anonymous means nothing followed, never someone else's follows. The set is caller-scoped, so a
  // shared machine must not leak one account's societies into the next person's directory.
  await expect(page.getByRole('button', { name: 'Following', exact: true })).toHaveCount(0, { timeout: 10000 });
});
