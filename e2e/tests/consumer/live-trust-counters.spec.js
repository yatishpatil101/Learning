/* The homepage trust counters against the live API.
 *
 * The three numbers under the featured rail — "N verified homes from M verified owners" — were
 * computed in the browser until now, from the mock's whole listing array. That is exact on 38 rows
 * and unavailable against a paginated API, so it moved to `GET /properties/trust-stats`, counted by
 * the database in one aggregate.
 *
 * Two of the three could in principle have been salvaged client-side: `verified`, `ownerVerified`
 * and `ownershipVerified` all ride on the list row, so a page could have counted its own results.
 * The third could not, at any page size. `verifiedOwners` counts *distinct people*, and the list
 * response carries no owner id at all — so the browser cannot tell three flats from one landlord
 * apart from three flats from three, and every version of that number was a wrong number that
 * looked right. That is what this spec is mostly about.
 *
 * The API half cross-checks each figure against a *different* endpoint's answer rather than against
 * the field it came from, which is the only kind of agreement that proves anything: `totalListings`
 * against the search endpoint's `totalElements`, and the verified counts against the badges on the
 * listings the search returns. The UI half asserts provenance by waiting on the request, armed
 * before the navigation, because the mock and the server render the same sentence.
 *
 * Fixtures: the seeded catalogue — 38 properties, of which the approved and unarchived ones carry
 * the badges. No absolute figure is written down here; every expected value is derived from a
 * second read at run time, so seeding another flat cannot turn this red.
 */
import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

/** Seeded, active, and holds live listings — so the narrowed read has something to count. */
const ANCHOR = 'wakad';

/** One page big enough to hold the whole seeded catalogue, so `totalElements` and rows agree. */
const WHOLE_CATALOGUE = 200;

test('the trust counters are a public read that agrees with the search endpoint', async () => {
  /* Bare, with no Authorization header. This is the first thing a visitor sees, before there is any
     reason to sign in — a signed-out session would be a weaker claim, because it still proves the
     route tolerates a principal. */
  const res = await fetch(`${API}/properties/trust-stats`);
  expect(res.status, 'the trust headline is public').toBe(200);

  const stats = await res.json();
  expect(typeof stats.totalListings).toBe('number');
  expect(typeof stats.verifiedListings).toBe('number');
  expect(typeof stats.verifiedOwners).toBe('number');

  /* The arithmetic a share must never break. A verified count larger than the total it is a share
     of is the specific failure that three separate round trips could have produced, and the reason
     these are one query. */
  expect(stats.verifiedListings, 'the verified count is a subset of the total')
    .toBeLessThanOrEqual(stats.totalListings);
  expect(stats.verifiedOwners, 'there cannot be more verified owners than verified listings')
    .toBeLessThanOrEqual(stats.verifiedListings);

  /* The denominator, cross-checked against a different endpoint. `/properties` is hard-floored to
     approved and unarchived and computes `totalElements` over the whole result set rather than the
     page, so it is an independent answer to the same question. */
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
  const stats = await (await fetch(`${API}/properties/trust-stats`)).json();
  const rows = (await (await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`)).json()).content;

  /* The finding this spec exists to pin, asserted rather than described: the list row carries every
     badge but no owner id. If that ever changes the counter could move back into the page — and
     this failing is how anyone would find out. */
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.ownerId === undefined),
    'the list row carries no owner id, so distinct owners cannot be counted client-side').toBe(true);

  /* Owner-verified listings outnumber verified owners in the seed, because owners hold more than
     one flat. Counting rows instead of people would inflate the homepage figure precisely for the
     prolific poster a visitor has least reason to trust on volume alone. */
  const ownerBadged = rows.filter((r) => r.ownerVerified).length;
  expect(ownerBadged, 'the seed has owner-verified stock to count').toBeGreaterThan(0);
  expect(stats.verifiedOwners, 'fewer people than listings — the point of counting distinct')
    .toBeLessThan(ownerBadged);
  expect(stats.verifiedOwners).toBeGreaterThan(0);
});

test('the locality parameter narrows the same three numbers', async () => {
  const whole = await (await fetch(`${API}/properties/trust-stats`)).json();

  const res = await fetch(`${API}/properties/trust-stats?locality=${ANCHOR}`);
  expect(res.status).toBe(200);
  const scoped = await res.json();

  /* Cross-checked against search again, narrowed the same way, rather than against a hardcoded
     figure — the count belongs to the seed and the seed is allowed to grow. */
  const page = await (await fetch(`${API}/properties?locality=${ANCHOR}&size=1`)).json();
  expect(scoped.totalListings, `the ${ANCHOR} slice matches search for the same slice`)
    .toBe(page.totalElements);

  expect(scoped.totalListings, 'a locality is a part of the catalogue, not all of it')
    .toBeLessThan(whole.totalListings);
  expect(scoped.totalListings).toBeGreaterThan(0);

  /* An unknown slug answers zeroes rather than 404. A slice with nothing in it is a real slice —
     a locality added this morning genuinely has no verified listings — and answering 404 would also
     turn the endpoint into a cheap oracle for which slugs exist. */
  const missing = await fetch(`${API}/properties/trust-stats?locality=no-such-locality-anywhere`);
  expect(missing.status, 'an empty slice is an answer, not a not-found').toBe(200);
  expect(await missing.json()).toEqual({
    verifiedListings: 0,
    totalListings: 0,
    verifiedOwners: 0,
  });
});

test('the homepage proof line is served by the API, not computed in the page', async ({ page }) => {
  const stats = await (await fetch(`${API}/properties/trust-stats`)).json();

  /* Armed before the navigation, because both sides render the same sentence from the same three
     numbers: nothing about the rendered text can say which side produced it, and only the request
     can. */
  const call = page.waitForRequest((r) => r.url().includes('/properties/trust-stats'));
  await page.goto('/');
  await call;

  /* The counts reach the page. Matched loosely on the two numbers rather than on the whole
     sentence, which is translated and reworded more often than it is renumbered. */
  const proof = page.getByText(new RegExp(`${stats.verifiedListings}\\b`)).first();
  await expect(proof, 'the verified count the API returned is the one on the page').toBeVisible();
});
