import { test, expect } from '../../../fixtures/base.js';

/* Property detail — the Society section is present exactly when the listing is bound to a society.
 *
 * ## The defect (D19)
 *
 * `societyForListing` used to end in a fallback: with no explicit binding it returned
 * `pool[fnvHash(listing.id) % pool.length]` over the listing's locality. That is not a "best guess"
 * — for a locality with three curated societies it is wrong for two listings in three by
 * construction, and the page did not hedge about it. It printed the chosen building's real name,
 * real builder, real tower count, real unit count, real year, real occupancy, a "Society Verified"
 * badge derived from that building's registration and conveyance, and a link to that building's
 * hub, all under a heading about *this* home. A reader had no way to tell it apart from a binding
 * somebody had actually recorded.
 *
 * The binding is now a fact carried by the data — `societySlug`, from `properties.society_slug` on
 * the wire and from the seed in mock — and the fallback is gone.
 *
 * ## Why both directions are asserted here
 *
 * The bound half alone is the assertion the old code already passed: it rendered *a* society, with
 * *a* name, for every listing. What it could never do is render **nothing**. So the unbound half is
 * the real regression guard, and it asserts the heading is ABSENT rather than that the section is
 * empty — an emptied section is the half-measure this decision rejected, because a
 * "Society Information" heading over a generic "Building" still tells the reader this home is in a
 * society and that its paperwork was looked at.
 *
 * Both listings are exact seed ids and the society's values are exact catalogue values, not
 * presence checks: presence is precisely what the fabrication satisfied.
 */

/* Baner, bound to Green Meadows in the seed. The asserted values are that row's, and none of them
   is derivable from the listing — a page that invents a society cannot produce this builder. */
const BOUND = 'P5013';
const BOUND_SOCIETY = 'Green Meadows';
const BOUND_BUILDER = 'Gera Developments';
const BOUND_SLUG = 'green-meadows-baner';
const BOUND_UNITS = '260';

/* Undri, deliberately left unbound by the seed. Approved and residential, so the Amenities tab is
   offered and the Society section is the only thing that distinguishes it from a bound listing —
   this is not a listing that happens to render nothing because the tab is missing. */
const UNBOUND = 'P5010';

const HEADING = /Society Information/i;

/** Force the scroll-reveal classes on: `.reveal` sits at opacity 0 until the observer fires. */
const reveal = (page) => page.evaluate(() => {
  document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible'));
});

async function openAmenities(page, id) {
  await page.goto(`/property/${id}?tab=amenities`, { waitUntil: 'networkidle' });
  await reveal(page);
}

test('a bound listing names the society it is actually in, with that society\'s own specifications', async ({ page }) => {
  await openAmenities(page, BOUND);

  const block = page.locator('section').filter({ hasText: HEADING }).last();
  await expect(block).toBeVisible({ timeout: 15_000 });
  await expect(block).toContainText(BOUND_SOCIETY);
  // The builder is the strongest signal: it exists only on the society row, so it cannot be
  // derived from the listing and a generic "Building" render has nothing to put here.
  await expect(block).toContainText(BOUND_BUILDER);
  await expect(block).toContainText(BOUND_UNITS);
  // And the section is a way through to that society, not a dead end.
  await expect(block.getByRole('link', { name: new RegExp(BOUND_SOCIETY, 'i') }))
    .toHaveAttribute('href', `/society/${BOUND_SLUG}`);
});

test('an unbound listing shows no Society section at all — not an emptied one', async ({ page }) => {
  await openAmenities(page, UNBOUND);

  // The page rendered: the tab it was asked for is here. Without this the assertion below would
  // also pass on a blank page or a 404.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole('heading', { name: HEADING })).toHaveCount(0);
  // The section's furniture is gone too, not merely its heading: these tiles were the part fed by
  // `ownershipVerified`, which is a claim about the seller's title and says nothing whatever about
  // a society's registration or its conveyance deed.
  await expect(page.getByText(/Conveyance Deed/i)).toHaveCount(0);
  await expect(page.getByText(/Verified Society/i)).toHaveCount(0);
  // And no link is offered into a society this home was never said to be in.
  await expect(page.locator('a[href^="/society/"]')).toHaveCount(0);
});
