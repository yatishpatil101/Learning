import { expect, test } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { isolatedPin, pickGoogleSociety } from '../../../helpers/places.js';

/* Covers what `live-society-follow.spec.js` does not: the hub (own server-computed follower count) and the tile
   that counts follows, which is a different reader from the panel that lists them. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/** A directory card, addressed by the society it is for. */
const cardFor = (page, name) => page.locator('.glass.rounded-2xl')
  .filter({ has: page.getByRole('link', { name, exact: true }) }).first();

/** Follows the first society still offering Follow and returns its name. Re-addressed by name before the click, as
 * the original locator would match the next card once this one flips. */
async function followFirstUnfollowed(page) {
  const loose = page.locator('.glass.rounded-2xl')
    .filter({ has: page.getByRole('button', { name: 'Follow', exact: true }) }).first();
  await expect(loose).toBeVisible({ timeout: 30_000 });
  const name = (await loose.getByRole('link').first().innerText()).trim();

  const card = cardFor(page, name);
  await card.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Following', exact: true })).toBeVisible({ timeout: 15_000 });
  return name;
}

test('a follow made on the directory is what the society hub shows', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto(`${BASE}/societies`);

  const name = await followFirstUnfollowed(page);

  /* The hub reads one society on its own while the card carries `followedByMe`; this keeps them agreeing. */
  await cardFor(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Following', exact: true }).first())
    .toBeVisible({ timeout: 15_000 });

  /* And it is still the hub's answer after a reload, where nothing in memory survives to supply
     it. Without this the assertion above is satisfied by the context the directory left behind. */
  await page.reload();
  await expect(page.getByRole('button', { name: 'Following', exact: true }).first())
    .toBeVisible({ timeout: 20_000 });
});

test('the dashboard follow tile counts what the panel lists', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto(`${BASE}/societies`);

  // Two different societies: the first stops "offering Follow" once followed.
  const first = await followFirstUnfollowed(page);
  const second = await followFirstUnfollowed(page);
  expect(second, 'the helper must move on to a second society').not.toBe(first);

  /* Tile and panel read one context over one server list; `2` is asserted, not "non-zero", as a tile counting
     every society would also be non-zero. */
  await page.goto(`${BASE}/dashboard`);
  await expect(page.getByLabel('View followed societies')).toContainText('2', { timeout: 30_000 });

  await page.goto(`${BASE}/dashboard#alerts`);
  for (const name of [first, second]) {
    await expect(page.getByRole('link', { name, exact: true }).first())
      .toBeVisible({ timeout: 20_000 });
  }
});

test('picking a Google Maps society nobody has listed yet mints a real row, and the follow is an ordinary server write', async ({ page }) => {
  const calls = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/')) calls.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  const seen = (re) => calls.filter((c) => re.test(c));
  const describe = () => `API calls seen: ${calls.join(' | ') || 'none'}`;

  await signedInAsNew(page);
  await page.goto(`${BASE}/dashboard#alerts`);

  // Unique per run: the placeId follows the name, so a fixed name would re-find an earlier run's row.
  const NAME = `Zz Live Follow Nest ${Date.now().toString(36)}`;
  const finder = page.getByPlaceholder(/Search your society/i);
  await expect(finder).toBeVisible({ timeout: 30_000 });
  await pickGoogleSociety(page, NAME, { input: finder, keepsValue: false, ...isolatedPin() });
  await expect
    .poll(() => seen(/POST \/api\/societies$/), { timeout: 20_000, message: describe() })
    .toEqual(expect.arrayContaining([expect.stringMatching(/^20[01] POST \/api\/societies$/)]));
  await expect
    .poll(() => seen(/PUT \/api\/me\/societies\/[^/]+\/follow$/), { timeout: 20_000, message: describe() })
    .toEqual(expect.arrayContaining([expect.stringMatching(/^20[04] PUT \/api\/me\/societies\/[^/]+\/follow$/)]));

  /* Reloaded, so the panel's list is `GET /me/societies/following` and nothing else. */
  await page.reload();
  await expect(page.getByRole('link', { name: NAME }).first()).toBeVisible({ timeout: 30_000 });

  /* A refused follow kept in a browser-only set would render identically; the link above anchors the load. */
  const stashed = await page.evaluate(() => localStorage.getItem('dzLocalSocietyFollows'));
  expect(JSON.parse(stashed || '[]'), 'a real mint must not leave a browser-only follow behind').toEqual([]);
});

test('signing out empties the follow set rather than leaving it for the next account', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto(`${BASE}/societies`);
  const name = await followFirstUnfollowed(page);

  /* Signed out through the app rather than by clearing storage, because clearing storage is not
     what a user does and would prove only that the app cannot read tokens that are gone. */
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: /Log out/i }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0, { timeout: 20_000 });

  /* Adversarial row: a different account on the same browser must not inherit the previous account's follow;
     asserting `Follow` is offered, not a missing badge, rules out a directory that rendered nothing. */
  await signedInAsNew(page);
  await page.goto(`${BASE}/societies`);
  await expect(cardFor(page, name).getByRole('button', { name: 'Follow', exact: true }))
    .toBeVisible({ timeout: 30_000 });
});
