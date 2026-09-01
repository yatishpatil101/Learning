import { test, expect } from '@playwright/test';

/* The property rating block after D79 — the four aggregate numbers now come from the review seam's
   `getPropertyReviewSummary`, not from a `reduce` over the review list the page also renders.

   What that swap can break is not the average, which is easy to eyeball, but the three shapes
   around it. Each is asserted below because each has a plausible-looking wrong answer:

     - the star distribution arrives as `{"1"…"5"}` string keys on the wire and is drawn from a
       0-based array, so an off-by-one lands the 5★ count on the 4★ bar and still renders;
     - `categoryAverages` is sparse — an aspect nobody rated must stay absent, not appear as 0,
       and must be averaged over the reviews that answered *it* rather than over all of them;
     - "% would recommend" has no server aggregate at all and is still derived from the list, so it
       is the one number that would silently vanish if the whole block were switched over.

   Mock mode, so this proves the rendering contract rather than the wire call. Whether the endpoint
   is genuinely reached belongs to `live-property-integration` — see the note in COVERAGE.md. */

const PROP = 'p5013';
const UNREVIEWED = 'p5124';

/* The fixture lives in the seed (`reviews`, three rows against p5013), not in localStorage:
   `puneNestPropReviews` is a mock-provider store the live app never reads, so seeding it here
   would leave the server aggregate - the thing this spec exists to check - unasserted.
   Ratings 5/4/3 -> avg 4.0, one review on each of the top three bars, none on 1* or 2*.
   Author names are the seeded users, so a rename in the seed surfaces here rather than silently
   weakening the "every card still renders" assertion at the end. */
const SEED = [
  { user: 'Rahul Mehta', rating: 5, categories: { locality: 5, condition: 4 }, recommend: true, context: 'visit' },
  { user: 'Priya Nair', rating: 4, categories: { locality: 4 }, recommend: true, context: 'tenant' },
  // recommend `null`, not false: an author who skipped the question. Counting them as "would not"
  // is the mistake that drags the headline percentage below what anyone actually said.
  { user: 'Arjun Rao', rating: 3, categories: {}, recommend: null, context: null },
];

async function openReviews(page, id) {
  /* `?tab=amenities`, not a click: the reviews block is mounted by PropertyTabs only while that tab
     is current (`useProperty.js` reads the tab from the query string), so on the default Overview
     tab the section does not exist at all and the summary read never fires. Deep-linking is also
     what the rest of the property suite does — it keeps the assertion about the rating block rather
     than about the tab bar that happens to sit above it. */
  await page.goto(`/property/${id}?tab=amenities`, { waitUntil: 'networkidle' });
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15000 });
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: /ratings/i }) });
  // The block sits behind a `.fade-in`, which is at `opacity: 0` until scrolled into view;
  // scrollIntoViewIfNeeded deadlocks on that, so force the class the observer would have added.
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await expect(section.first()).toBeVisible({ timeout: 15000 });
  return section.first();
}

test('the rating summary reports the seam\'s aggregate, not a tally of the cards below it', async ({ page }) => {
  const section = await openReviews(page, PROP);

  /* Scoped to the aggregate card, not the section's innerText. Every review card renders its own
     rating and its own category chips, so a section-wide text scrape passes even when the summary
     card is absent or wrong — `4.0` and `locality` are both printed by the cards themselves. */
  await expect(section.getByTestId('reviews-average')).toHaveText('4.0');

  /* Bucket alignment, asserted by position. The distribution arrives as `{"1"…"5"}` string keys and
     is drawn from a 0-based array, so an off-by-one lands the 5★ count on the 4★ bar and still
     renders a perfectly plausible chart. The seed is deliberately asymmetric — one review each on
     5/4/3, none on 2/1 — so a shift by one is visible here and nowhere else. */
  for (const [star, n] of [[5, '1'], [4, '1'], [3, '1'], [2, '0'], [1, '0']]) {
    await expect(section.getByTestId(`reviews-bar-${star}`)).toHaveText(n);
  }

  // Sparse by contract: two aspects were rated, three were not, and the three must be absent
  // rather than shown at zero — a 0.0 "Owner" row is a claim nobody made.
  const cats = section.getByTestId('reviews-cat-averages');
  await expect(cats).toContainText(/locality/i);
  await expect(cats).toContainText(/condition/i);
  await expect(cats).not.toContainText(/accuracy/i);
  await expect(cats).not.toContainText(/owner/i);
  // Averaged over the reviews that answered it (5 and 4), not over all three.
  await expect(cats).toContainText('4.5');
  /* Row order is the mapper's, not the provider's: the server aggregates `order by c.key`
     (alphabetical) and the mock inserts in product order, so without a fixed order here the suite
     would prove a layout production does not render. Locality precedes Condition. */
  await expect(cats).toHaveText(/locality[\s\S]*condition/i);

  // Derived from the list, because the server summary has no `recommend` field. Two of the three
  // answered and both said yes; the abstainer is excluded from the denominator.
  await expect(section.getByTestId('reviews-recommend')).toContainText(/100\s*%/);

  // Every seeded card still renders — the list read was not collapsed into the summary read.
  const txt = await section.innerText();
  for (const r of SEED) expect(txt).toContain(r.user);
});

test('an unreviewed listing says so only once the read has settled', async ({ page }) => {
  const section = await openReviews(page, UNREVIEWED);
  await expect(section.getByTestId('reviews-summary-skeleton')).toHaveCount(0);
  await expect(section).toContainText(/no reviews yet/i);
  // "No reviews yet" is a claim about the listing. The skeleton exists so it is never asserted
  // about a property whose summary is still in flight.
  await expect(section).not.toContainText('0.0');
});

/* NOT COVERED HERE, deliberately: the split between "no reviews" and "no aggregate".

   `ReviewsSection` renders the cards whenever the list read succeeded and draws the aggregate grid
   only when the summary read did, so a failed summary shows reviews without stars instead of
   claiming the listing has none. Forcing that state needs the summary request to fail while the
   list request succeeds — and in mock mode neither is a request: both providers read the same
   localStorage rows, so `page.route(...).abort()` intercepts nothing and the branch is unreachable.
   Writing it here anyway would produce a test that passes because it never entered the branch.
   It belongs in the live config alongside `live-property-integration`; logged in COVERAGE.md. */
