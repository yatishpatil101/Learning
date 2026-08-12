import { test, expect } from '../../../fixtures/base.js';
import { seedStorage } from '../../../helpers/seed.js';

/* Society Hub — the per-aspect ("Resident ratings") bars, end to end.
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
 * ## Why these assertions are about presence again
 *
 * They could not be, while the baseline existed — presence was precisely what the defect already
 * satisfied, so the first version of this file asserted *movement* across a before/after snapshot
 * and leaned on three untouched bars as its load-bearing claim.
 *
 * D197 deleted the baseline. A bar exists only where a resident put a number behind it, which makes
 * absence assertable and turns the same claim into a strictly stronger one: rate two aspects and
 * exactly two bars exist, at exactly the values rated. If an unrated aspect were folded in as 0 —
 * the shape this codebase keeps refusing, and the one D101 was — five bars would appear instead of
 * two. If the write dropped `categories`, none would. If the server took the key but the read
 * filtered it out, none would either. And the numbers are now the residents' own, so they can be
 * asserted to the value rather than by direction.
 *
 * The society is a real MahaRERA row rather than a thin one because the thin path was already
 * honest before D197 — a curated society is where the fabrication lived.
 */

const SLUG = 'palm-court-panchshil-undri';

const CONSENT = { necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() };

/** Force the scroll-reveal classes on: `.reveal` sits at opacity 0 until the observer fires. */
const reveal = (page) => page.evaluate(() => {
  document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible'));
});

const ASPECTS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];

/** Open the hub on the Reviews tab and wait past the curated-rows-only first paint (D129). */
async function openReviews(page) {
  await page.goto(`/society/${SLUG}?tab=reviews`);
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

test.beforeEach(async ({ page }) => {
  await seedStorage(page, { pn_cookie_consent_v1: CONSENT });
});

test('the society composer offers the five aspects the hub draws bars for, and no others', async ({ page, login }) => {
  /* The vocabulary is load-bearing in three places at once — the composer's rows, the bars' ids and
     the server's `ReviewCategories.SOCIETY_KEYS` — and a rename in any one of them orphans every
     rating already stored under the old id. This asserts the first two agree; the backend's
     `categoryVocabularyMatchesTheUi` asserts the third against this same list. */
  await login.asBuyer();
  await openReviews(page);
  await page.getByRole('button', { name: 'Review', exact: true }).click();

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

test('rating two aspects draws exactly those two bars, at the values rated', async ({ page, login }) => {
  await login.asBuyer();
  await openReviews(page);
  /* Settle the summary read before asserting absence, or "no bars" passes for the wrong reason —
     while the rating is still loading there are none either. The hero above the tabs is the
     cheapest signal that the read came back, and came back empty. */
  await expect(page.getByText('Not rated yet')).toBeVisible({ timeout: 15_000 });
  expect(await readBars(page)).toEqual({});

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  // `exact` on the overall strip only: `getByRole`'s name match is a substring one, so a bare
  // '4 star' also resolves to '4 star for Safety' and the four other rows.
  await page.getByRole('button', { name: '4 star', exact: true }).click();          // overall
  await page.getByRole('button', { name: '5 star for Safety' }).click();
  await page.getByRole('button', { name: '1 star for Connectivity' }).click();
  await page.getByRole('button', { name: 'Post review' }).click();
  // The composer closes only after the seam round-trip resolves and the hub re-reads the summary.
  await expect(page.getByRole('button', { name: 'Post review' })).toHaveCount(0, { timeout: 15_000 });

  await expect(page.getByTestId('society-bar-Safety')).toBeVisible({ timeout: 15_000 });
  /* One assertion carries both halves: the two rated aspects hold the residents' own numbers rather
     than a blend of them with anything, and the three skipped ones are absent rather than sitting
     at 0 — which `toEqual` on the whole map catches without a denylist. */
  expect(await readBars(page)).toEqual({ Safety: 5, Connectivity: 1 });
});

test('a review with no aspects rated draws no bars at all', async ({ page, login }) => {
  /* Aspects are optional — the composer submits on the overall rating alone, exactly as the
     property modal does. The review counts toward the headline, but it answered no aspect, so the
     grid it contributed nothing to must stay empty: a blank row is not a rating of zero, and
     "average over everyone" and "average over everyone who answered *this*" look identical until
     somebody skips a row. Before D197 this was unassertable — the baseline drew five bars for a
     society whose every aspect was unrated. */
  await login.asBuyer();
  await openReviews(page);

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: '5 star', exact: true }).click();
  await page.getByRole('button', { name: 'Post review' }).click();
  await expect(page.getByRole('button', { name: 'Post review' })).toHaveCount(0, { timeout: 15_000 });

  // The headline moved, so the write and the re-read both happened — without which "no bars" would
  // be true of a page that simply never updated.
  const ratings = page.locator('section').filter({ hasText: 'Resident ratings' }).last();
  await expect(ratings.getByText('5/5')).toBeVisible({ timeout: 15_000 });
  expect(await readBars(page)).toEqual({});
});
