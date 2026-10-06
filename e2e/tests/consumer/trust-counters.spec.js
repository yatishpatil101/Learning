/* Homepage trust counters against the live API: `trustStats` in `GET /bootstrap` is DB-counted and each figure is cross-checked against a different endpoint
 * (`verifiedOwners` counts distinct people, which a client cannot derive). Expected values come from a second read at run time, never literals. */
import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

/** One page big enough to hold the whole seeded catalogue, so `totalElements` and rows agree. */
const WHOLE_CATALOGUE = 200;

async function trustStats() {
  const res = await fetch(`${API}/bootstrap`);
  expect(res.status, 'the trust headline is public').toBe(200);
  return (await res.json()).trustStats;
}

test('the trust counters are a public read that agrees with the search endpoint', async () => {
  /* No Authorization header: this is the visitor's first view, before any reason to sign in. */
  const stats = await trustStats();
  expect(typeof stats.totalListings).toBe('number');
  expect(typeof stats.verifiedListings).toBe('number');
  expect(typeof stats.verifiedOwners).toBe('number');

  /* A verified count above its total is the failure separate round trips could produce; hence one query. */
  expect(stats.verifiedListings, 'the verified count is a subset of the total')
    .toBeLessThanOrEqual(stats.totalListings);
  expect(stats.verifiedOwners, 'there cannot be more verified owners than verified listings')
    .toBeLessThanOrEqual(stats.verifiedListings);

  /* The denominator is cross-checked against `/properties`, which is floored to approved and unarchived and counts `totalElements` over the whole result set. */
  const search = await fetch(`${API}/properties?size=1`);
  expect(search.status).toBe(200);
  const page = await search.json();
  expect(stats.totalListings, 'the total matches what public search says is live')
    .toBe(page.totalElements);

  /* And the numerator, from the badges on the rows themselves. This is the assertion that would
     catch the live predicate being dropped from one clause but not the other. */
  const all = await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`);
  const rows = (await all.json()).content;
  expect(rows.length, 'one page holds the whole seeded catalogue').toBe(page.totalElements);

  const badged = rows.filter((r) => r.ownerVerified || r.ownershipVerified).length;
  expect(stats.verifiedListings, 'the verified count matches the badges on the live rows')
    .toBe(badged);
});

test('verifiedOwners counts people, which is why the page could not compute it', async () => {
  const stats = await trustStats();
  const rows = (await (await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`)).json()).content;

  /* The list row carries every badge but no owner id; if that changes the counter could move into the page. */
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.ownerId === undefined),
    'the list row carries no owner id, so distinct owners cannot be counted client-side').toBe(true);

  /* Owners hold several flats, so counting rows would inflate the figure for the most prolific posters. */
  const ownerBadged = rows.filter((r) => r.ownerVerified).length;
  expect(ownerBadged, 'the seed has owner-verified stock to count').toBeGreaterThan(0);
  expect(stats.verifiedOwners, 'fewer people than listings — the point of counting distinct')
    .toBeLessThan(ownerBadged);
  expect(stats.verifiedOwners).toBeGreaterThan(0);
});

test('the homepage proof line is served by the API, not computed in the page', async ({ page }) => {
  const stats = await trustStats();

  /* Armed before the navigation: the figure can only come from the `/bootstrap` read, since no other
     endpoint serves it. */
  const call = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/bootstrap') && r.ok());
  await page.goto('/');
  await call;

  /* The counts reach the page. Matched loosely on the two numbers rather than on the whole
     sentence, which is translated and reworded more often than it is renumbered. */
  const proof = page.getByText(new RegExp(`${stats.verifiedListings}\\b`)).first();
  await expect(proof, 'the verified count the API returned is the one on the page').toBeVisible();
});
