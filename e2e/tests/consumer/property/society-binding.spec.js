import { test, expect } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

/* The Society section appears exactly when the listing is bound (`properties.society_slug`). The unbound half
   asserts the heading is ABSENT: that is the real guard against an invented society. */

/* Baner, bound in the seed. Expected values come from `/societies/{slug}`, so catalogue drift can't pass. */
const BOUND = 'p5013';

/* Undri, deliberately unbound: approved and residential, so only the Society section differs. */
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

  // The home count lives only on the society row, so a generic "Building" can't fake it; match the phrase.
  await expect(block).toContainText(`${soc.units} homes`);
  await expect(block.getByText(/Verified Society/i)).toHaveCount(0);

  // Check the href rather than click: the link must point at the bound society, not a dead end.
  await expect(block.getByRole('link', { name: new RegExp(soc.name, 'i') }))
    .toHaveAttribute('href', `/society/${soc.slug}`);
});

test('an unbound listing shows no Society section at all — not an emptied one', async ({ page }) => {
  const listing = await json(`/properties/${UNBOUND}`);
  // Premise check: if the seed ever binds this listing, the absence assertions would pass for the wrong reason.
  expect(listing.societySlug ?? null, 'the seed listing gained a binding, so this proves nothing').toBeFalsy();

  await openAmenities(page, UNBOUND);

  await expect(page.getByRole('heading', { name: HEADING })).toHaveCount(0);
  // The tiles must be gone too: they were fed by `ownershipVerified`, unrelated to a society's registration.
  await expect(page.getByText(/Conveyance Deed/i)).toHaveCount(0);
  await expect(page.getByText(/Verified Society/i)).toHaveCount(0);
  // And no link is offered into a society this home was never said to be in.
  await expect(page.locator('a[href^="/society/"]')).toHaveCount(0);
});
