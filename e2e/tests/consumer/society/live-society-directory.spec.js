import { expect, test } from '../../../fixtures/live.js';
import { API, uniqueMobile } from '../../../helpers/liveAuth.js';
import { mintSociety } from '../../../helpers/liveSociety.js';

/* Whether `/societies` is a directory of the *platform's* societies or of the ones that happened to
 * be compiled into this build.
 *
 * It was the second, and the way it got there is the part worth keeping in a comment. The page did
 * ask the server for the catalogue — `listSocietyRatings()` walked every page of `GET /societies`
 * on mount — and then used two columns off each row and built the grid it was rating out of
 * `data/societies.js`, the 348 rows in the bundle. So the real catalogue arrived, was measured, and
 * was thrown away. Every society minted through the API since the seed was absent from the
 * directory, including any the same page's own "add your society" box had just created: a member
 * could add a building, be taken to its hub, come back, search for it, and be told no society
 * matched — and be invited to add it again.
 *
 * Two claims, each with its own way of being wrong: the catalogue reaches the grid *whole* (a
 * society this build cannot know about is in it), and the columns the grid renders are the
 * server's (a badge that vouches for a building is backed by the server's own record of it). The
 * rows both tests are measured against are read back over HTTP before the page opens, so neither
 * is ever compared with a copy of what the page drew.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SEARCH = 'Search by society, builder or locality';

/** Mint a society and return its slug alongside the row the server holds for it.
 *
 * The browser is never signed in here: the directory is a public page, and reading it as an
 * anonymous visitor is the stronger test — a row that reaches a signed-out reader came from the
 * catalogue and not from anything scoped to the account that created it. */
async function mintedSociety(request, label) {
  const slug = await mintSociety(request, uniqueMobile(), label);
  const res = await request.get(`${API}/societies/${slug}`);
  expect(res.status()).toBe(200);
  return { slug, row: await res.json() };
}

/** The card that names `name`. `.glass` is the card's own shell; the toolbar and the empty state
 *  share the class but contain no society link, so the filter is what does the work. */
function cardFor(page, name) {
  return page.locator('.glass').filter({ has: page.getByRole('link', { name, exact: true }) });
}

/** Open the directory and narrow it to one society.
 *
 * `toHaveCount(1)` rather than `toBeVisible()`. The search filters a grid of 350-odd, and for the
 * frame before React re-renders the locator matches many cards — a strict-mode violation, which
 * aborts an expectation *instantly* instead of retrying it. `toBeVisible` would therefore fail on
 * the previous paint and report it as the society being missing. */
async function findInDirectory(page, name) {
  await page.goto(`${BASE}/societies`);
  await page.getByPlaceholder(SEARCH).fill(name);
  const card = cardFor(page, name);
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  return card;
}

test('the directory lists a society minted after this build was compiled', async ({ page, request }) => {
  const { slug, row } = await mintedSociety(request, 'dirlist');
  expect(row.name, 'the server named the society it just minted').toBeTruthy();

  const card = await findInDirectory(page, row.name);

  /* The locality is the discriminator a bundled row could not have supplied: this society was
     created seconds ago and nothing in `data/societies.js` carries its name to borrow one from. */
  await expect(card.getByText(titleCase(row.localitySlug), { exact: false })).toHaveCount(1);
  await expect(card.getByRole('link', { name: row.name, exact: true }))
    .toHaveAttribute('href', `/society/${slug}`);
});

test('the Verified badge is backed by the server\'s registration and conveyance', async ({ page, request }) => {
  /* Chosen from the catalogue rather than hardcoded, so a reseed moves the test rather than
     breaking it. The claim under test is narrow and worth stating precisely: "Verified" on a
     society card means the server holds *both* a registration and a conveyance for that building.
     It is the badge with consequences — it is the page vouching for a society to somebody deciding
     where to live — and before this fix it was read off whatever the bundle happened to say. */
  const soc = await verifiedSociety(request);
  expect(soc, 'a seeded society that is registered, conveyed and unclaimed').toBeTruthy();

  const card = await findInDirectory(page, soc.name);
  await expect(card.getByText('Verified', { exact: true })).toHaveCount(1);

  /* And the badge it must not be wearing instead. "Community" is the card's *fallback* branch —
     what it prints when a society is neither managed nor verified — so asserting its absence is
     what makes the assertion above about the server's columns rather than about the branch order. */
  await expect(card.getByText('Community', { exact: true })).toHaveCount(0);
});

/** The first catalogue row the server records as registered, conveyed and not yet claimed.
 *
 * `claimStatus` matters because the card's badges are a three-way and `managed` wins: a claimed
 * society renders "Managed" no matter what its registration says, which would make the assertion
 * above pass for the wrong reason. */
async function verifiedSociety(request) {
  for (let page = 0; page < 4; page += 1) {
    const res = await request.get(`${API}/societies?page=${page}&size=100`);
    expect(res.status()).toBe(200);
    const { content = [] } = await res.json();
    const hit = content.find((s) => s.registration && s.conveyance && s.claimStatus !== 'claimed');
    if (hit) return hit;
  }
  return null;
}

/** The page's own transform, duplicated so the expectation does not depend on the code under test. */
function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
