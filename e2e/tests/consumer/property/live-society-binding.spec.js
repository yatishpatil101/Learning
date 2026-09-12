import { test, expect } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

/* D19 — the Society section appears exactly when the listing is bound to a society, against real
 * HTTP.
 *
 * ## The defect
 *
 * `societyForListing` used to end in a fallback: with no explicit binding it returned
 * `pool[fnvHash(listing.id) % pool.length]` over the listing's locality. That is not a best guess —
 * for a locality with three curated societies it is wrong for two listings in three by construction,
 * and the page did not hedge about it. It printed the chosen building's real name, real builder,
 * real tower count, real unit count, a "Verified Society" badge derived from that building's
 * registration and conveyance, and a link to its hub, all under a heading about *this* home. A
 * reader had no way to tell it apart from a binding somebody had actually recorded.
 *
 * ## Why this runs live
 *
 * The binding is a column — `properties.society_slug` — and the invention was a client-side
 * fallback over a client-side pool. Both halves of the mock version were therefore reading the same
 * seed file: the listing's locality and the society catalogue keyed by it. A fallback that resolves
 * within one JSON file is precisely the thing a test sharing that file is least able to notice. Here
 * the join is the server's, and the expectations are fetched from the API rather than typed in.
 *
 * ## Why both directions are asserted
 *
 * The bound half alone is the assertion the old code already passed: it rendered *a* society, with
 * *a* name, for every listing. What it could never do is render **nothing**. So the unbound half is
 * the real regression guard, and it asserts the heading is ABSENT rather than that the section is
 * empty — an emptied section is the half-measure this decision rejected, because a "Society
 * Information" heading over a generic "Building" still tells the reader this home is in a society
 * and that its paperwork was looked at.
 */

/* Baner, bound in the seed. The asserted values are read back from `/societies/{slug}` rather than
   written down, which is the point rather than tidiness: the fallback's whole trick was producing a
   plausible society, so a test carrying its own copy of the expected name could be satisfied by the
   catalogue drifting underneath it. Fetching them means the only way to pass is for the page and
   the server to name the same building. */
const BOUND = 'p5013';

/* Undri, deliberately unbound. Approved and residential, so the Amenities tab is offered and the
   Society section is the only thing distinguishing it from a bound listing — this is not a listing
   that renders nothing because the tab is missing. */
const UNBOUND = 'p5010';

const HEADING = /Society Information/i;

async function json(path) {
  const res = await fetch(`${API}${path}`);
  expect(res.status, `GET ${path}`).toBe(200);
  return res.json();
}

async function openAmenities(page, id) {
  await page.goto(`/property/${id}?tab=amenities`, { waitUntil: 'networkidle' });
  // `.reveal` sits at opacity 0 until the observer fires, and it never fires for content Playwright
  // reaches instantly.
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });
}

test('a bound listing names the society the server says it is in, with that society\'s own numbers', async ({ page }) => {
  const listing = await json(`/properties/${BOUND}`);
  expect(listing.societySlug, 'the seed listing lost its binding').toBeTruthy();
  const soc = await json(`/societies/${listing.societySlug}`);

  await openAmenities(page, BOUND);

  const block = page.locator('section').filter({ hasText: HEADING }).last();
  await expect(block).toBeVisible({ timeout: 15000 });
  await expect(block).toContainText(soc.name);

  // The home count is the strongest signal available: it lives only on the society row, so it
  // cannot be derived from the listing, and a generic "Building" render has nothing to put here.
  // Asserted as the rendered phrase rather than the bare number so it cannot be satisfied by "330"
  // turning up somewhere else on a page that also carries a price and an area.
  await expect(block).toContainText(`${soc.units} homes`);

  // And the section is a way through to that society, not a dead end. `toHaveAttribute` on the href
  // rather than a click: what matters is that the link points at the bound society and not at
  // whichever one the locality pool would have picked.
  await expect(block.getByRole('link', { name: new RegExp(soc.name, 'i') }))
    .toHaveAttribute('href', `/society/${soc.slug}`);
});

test('an unbound listing shows no Society section at all — not an emptied one', async ({ page }) => {
  const listing = await json(`/properties/${UNBOUND}`);
  // If the seed ever binds this one, the assertions below would pass for the wrong reason — a page
  // correctly showing nothing and a page correctly showing something are indistinguishable once you
  // are only counting absences. So the premise is checked rather than trusted.
  expect(listing.societySlug ?? null, 'the seed listing gained a binding, so this proves nothing').toBeFalsy();

  await openAmenities(page, UNBOUND);

  await expect(page.getByRole('heading', { name: HEADING })).toHaveCount(0);
  // The section's furniture is gone too, not merely its heading: these tiles were the part fed by
  // `ownershipVerified`, which is a claim about the seller's title and says nothing whatever about
  // a society's registration or its conveyance deed.
  await expect(page.getByText(/Conveyance Deed/i)).toHaveCount(0);
  await expect(page.getByText(/Verified Society/i)).toHaveCount(0);
  // And no link is offered into a society this home was never said to be in.
  await expect(page.locator('a[href^="/society/"]')).toHaveCount(0);
});
