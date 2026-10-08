import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { mintSociety, seedSocietyReviews } from '../../../helpers/liveSociety.js';

/* Society Hub per-aspect rating bars against the real API: a bar exists only where a resident rated it, so rating two aspects yields exactly two bars at those values.
 * Writes go to `POST /api/reviews/society/{slug}` and read back from `.../summary`, so the vocabulary must survive `ReviewCategories.SOCIETY_KEYS`; each test mints its own society. */

/** Force the scroll-reveal classes on: `.reveal` sits at opacity 0 until the observer fires. */
const reveal = (page) => page.evaluate(() => {
  document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible'));
});

const ASPECTS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];

const reviewsTab = (page) => page.getByRole('tab', { name: /Reviews/ });

async function openHub(page, slug) {
  await page.goto(`/society/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await reveal(page);
}

/** A fresh society with `seeded` overall-only reviews already on it, opened on its hub. */
async function openSocietyWith(page, request, label, seeded, rating) {
  const slug = await mintSociety(request, uniqueMobile(), label);
  if (seeded) await seedSocietyReviews(request, slug, seeded, { rating });
  await openHub(page, slug);
}

async function openReviews(page) {
  await reviewsTab(page).click();
  await expect(page.getByRole('heading', { name: 'Ratings', exact: true })).toBeVisible({ timeout: 15_000 });
  await reveal(page);
}

/** The aspect bars on the page as floats keyed by aspect id; tolerant of a missing bar, since an unrated aspect has no cell and that absence is asserted. */
async function readBars(page) {
  const out = {};
  for (const id of ASPECTS) {
    const cell = page.getByTestId(`society-bar-${id}`);
    if (await cell.count()) out[id] = Number(await cell.innerText());
  }
  return out;
}

/** Open the composer and wait on the submit button: the dialog is in the DOM before its form settles, and an early star click lands on nothing. */
async function openComposer(page) {
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const post = page.getByRole('button', { name: 'Post review' });
  await expect(post).toBeVisible({ timeout: 15_000 });
  return post;
}

/** Submit and assert the status code, since a closed composer looks the same whether the post succeeded; the matcher keeps `/api/` so the hub navigation cannot match. */
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

/* A fresh account per test: the server allows one review per author per target, so a shared actor 409s on re-run.
   A cached `signedInAs` snapshot can also 401 on `/auth/me` and bounce the submit to `/signin`. */
test.beforeEach(async ({ page }) => {
  await signedInAsNew(page);
});

test('the society composer offers the five aspects the hub draws bars for, and no others', async ({ page, request }) => {
  /* The vocabulary lives in the composer, the bars and the server's `ReviewCategories.SOCIETY_KEYS`;
     a rename in any one orphans stored ratings. This asserts the UI pair; the backend test covers the server. */
  await openSocietyWith(page, request, 'aspvocab', 0);
  await openComposer(page);

  await expect(page.getByText('Rate by category')).toBeVisible();
  for (const id of ASPECTS) {
    // "3 star for Safety" — named per aspect so the five rows do not collide with each other, or
    // with the overall strip's plain "3 star", for a screen reader or for this test.
    await expect(page.getByRole('button', { name: `3 star for ${id}` })).toBeVisible();
  }
  /* Only those five: a denylist catches the predicted leak, the count also catches an unexpected sixth row. */
  await expect(page.getByRole('button', { name: /\d star for / }))
    .toHaveCount(ASPECTS.length * 5);
  // Named explicitly as well, because this is the specific regression: the property vocabulary
  // leaking back in. A society is not rated on "Accuracy".
  for (const wrong of ['Condition', 'Accuracy', 'Value for money']) {
    await expect(page.getByRole('button', { name: `3 star for ${wrong}` })).toHaveCount(0);
  }
});

test('rating two aspects draws exactly those two bars, at the values rated', async ({ page, request }) => {
  await openSocietyWith(page, request, 'aspects', 2, 4);
  // The hero's count is the anchor: before the rating read lands the tab is absent for the wrong reason.
  await expect(page.getByText('(2)', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(reviewsTab(page)).toHaveCount(0);

  const post = await openComposer(page);
  // `exact` on the overall strip only: `getByRole`'s name match is a substring one, so a bare
  // '4 star' also resolves to '4 star for Safety' and the four other rows.
  await page.getByRole('button', { name: '4 star', exact: true }).click();          // overall
  await page.getByRole('button', { name: '5 star for Safety' }).click();
  await page.getByRole('button', { name: '1 star for Connectivity' }).click();
  await postReview(page, post);

  await expect(reviewsTab(page)).toHaveCount(1, { timeout: 15_000 });
  await openReviews(page);
  await expect(page.getByTestId('society-bar-Safety')).toBeVisible({ timeout: 15_000 });
  /* One `toEqual` on the whole map: rated aspects hold the residents' own numbers and skipped ones are absent. 5 and 1 differ from the overall 4,
       so a server or reader that spread the overall rating or averaged aspects would give a grid of 4s. */
  expect(await readBars(page)).toEqual({ Safety: 5, Connectivity: 1 });
});

test('a review with no aspects rated draws no bars at all', async ({ page, request }) => {
  /* A review with no aspects still counts toward the headline, but the grid must stay empty: blank is not zero. */
  await openSocietyWith(page, request, 'overall', 2, 5);
  await expect(page.getByText('(2)', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(reviewsTab(page)).toHaveCount(0);

  const post = await openComposer(page);
  await page.getByRole('button', { name: '5 star', exact: true }).click();
  await postReview(page, post);

  await expect(reviewsTab(page)).toHaveCount(1, { timeout: 15_000 });
  await openReviews(page);
  // The headline moved, so the write and the re-read both happened — without which "no bars" would
  // be true of a page that simply never updated. This is the positive anchor for the absence below.
  const ratings = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ratings', exact: true }) }).last();
  await expect(ratings.getByText('5/5')).toBeVisible({ timeout: 15_000 });
  expect(await readBars(page)).toEqual({});
});
