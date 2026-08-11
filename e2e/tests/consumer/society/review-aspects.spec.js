import { test, expect } from '../../../fixtures/base.js';
import { seedStorage } from '../../../helpers/seed.js';

/* Society Hub — the per-aspect ("Resident ratings") bars, end to end.
 *
 * ## What was broken, and why it was invisible
 *
 * The hub has always drawn five aspect bars — Safety, Maintenance, Management, Amenities,
 * Connectivity — and has always blended them with a deterministic per-society baseline. Two things
 * meant no resident had ever moved one:
 *
 *   1. the composer collected an overall rating and a paragraph, and nothing else; and
 *   2. the server's category vocabulary was a single closed set of the *property* aspects
 *      (`locality / condition / value / owner / accuracy`), applied to every target type, so even
 *      if the hub had sent `Safety` the aggregate would have filtered it straight back out.
 *
 * The failure mode is the dangerous one: every bar rendered a plausible number, the page looked
 * complete, and the number was the baseline alone. There was no error to notice. That is why the
 * assertions below are about *movement* rather than presence — presence is exactly what the defect
 * already satisfied.
 *
 * ## Why movement, and why it needs no knowledge of the baseline
 *
 * `useSocietyHub` renders `(catAvg[k] + base[k]) / 2` when an aspect has a real average, and
 * `base[k]` when it does not. `baselineBars` clamps every baseline into `[3.4, 4.9]`, so:
 *
 *   rate Safety 5       → (5 + b)/2 > b for every b ≤ 4.9   → strictly up
 *   rate Connectivity 1 → (1 + b)/2 < b for every b ≥ 3.4   → strictly down
 *   rate neither M/M/A  → b, unchanged, to the decimal
 *
 * The three untouched bars are the load-bearing assertion. If an unrated aspect were folded into
 * the aggregate as 0 — the shape the codebase keeps refusing, and the one D101 was — all five would
 * move, and all five would move *down*. If the write dropped `categories`, none would move. If the
 * server accepted the key but the read filtered it out, none would move either. Only "the aspects
 * the reviewer actually touched, and only those, reached the aggregate" produces this pattern.
 *
 * The society is a real MahaRERA row rather than a thin one so the blend is exercised, and the
 * before/after comparison is what makes the test independent of the baseline's actual value.
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

/** The five aspect numbers, as floats, keyed by aspect id. */
async function readBars(page) {
  const out = {};
  for (const id of ASPECTS) {
    const cell = page.getByTestId(`society-bar-${id}`);
    await expect(cell).toBeVisible({ timeout: 15_000 });
    out[id] = Number(await cell.innerText());
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

test('rating two aspects moves exactly those two bars, in the directions rated', async ({ page, login }) => {
  await login.asBuyer();
  await openReviews(page);
  const before = await readBars(page);

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  // `exact` on the overall strip only: `getByRole`'s name match is a substring one, so a bare
  // '4 star' also resolves to '4 star for Safety' and the four other rows.
  await page.getByRole('button', { name: '4 star', exact: true }).click();          // overall
  await page.getByRole('button', { name: '5 star for Safety' }).click();
  await page.getByRole('button', { name: '1 star for Connectivity' }).click();
  await page.getByRole('button', { name: 'Post review' }).click();
  // The composer closes only after the seam round-trip resolves and the hub re-reads the summary.
  await expect(page.getByRole('button', { name: 'Post review' })).toHaveCount(0, { timeout: 15_000 });

  const after = await readBars(page);

  expect(after.Safety).toBeGreaterThan(before.Safety);
  expect(after.Connectivity).toBeLessThan(before.Connectivity);
  /* The half that catches a zero masquerading as a rating. These three were never touched, so they
     must still be the baseline to the decimal — not "roughly", and specifically not lower. */
  expect(after.Maintenance).toBe(before.Maintenance);
  expect(after.Management).toBe(before.Management);
  expect(after.Amenities).toBe(before.Amenities);
});

test('a review with no aspects rated leaves every bar where it was', async ({ page, login }) => {
  /* Aspects are optional — the composer submits on the overall rating alone, exactly as the
     property modal does. The review still counts toward the headline, but an aggregate it
     contributed nothing to must not move: a blank row is not a rating of zero, and the reason to
     assert that here is that "average over everyone" and "average over everyone who answered *this*"
     look identical until somebody skips a row. */
  await login.asBuyer();
  await openReviews(page);
  const before = await readBars(page);

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: '5 star', exact: true }).click();
  await page.getByRole('button', { name: 'Post review' }).click();
  await expect(page.getByRole('button', { name: 'Post review' })).toHaveCount(0, { timeout: 15_000 });

  const after = await readBars(page);
  for (const id of ASPECTS) expect(after[id]).toBe(before[id]);
});
