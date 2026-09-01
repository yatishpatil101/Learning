import { test, expect } from '../../../fixtures/live.js';
import { seedStorage } from '../../../helpers/seed.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

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

/* The society the property page's Society block resolves to. D19: the binding is a fact in the
   database (`properties.society_id`), not a hash of the listing id, so it moves only when someone
   edits the seed — and if they do, this constant is the thing that fails rather than a silently
   different building being described.

   The pair is the point. `REVIEWED_PROP`'s society carries two seeded reviews; `UNRATED_PROP`'s
   carries none, deliberately, because the branch that used to print a hard-coded 4.2 for an
   unreviewed building can only be reached by a society nobody has reviewed. One property cannot
   exercise both, which is why the mock version of this spec — which simply withheld its
   localStorage fixture on the second pass — has to become two properties here. */
const REVIEWED_PROP = 'p5013';
const UNRATED_PROP = 'p5008';

/* p5008's society, which carries no reviews and is never written to by any test in this file — so
   it is the one society that is still unrated by the time the last test runs. `FRESH_SLUG` cannot
   serve here: the post-a-review test above it leaves a review behind. */
const UNRATED_SLUG = 'golden-nest-mahindra-baner';
const UNRATED_NAME = 'Golden Nest';

/* A society with no seeded reviews, for the post-a-review test: it must reach exactly (1)
   afterwards, which a society that already carries the 5+4 fixture never could. */
const FRESH_SLUG = 'green-meadows-baner';
const FRESH_NAME = 'Green Meadows';

const CONSENT = { necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() };

/**
 * D19. There is no fixture constructor here any more, and its absence is the assertion.
 *
 * This spec used to seed `pnEntityReviews` into localStorage — a mock-provider store the live app
 * never reads. Against the real API those two reviews were invisible, so every rating assertion
 * below would have been measuring the server's empty state while appearing to describe a seeded
 * one. The reviews now live in `R__zz_dev_demo_data.sql` as `target_type = 'society'` rows keyed on
 * the society's uuid, which is what `SocietyRatingService` aggregates on.
 *
 * 5 + 4 over two societies, so the average is 4.5 and not a whole number: a reader that truncates,
 * rounds, or hands back the count where the average belongs still yields a believable figure from a
 * whole-number fixture.
 */

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

  /* D19 \u2014 the honest sentence differs between the two backends, and only the *dishonest* ones are
     asserted against. On mocks the client owns the whole store, so an unknown slug is knowably
     unrated and the hub says "Not rated yet". Live, `GET /reviews/society/{slug}/summary` answers
     404 for a society the server has never heard of (verified by hand), which is not the same
     statement at all: we have not been told this building has no reviews, we have been told we
     cannot ask. "Rating unavailable right now" is the correct rendering of that, and pinning the
     mock wording here would have forced the live client to claim knowledge it does not have.

     What both must do is refuse to put a number on it, which is what this asserts. */
  await expect(page.getByText(/Not rated yet|Rating unavailable right now/).first()).toBeVisible();
  await expect(page.locator('[data-testid="society-rating"]')).toHaveCount(0);
});

/* ── The society card surfaces read the key the hub writes ──────────────────────────────────────
 *
 * `Societies.jsx`, `home/SocietiesSection.jsx` and `property/SocietySection.jsx` used to call
 * `entityRating('society', soc.id)`. The hub writes under `soc.slug`. Nothing has ever written a
 * `society:S01` bucket, so every card showed "Not rated yet" no matter how many reviews the society
 * actually had — a silent, permanent zero rather than a visible error.
 *
 * The fixture is server-side, and seeded against the society **uuid** because that is what
 * `SocietyRatingService` aggregates on. The slug is accepted as an alias on the write path only
 * (`ReviewTargetKey.resolve` looks it up and stores the id), which is why a fixture written under
 * the slug — as the localStorage one was — is invisible to every read.
 *
 * The directory (`Societies.jsx`) has since moved off `entityRating` entirely and onto the society
 * seam (`services/societyService.js`), which in mock mode reduces this same bucket and in live mode
 * reads `avgRating`/`reviewCount` off `GET /societies`. These tests are unchanged by that on
 * purpose: they assert what the *card* says, so they hold the seam to the behaviour the localStorage
 * reduce already had. What they cannot prove is the live half — see `tests/live-society-rating.spec.js`.
 */

test('the societies directory card reports reviews written against the society', async ({ page }) => {
  const card = await findInDirectory(page, SLUG, NAME);

  // 5 and 4 → 4.5 over 2. Both numbers, so a count-only or average-only read is not enough.
  await expect(card).toContainText('4.5');
  await expect(card).toContainText('(2)');
  await expect(card).not.toContainText('Not rated yet');
});

