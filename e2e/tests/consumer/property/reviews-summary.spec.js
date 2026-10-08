import { test, expect } from '@playwright/test';

/* Guards the summary shapes: string-keyed star distribution (off-by-one), sparse category averages (absent, not 0)
   and % would recommend, derived from the list. Failed summary: property-integration (COVERAGE.md). */

const PROP = 'p5013';
const UNREVIEWED = 'p5124';

/* The fixture is in the seed (three p5013 reviews, ratings 5/4/3): the live app never reads draazyPropReviews.
   Author names are seeded users, so a seed rename surfaces here instead of weakening the card assertion. */
const SEED = [
  { user: 'Rahul Mehta', rating: 5, categories: { locality: 5, condition: 4 }, recommend: true, context: 'visit' },
  { user: 'Priya Nair', rating: 4, categories: { locality: 4 }, recommend: true, context: 'tenant' },
  // recommend `null`, not false: an author who skipped the question. Counting them as "would not"
  // is the mistake that drags the headline percentage below what anyone actually said.
  { user: 'Arjun Rao', rating: 3, categories: {}, recommend: null, context: null },
];

async function openReviews(page, id) {
  /* Deep-link `?tab=amenities`: PropertyTabs mounts the reviews block only while that tab is current,
     so on the default tab the summary read never fires. */
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

  /* Scope to the aggregate card: review cards print own ratings and chips, so a section scrape is vacuous. */
  await expect(section.getByTestId('reviews-average')).toHaveText('4.0');

  /* The distribution arrives as string keys drawn from a 0-based array, so an off-by-one lands 5★ on the 4★ bar;
     the asymmetric seed (5/4/3, none on 2/1) makes a shift visible. */
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
  /* Order is the mapper's, not the provider's: the server aggregates alphabetically (order by c.key). */
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

/* Not covered: a failed summary read must leave review cards rendered. Mock providers read localStorage, so
   page.route().abort() intercepts nothing; it belongs with property-integration in the live config. */
