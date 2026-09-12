import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

/* Society Hub — the per-aspect ("Resident ratings") bars, against the real API.
 *
 * ## What was broken, and why it was invisible
 *
 * The hub drew five aspect bars — Safety, Maintenance, Management, Amenities, Connectivity —
 * whether or not a resident had ever rated one, because `baselineBars` supplied a deterministic
 * per-society number seeded off occupancy and build year, and any real average was blended 50/50
 * into it. Two things meant no resident had ever moved one:
 *
 *   1. the composer collected an overall rating and a paragraph, and nothing else; and
 *   2. the server's category vocabulary was a single closed set of the *property* aspects
 *      (`locality / condition / value / owner / accuracy`), applied to every target type, so even
 *      if the hub had sent `Safety` the aggregate would have filtered it straight back out.
 *
 * The failure mode is the dangerous one: every bar rendered a plausible number, the page looked
 * complete, and the number was the baseline alone. There was no error to notice.
 *
 * ## Why the live port is the version that proves it
 *
 * Reason (2) was a *server* fact. The mock version of this spec could only ever assert that the
 * composer collected five aspects and that a client-side reducer handed them back — the half that
 * was never broken. The write here goes to `POST /api/reviews/society/{slug}` and the bars are
 * re-read from `GET .../summary`, so the vocabulary now has to survive the round trip through
 * `ReviewCategories.SOCIETY_KEYS` for a single bar to appear. A server that took `Safety` and
 * filtered it back out on the read — the original defect, exactly — fails this file and could not
 * fail its predecessor.
 *
 * ## Why these assertions are about presence
 *
 * They could not be, while the baseline existed — presence was precisely what the defect already
 * satisfied. D197 deleted the baseline. A bar exists only where a resident put a number behind it,
 * which makes absence assertable: rate two aspects and exactly two bars exist, at exactly the
 * values rated. If an unrated aspect were folded in as 0 — the shape this codebase keeps refusing —
 * five bars would appear instead of two. If the write dropped `categories`, none would. If the
 * server took the key but the read filtered it out, none would either.
 *
 * ## Fixtures: one society per writing test, and why
 *
 * The live database is reset once per run, not once per test, and `workers: 1` means every spec in
 * the suite shares it. A review is therefore permanent for the rest of the run, so the two writing
 * tests below cannot share a society: the second would open on the first one's bars and its "no
 * bars yet" precondition would be false. They cannot use `palm-court-panchshil-undri` either — the
 * slug the mock spec used — because `live-rera-catalogue.spec.js` already owns it and sorts ahead
 * of this file alphabetically.
 *
 * All three are MahaRERA rows (`source: 'rera'`) rather than curated ones. That is deliberate and
 * it is the same reason the mock spec gave: the curated path is where the fabrication lived, so a
 * real catalogue row is the harder case, and each is named by exactly one spec in the suite — this
 * one — so nothing else can leave a rating behind on them.
 */

/** Composer vocabulary only. Never posts, so it neither needs nor leaves an empty society. */
const VOCAB_SLUG = 'aster-greens-lunkad-balewadi';
/** Two aspects rated here, and nowhere else in the suite. */
const ASPECT_SLUG = 'aster-avenue-pethkar-aundh';
/** An overall-only review here, and nowhere else in the suite. */
const OVERALL_SLUG = 'aster-estate-saarrthi-moshi';

/** Force the scroll-reveal classes on: `.reveal` sits at opacity 0 until the observer fires. */
const reveal = (page) => page.evaluate(() => {
  document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible'));
});

const ASPECTS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];

