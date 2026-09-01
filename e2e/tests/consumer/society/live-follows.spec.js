import { expect, test } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

/* Society follows, once they became an account fact rather than a browser fact (D227).
 *
 * The retired mock twin signed in by writing `puneNestUser` into localStorage — a key the live app
 * never reads — and then asserted that five surfaces agree with each other. Every one of those
 * assertions passes against a localStorage array, which is exactly the shape the port was
 * replacing, so agreement alone could never have been the whole test.
 *
 * The **provenance** half already has a home: `tests/platform/live-society-follow.spec.js` watches
 * the wire and proves the follow reaches `PUT /me/societies/{slug}/follow`, that the badge after a
 * reload came back from `GET /me/societies/following` rather than from the browser that wrote it,
 * that the list is a page envelope, and that an anonymous visitor is never asked. None of that is
 * repeated here.
 *
 * What is left is the part that spec does not reach, and it is not a leftover: it goes directory →
 * dashboard panel, so the **hub** — the third of the five surfaces, and the one with its own
 * server-computed follower count — is never opened, and the **tile** that counts follows is a
 * different reader from the panel that lists them, which is precisely how the two used to
 * disagree. Plus two claims that changed meaning in the port and would have been recorded wrongly
 * had the mock tests simply been carried across; each says so where it stands.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/** A directory card, addressed by the society it is for. */
const cardFor = (page, name) => page.locator('.glass.rounded-2xl')
  .filter({ has: page.getByRole('link', { name, exact: true }) }).first();

/**
 * Follow the first society on the directory still offering to be followed, and return its name.
 *
 * Every test here signs in as a fresh account with an empty follow set, so "first card offering
 * Follow" is the first card — no test depends on which society that is, and nothing seeded is
 * mutated beyond a follow row keyed to a throwaway account.
 *
 * The card is re-addressed by name before the click. "First card offering Follow" stops matching
 * the moment the click lands, so holding the original locator would silently assert against the
 * *next* card — which is also unfollowed, so it fails for a reason unrelated to the code.
 */
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

  /* The hub is a different read from the directory's: the card carries `followedByMe` on the row
     the listing returned, while the hub asks about one society on its own. Two answers to one
     server fact, and this is the spec that keeps them agreeing — a hub that renders "Follow" over
     a society the directory calls "Following" is the exact disagreement the port was for. */
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

  // Two different societies: the first is no longer "still offering Follow" once it is followed.
  const first = await followFirstUnfollowed(page);
  const second = await followFirstUnfollowed(page);
  expect(second, 'the helper must move on to a second society').not.toBe(first);

  /* The tile used to be a render-body `getFollowedSocieties().length` and the panel a separate
     read of the same array, which is how a count of 2 could sit above a list of 1. Both now read
     one context over one server list, and this is the assertion that says so. `2` is asserted
     rather than "non-zero" because a tile that counts *every* society would also be non-zero. */
  await page.goto(`${BASE}/dashboard`);
  await expect(page.getByLabel('View followed societies')).toContainText('2', { timeout: 30_000 });

  await page.goto(`${BASE}/dashboard#alerts`);
  for (const name of [first, second]) {
    await expect(page.getByRole('link', { name, exact: true }).first())
      .toBeVisible({ timeout: 20_000 });
  }
});

test('adding a society nobody has listed yet mints a real row, and the follow is an ordinary server write', async ({ page }) => {
  /* The mock twin asserted the opposite — "a society this browser minted stays followed even
     though the server cannot know it" — and it was right when it was written: adding a society
     wrote it into localStorage alone, the server 404'd a follow on a slug that existed nowhere
     else, and `FollowContext` kept that follow in a browser-only set. `POST /societies` now mints
     a real row, so the follow succeeds and a refusal means something genuinely went wrong. Porting
     that test would have recorded a retired behaviour as a live guarantee, which is worse than not
     testing it: the demand signal ops are meant to act on was the thing stranded on the searcher's
     device, and this is the test that says it no longer is. */
  const calls = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/')) calls.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  const seen = (re) => calls.filter((c) => re.test(c));
  const describe = () => `API calls seen: ${calls.join(' | ') || 'none'}`;

  await signedInAsNew(page);
  await page.goto(`${BASE}/dashboard#alerts`);

  /* Unique per run: the finder only offers to add a name it could not find, so a fixed name would
     stop offering the moment a previous run's row survived — and the test would then fail on a
     missing button rather than on anything it means to assert. */
  const NAME = `Zz Live Follow Nest ${Date.now().toString(36)}`;
  const finder = page.getByPlaceholder(/Search your society/i);
  await expect(finder).toBeVisible({ timeout: 30_000 });
  await finder.fill(NAME);

  const addRow = page.getByRole('button', { name: /^Add /i });
  await expect(addRow).toBeVisible({ timeout: 20_000 });
  await addRow.click();

  await expect
    .poll(() => seen(/POST \/api\/societies$/), { timeout: 20_000, message: describe() })
    .toEqual(expect.arrayContaining([expect.stringMatching(/^20[01] POST \/api\/societies$/)]));
  await expect
    .poll(() => seen(/PUT \/api\/me\/societies\/[^/]+\/follow$/), { timeout: 20_000, message: describe() })
    .toEqual(expect.arrayContaining([expect.stringMatching(/^20[04] PUT \/api\/me\/societies\/[^/]+\/follow$/)]));

  /* Reloaded, so the panel's list is `GET /me/societies/following` and nothing else. */
  await page.reload();
  await expect(page.getByRole('link', { name: NAME }).first()).toBeVisible({ timeout: 30_000 });

  /* The precise inversion, and the reason the two halves are asserted separately: a follow that
     was refused and stashed in the browser-only set would render in that list identically. The
     visible link above is the positive anchor that keeps this emptiness from being the emptiness
     of a panel that never loaded. */
  const stashed = await page.evaluate(() => localStorage.getItem('pnLocalSocietyFollows'));
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

  /* The adversarial row: a *different* signed-in account, on the same browser, looking at the same
     card the previous one just followed. It clears every check weaker than "whose follow is it",
     and `Follow` being offered is a positive assertion rather than the absence of a badge — a
     directory that failed to render cannot pass this by rendering nothing. On a shared machine one
     person's followed buildings must not become the next person's. */
  await signedInAsNew(page);
  await page.goto(`${BASE}/societies`);
  await expect(cardFor(page, name).getByRole('button', { name: 'Follow', exact: true }))
    .toBeVisible({ timeout: 30_000 });
});
