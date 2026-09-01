import { test, expect } from '../../../fixtures/base.js';
import { seedStorage } from '../../../helpers/seed.js';

/* Society Hub — does the page show the society it claims to, and does the review count follow it?
 *
 * ## Why a route-level spec exists at all (D129)
 *
 * `data/societies.js` splits its 182 KB MahaRERA import behind `import()`, so every accessor is
 * synchronous but *eventually* complete. When the memoised accessor was introduced, nothing awaited
 * it: all eight consumers read a catalogue that held only the 28 curated rows, and the hub's
 * `resolveSociety` answered `null` for all 320 RERA slugs. It did not fail. `useSocietyHub` fell
 * through to `genericSociety` and rendered a complete, confident, entirely invented society page
 * for every one of them — and `SocietySelect` minted duplicates, because a name it was handed never
 * matched a row.
 *
 * A fabricated page looks right to a human and passes every unit test, because a unit test asks
 * "did it render a name" and the fabrication renders one. What it cannot do is produce the *right*
 * name, locality and specifications for a specific known slug. So the assertions below are exact
 * values from one real catalogue row, not presence checks — presence is precisely what the bug
 * satisfied.
 *
 * ## The row
 *
 * `palm-court-panchshil-undri` is a MahaRERA row (`source: 'rera'`), not one of the 28 curated
 * demo societies, so it is only reachable once the split chunk has landed. Its name is unique
 * across all 348 rows, and every asserted value differs from what a fabricated page would produce:
 *
 *   name       "Palm Court"        — a fabrication title-cases the slug: "Palm Court Panchshil Undri"
 *   locality   "Undri"             — a fabrication uses the society slug as the locality
 *   builder    "Panchshil Realty"  — a fabrication has no builder at all
 *   units      1,387 / towers 17 / built 2012 — a fabrication has no specifications at all
 *
 * The name is asserted `exact` on purpose: "Palm Court" is a substring of the title-cased slug, so
 * a loose match would pass against the very page this spec exists to catch.
 */

const SLUG = 'palm-court-panchshil-undri';
const NAME = 'Palm Court';
const LOCALITY = 'Undri';
const BUILDER = 'Panchshil Realty';

/* An unknown slug. Not a typo of a real one — `resolveSociety` follows ops merge redirects, so a
   near-miss could legitimately resolve. */
const UNKNOWN_SLUG = 'zzz-not-a-real-society-baner';

/* The society the property page's Society block resolves to for P5013. D19: the binding is a fact in
   the seed (`db.json` listing P5013 carries `societySlug`), not a hash of the listing id, so it
   moves only when someone edits the seed — and if they do, this constant is the thing that fails
   rather than a silently different building being described. */
const PROP = 'P5013';
const PROP_SOCIETY_SLUG = 'green-meadows-baner';

const CONSENT = { necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() };

/**
 * Entity reviews live in `pnEntityReviews`, keyed `"<type>:<id>"`.
 *
 * Seeded under the **slug** only, and that is the point of the fixture rather than an incidental
 * detail: the society hub writes and reads its reviews under `soc.slug`, because the server keys
 * societies by UUID and accepts the slug as an alias while `soc.id` is a synthetic `S01` the server
 * has never seen. A card surface that reads `entityRating('society', soc.id)` therefore addresses a
 * bucket nothing writes, and this fixture is invisible to it.
 */
const reviewsFor = (slug) => ({
  pnEntityReviews: {
    [`society:${slug}`]: [
      { id: 'er-a', user: 'Anita R', rating: 5, text: 'Well run.', at: Date.now() },
      { id: 'er-b', user: 'Bharat K', rating: 4, text: 'Good water supply.', at: Date.now() },
    ],
  },
});

/** Force the scroll-reveal classes on: `.reveal` sits at opacity 0 until the observer fires. */
const reveal = (page) => page.evaluate(() => {
  document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible'));
});