test('the property page society block reports reviews written against that society', async ({ page }) => {
  // The Society block lives on the Amenities & Society tab, not the overview.
  await page.goto(`/property/${REVIEWED_PROP}?tab=amenities`, { waitUntil: 'networkidle' });
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
  await page.goto(`/property/${UNRATED_PROP}?tab=amenities`, { waitUntil: 'networkidle' });
  await reveal(page);

  const block = page.locator('section').filter({ hasText: 'Society Information' }).last();
  await expect(block).toContainText('Not rated yet', { timeout: 15_000 });
  await expect(block).not.toContainText('4.2');
  await expect(block.getByTestId('property-society-rating')).toHaveCount(0);
});

test('a review posted on the hub shows up on that society\'s directory card', async ({ page }) => {
  /* The end-to-end version of the two tests above, and the one that proves the readers converged on
     the *correct* key rather than merely a consistent one: the write goes through the review seam
     (`createEntityReview`), exactly as a user would make it, and no fixture decides the key.

     A freshly minted account rather than the shared buyer, for two reasons. The server enforces
     one review per author per target (`existsByAuthorIdAndTargetTypeAndTargetId`), so a spec that
     writes as a shared actor is one re-run or one neighbouring spec away from a 409 it would report
     as a rendering bug. And `signedInAs` replays a cached storage snapshot for an actor already
     signed in during the run — observed here answering 401 on `/auth/me`, which nulls the React
     user while leaving the composer reachable, so the submit silently bounced to `/signin`.
     `signedInAsNew` mints an unused mobile, so there is no snapshot to replay. */
  await signedInAsNew(page);
  await openHub(page, FRESH_SLUG);

  await page.getByRole('button', { name: 'Review', exact: true }).click();

  /* Wait for the composer before touching it. Its submit button is the gate rather than the dialog
     box because the box is in the DOM before the form inside it settles, and a star clicked in that
     window lands on nothing: the composer then closes on submit having posted no review, which is
     indistinguishable from success at every later assertion. Verified by hand — the same three
     clicks with one `await` between them post a 201, and without it post nothing at all. */
  const post = page.getByRole('button', { name: 'Post review' });
  await expect(post).toBeVisible({ timeout: 15_000 });

  // `exact` because the composer's per-aspect rows are labelled "5 star for Safety" and
  // `getByRole`'s name match is a substring one — without it this resolves to six buttons.
  await page.getByRole('button', { name: '5 star', exact: true }).click();

  /* Assert the write, not just the composer closing. A closed composer is what *both* a successful
     post and a silently dropped one look like, and this spec exists to prove the reader and the
     writer agree on a key — a claim that means nothing if no row was ever written. */
  const [created] = await Promise.all([
    page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/api\/reviews\/society\//.test(r.url()), { timeout: 15_000 }),
    post.click(),
  ]);
  expect(created.status()).toBe(201);

  // The composer closes only after the seam round-trip resolves and the hub re-reads.
  await expect(post).toHaveCount(0, { timeout: 15_000 });

  const card = await findInDirectory(page, FRESH_SLUG, FRESH_NAME);
  await expect(card).toContainText('(1)');
  await expect(card).not.toContainText('Not rated yet');
});

test('a society with no reviews says so, and invents no number to say it with', async ({ page }) => {
  /* A society nobody has reviewed. The counterpart of the two tests above and the more important
     half:
     an aggregate that is wrong in the "rated" direction is loud, and an aggregate that is wrong in
     the "unrated" direction is the bug this whole surface just came off.
   *
   * Now that the rating arrives through the seam it can be absent for two different reasons — no
   * reviews, or the read failed — and only one of them licenses this sentence. `avgRating` is null
   * rather than 0 the whole way down (server → mapper → card) so that a dropped `count > 0` gate
   * can never quietly render a one-star society, and the assertions below are what holds that: no
   * parenthesised count, no stars, and specifically *not* the unavailable state. */
  const card = await findInDirectory(page, UNRATED_SLUG, UNRATED_NAME);

  await expect(card).toContainText('Not rated yet');
  await expect(card).not.toContainText(/\(\d+\)/);
  await expect(card.getByTestId('society-rating')).toHaveCount(0);
  await expect(card.getByTestId('society-rating-unavailable')).toHaveCount(0);
  await expect(card.getByTestId('society-rating-skeleton')).toHaveCount(0);
});