/** Open the hub on the Reviews tab and wait past the curated-rows-only first paint (D129). */
async function openReviews(page, slug) {
  await page.goto(`/society/${slug}?tab=reviews`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Resident ratings' })).toBeVisible({ timeout: 15_000 });
  await reveal(page);
}

/**
 * The aspect bars actually on the page, as floats, keyed by aspect id.
 *
 * Deliberately tolerant of a missing bar. Post-D197 an aspect nobody rated has no cell at all, and
 * that absence is half of what these tests assert — a helper that waited for all five would turn
 * the expected result into a 15-second timeout.
 */
async function readBars(page) {
  const out = {};
  for (const id of ASPECTS) {
    const cell = page.getByTestId(`society-bar-${id}`);
    if (await cell.count()) out[id] = Number(await cell.innerText());
  }
  return out;
}

/**
 * Open the composer and wait for it to be usable.
 *
 * The submit button is the gate rather than the dialog box, because the box is in the DOM before
 * the form inside it settles and a star clicked in that window lands on nothing — the composer then
 * closes on submit having posted no review, which is indistinguishable from success at every later
 * assertion.
 */
async function openComposer(page) {
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const post = page.getByRole('button', { name: 'Post review' });
  await expect(post).toBeVisible({ timeout: 15_000 });
  return post;
}

/**
 * Submit the composer and prove the server took it.
 *
 * A closed composer is what both a successful post and a silently dropped one look like, so the
 * status code is asserted rather than inferred. The matcher includes `/api/` on purpose: without
 * it, the page navigation to the hub route itself matches and the assertion passes on a request
 * that carried no review.
 */
async function postReview(page, post) {
  const [created] = await Promise.all([
    page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/api\/reviews\/society\//.test(r.url()), { timeout: 15_000 }),
    post.click(),
  ]);
  expect(created.status()).toBe(201);
  // The composer closes only after the seam round-trip resolves and the hub re-reads the summary.
  await expect(post).toHaveCount(0, { timeout: 15_000 });
}

/* A fresh account per test rather than the shared `login.asBuyer()` the mock spec used. The server
   enforces one review per author per target (`existsByAuthorIdAndTargetTypeAndTargetId`), so a
   shared actor is one re-run away from a 409 that this file would report as a rendering bug. It
   also sidesteps `signedInAs` replaying a cached storage snapshot for an actor already signed in
   earlier in the run, which has been observed answering 401 on `/auth/me` — nulling the React user
   while leaving the composer reachable, so the submit silently bounces to `/signin`. */
test.beforeEach(async ({ page }) => {
  await signedInAsNew(page);
});

test('the society composer offers the five aspects the hub draws bars for, and no others', async ({ page }) => {
  /* The vocabulary is load-bearing in three places at once — the composer's rows, the bars' ids and
     the server's `ReviewCategories.SOCIETY_KEYS` — and a rename in any one of them orphans every
     rating already stored under the old id. This asserts the first two agree; the backend's
     `categoryVocabularyMatchesTheUi` asserts the third against this same list, and the two writing
     tests below prove the agreement end to end. */
  await openReviews(page, VOCAB_SLUG);
  await openComposer(page);

  await expect(page.getByText('Rate by category')).toBeVisible();
  for (const id of ASPECTS) {
    // "3 star for Safety" — named per aspect so the five rows do not collide with each other, or
    // with the overall strip's plain "3 star", for a screen reader or for this test.
    await expect(page.getByRole('button', { name: `3 star for ${id}` })).toBeVisible();
  }
  /* And *only* those five. A denylist of names catches the leak you predicted; this catches the one
     you did not, including a sixth row whose label is a missing i18n key and so spells nothing
     recognisable at all. Five rows of five stars — any extra aspect changes the count. */
  await expect(page.getByRole('button', { name: /\d star for / }))
    .toHaveCount(ASPECTS.length * 5);
  // Named explicitly as well, because this is the specific regression: the property vocabulary
  // leaking back in. A society is not rated on "Accuracy".
  for (const wrong of ['Condition', 'Accuracy', 'Value for money']) {
    await expect(page.getByRole('button', { name: `3 star for ${wrong}` })).toHaveCount(0);
  }
});

test('rating two aspects draws exactly those two bars, at the values rated', async ({ page }) => {
  await openReviews(page, ASPECT_SLUG);
  /* Settle the summary read before asserting absence, or "no bars" passes for the wrong reason —
     while the rating is still loading there are none either. The hero above the tabs is the
     cheapest signal that the read came back, and came back empty. It is also the positive anchor
     this test needs: every other assertion here is an absence, and an absence asserted against a
     panel that has not mounted is true of a blank page. */
  await expect(page.getByText('Not rated yet')).toBeVisible({ timeout: 15_000 });
  expect(await readBars(page)).toEqual({});

  const post = await openComposer(page);
  // `exact` on the overall strip only: `getByRole`'s name match is a substring one, so a bare
  // '4 star' also resolves to '4 star for Safety' and the four other rows.
  await page.getByRole('button', { name: '4 star', exact: true }).click();          // overall
  await page.getByRole('button', { name: '5 star for Safety' }).click();
  await page.getByRole('button', { name: '1 star for Connectivity' }).click();
  await postReview(page, post);

  await expect(page.getByTestId('society-bar-Safety')).toBeVisible({ timeout: 15_000 });
  /* One assertion carries both halves: the two rated aspects hold the residents' own numbers rather
     than a blend of them with anything, and the three skipped ones are absent rather than sitting
     at 0 — which `toEqual` on the whole map catches without a denylist.

     The values are the adversarial part. 5 and 1 are the extremes of the scale and neither matches
     the 4 given overall, so a server that stored the overall rating against every category, or a
     reader that averaged the aspects together, or one that fell back to the headline for a missing
     row, all produce a full grid of 4s rather than this. */
  expect(await readBars(page)).toEqual({ Safety: 5, Connectivity: 1 });
});

test('a review with no aspects rated draws no bars at all', async ({ page }) => {
  /* Aspects are optional — the composer submits on the overall rating alone, exactly as the
     property modal does. The review counts toward the headline, but it answered no aspect, so the
     grid it contributed nothing to must stay empty: a blank row is not a rating of zero, and
     "average over everyone" and "average over everyone who answered *this*" look identical until
     somebody skips a row. Before D197 this was unassertable — the baseline drew five bars for a
     society whose every aspect was unrated. */
  await openReviews(page, OVERALL_SLUG);
  await expect(page.getByText('Not rated yet')).toBeVisible({ timeout: 15_000 });

  const post = await openComposer(page);
  await page.getByRole('button', { name: '5 star', exact: true }).click();
  await postReview(page, post);

  // The headline moved, so the write and the re-read both happened — without which "no bars" would
  // be true of a page that simply never updated. This is the positive anchor for the absence below.
  const ratings = page.locator('section').filter({ hasText: 'Resident ratings' }).last();
  await expect(ratings.getByText('5/5')).toBeVisible({ timeout: 15_000 });
  expect(await readBars(page)).toEqual({});
});