/** Open the hub and wait past the curated-rows-only first paint. */
async function openHub(page, slug) {
  await page.goto(`/society/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await reveal(page);
}

/** The stat cell rendered under a given label in the four-up grid. */
const statValue = (page, label) =>
  page.locator('.rd-cell').filter({ has: page.locator('.rd-lbl', { hasText: label }) }).locator('.rd-val');

/** The `/societies` directory card for one society, found by its hub link. */
const gridCard = (page, slug) =>
  page.locator('div.glass').filter({ has: page.locator(`a[href="/society/${slug}"]`) }).first();

/** Search the directory for a society and return its card. */
async function findInDirectory(page, slug, name) {
  await page.goto('/societies');
  await page.getByRole('textbox', { name: /search societies/i }).fill(name);
  const card = gridCard(page, slug);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await reveal(page);
  return card;
}

test.beforeEach(async ({ page }) => {
  await seedStorage(page, { pn_cookie_consent_v1: CONSENT });
});

test('a RERA society hub renders that row\'s real name, locality and specifications', async ({ page }) => {
  await openHub(page, SLUG);

  /* Exact, not `toContainText`. The fabricated page's `<h1>` was `titleCase(slug)` — "Palm Court
     Panchshil Undri" — which contains "Palm Court", so a substring assertion is satisfied by the
     defect. Same reasoning for the locality crumb below. */
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME, { timeout: 15_000 });

  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const localityLink = crumb.getByRole('link', { name: LOCALITY, exact: true });
  await expect(localityLink).toBeVisible();
  await expect(localityLink).toHaveAttribute('href', `/locality/${LOCALITY.toLowerCase()}`);

  // Builder is the hero's own subtitle line, under the `<h1>`, not part of the breadcrumb.
  const hero = page.locator('section').filter({ has: page.getByRole('heading', { level: 1 }) }).first();
  await expect(hero).toContainText(BUILDER);

  /* Three catalogue-derived numbers, none of which a fabricated row could produce: it carried no
     specifications at all, so the whole stat grid would be absent. Built is matched loosely on the
     age suffix only — `NOW_YEAR - year` moves with the clock, the 2012 does not. */
  await expect(statValue(page, 'Total units')).toHaveText('1,387');
  await expect(statValue(page, 'Towers')).toHaveText('17');
  await expect(statValue(page, 'Built')).toHaveText(/^2012\s·\s\d+y$/);
});

test('an unknown slug renders an honest placeholder, not a confident society', async ({ page }) => {
  await openHub(page, UNKNOWN_SLUG);

  /* The page still renders rather than 404s — `/society/:slug` is reachable from a shared link and
     from a listing whose society was merged away, and the hub is where a visitor tells us about a
     building we do not have. What it must not do is assert anything about it. */
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The honest state, and the invitation to fix it.
  await expect(page.getByText('Details not confirmed yet')).toBeVisible();
  await expect(page.getByRole('button', { name: /Help verify/i })).toBeVisible();

  /* No specifications. Each of these was previously printed with an invented value — 3 towers, 160
     units, built 2016, 88% occupancy — indistinguishable from a real row. */
  for (const label of ['Total units', 'Towers', 'Built', 'Occupancy']) {
    await expect(page.locator('.rd-lbl', { hasText: label })).toHaveCount(0);
  }

  /* The two claims that did the most damage: a trust badge, and a star rating. `genericSociety`
     used to set `registration` and `conveyance` both true, so an unknown slug wore "Society
     Verified"; and because it was not thin, the hero blended a baseline estimate into a headline
     rating for a building nobody has confirmed exists. */
  await expect(page.getByText('Society Verified')).toHaveCount(0);
  await expect(page.getByText('(community estimate)')).toHaveCount(0);
  await expect(page.getByText('Not rated yet').first()).toBeVisible();
});

/* ── The society card surfaces read the key the hub writes ──────────────────────────────────────
 *
 * `Societies.jsx`, `home/SocietiesSection.jsx` and `property/SocietySection.jsx` used to call
 * `entityRating('society', soc.id)`. The hub writes under `soc.slug`. Nothing has ever written a
 * `society:S01` bucket, so every card showed "Not rated yet" no matter how many reviews the society
 * actually had — a silent, permanent zero rather than a visible error.
 *
 * The fixture below seeds the slug bucket only. Point either reader back at `soc.id` and these go
 * red, because there is nothing under the id to find.
 *
 * The directory (`Societies.jsx`) has since moved off `entityRating` entirely and onto the society
 * seam (`services/societyService.js`), which in mock mode reduces this same bucket and in live mode
 * reads `avgRating`/`reviewCount` off `GET /societies`. These tests are unchanged by that on
 * purpose: they assert what the *card* says, so they hold the seam to the behaviour the localStorage
 * reduce already had. What they cannot prove is the live half — see `tests/live-society-rating.spec.js`.
 */

test('the societies directory card reports reviews written against the society', async ({ page }) => {
  await seedStorage(page, reviewsFor(SLUG));
  const card = await findInDirectory(page, SLUG, NAME);

  // 5 and 4 → 4.5 over 2. Both numbers, so a count-only or average-only read is not enough.
  await expect(card).toContainText('4.5');
  await expect(card).toContainText('(2)');
  await expect(card).not.toContainText('Not rated yet');
});

test('the property page society block reports reviews written against that society', async ({ page }) => {
  await seedStorage(page, reviewsFor(PROP_SOCIETY_SLUG));
  // The Society block lives on the Amenities & Society tab, not the overview.
  await page.goto(`/property/${PROP}?tab=amenities`, { waitUntil: 'networkidle' });
  await reveal(page);

  const block = page.locator('section').filter({ hasText: 'Society Information' }).last();
  await expect(block).toContainText('4.5', { timeout: 15_000 });
  await expect(block).toContainText('2 reviews');
});

test('the property page society block invents no rating for a society nobody has reviewed', async ({ page }) => {
  /* D195. The unrated half, and the half that was actually broken: with no fixture this block used
     to render a full star strip at a hard-coded `4.2` — not a fallback the reader could recognise
     as one, but four-and-a-bit filled stars indistinguishable from a real aggregate. It is the same
     class of defect as the fabricated `registration: true` that put "Society Verified" on
     unconfirmed buildings, and it survived this long because every assertion above seeds reviews
     first and so never visits this branch.

     `4.2` is asserted absent by literal on purpose: the number is the bug, and a structural check
     alone would still pass if someone reinstated it through a differently-named constant. */
  await page.goto(`/property/${PROP}?tab=amenities`, { waitUntil: 'networkidle' });
  await reveal(page);

  const block = page.locator('section').filter({ hasText: 'Society Information' }).last();
  await expect(block).toContainText('Not rated yet', { timeout: 15_000 });
  await expect(block).not.toContainText('4.2');
  await expect(block.getByTestId('property-society-rating')).toHaveCount(0);
});

test('a review posted on the hub shows up on that society\'s directory card', async ({ page, login }) => {
  /* The end-to-end version of the two tests above, and the one that proves the readers converged on
     the *correct* key rather than merely a consistent one: the write goes through the review seam
     (`createEntityReview`), exactly as a user would make it, and no fixture decides the key. */
  await login.asBuyer();
  await openHub(page, SLUG);

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  // `exact` because the composer's per-aspect rows are labelled "5 star for Safety" and
  // `getByRole`'s name match is a substring one — without it this resolves to six buttons.
  await page.getByRole('button', { name: '5 star', exact: true }).click();
  await page.getByRole('button', { name: 'Post review' }).click();
  // The composer closes only after the seam round-trip resolves and the hub re-reads.
  await expect(page.getByRole('button', { name: 'Post review' })).toHaveCount(0, { timeout: 15_000 });

  const card = await findInDirectory(page, SLUG, NAME);
  await expect(card).toContainText('(1)');
  await expect(card).not.toContainText('Not rated yet');
});

test('a society with no reviews says so, and invents no number to say it with', async ({ page }) => {
  /* Same society, no fixture. The counterpart of the two tests above and the more important half:
     an aggregate that is wrong in the "rated" direction is loud, and an aggregate that is wrong in
     the "unrated" direction is the bug this whole surface just came off.
   *
   * Now that the rating arrives through the seam it can be absent for two different reasons — no
   * reviews, or the read failed — and only one of them licenses this sentence. `avgRating` is null
   * rather than 0 the whole way down (server → mapper → card) so that a dropped `count > 0` gate
   * can never quietly render a one-star society, and the assertions below are what holds that: no
   * parenthesised count, no stars, and specifically *not* the unavailable state. */
  const card = await findInDirectory(page, SLUG, NAME);

  await expect(card).toContainText('Not rated yet');
  await expect(card).not.toContainText(/\(\d+\)/);
  await expect(card.getByTestId('society-rating')).toHaveCount(0);
  await expect(card.getByTestId('society-rating-unavailable')).toHaveCount(0);
  await expect(card.getByTestId('society-rating-skeleton')).toHaveCount(0);
});
