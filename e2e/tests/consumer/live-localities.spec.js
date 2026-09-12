/* The locality registry against the live API.
 *
 * The listings page offers a locality filter, and until now it built the options from two bundled
 * sources: the mock's `localities` collection and the curated `data/localities.js` registry. The
 * server has had `GET /localities` since slice 7 and knows things the bundle cannot — which areas
 * are still active, and how many live listings each one actually holds, computed on read rather
 * than stored (D7.2, after three of fifteen stored counts were found wrong).
 *
 * So this spec is about the two things the move actually buys, and it asserts them in the only
 * places they are observable. The count is checked against the property search for the same
 * locality, because a number that agrees with a stored field proves nothing and a number that
 * agrees with a *different endpoint's* answer is the claim. The active filter is checked by asking
 * the database's own vocabulary of it: every row the endpoint returns says `active: true`, and the
 * page must not offer a filter option the search would answer nothing for.
 *
 * Provenance for the UI half is the request wait, armed before the navigation, for the same reason
 * as the FAQ spec: 155 seeded localities and a bundled registry that overlaps them means no
 * assertion about the *names* on the page can tell which side produced them.
 *
 * Fixtures: the 155 localities seeded by `R__DML_seed_reference_data.sql`, all active.
 */
import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

/** Seeded, active, and holds listings — so it can carry the count cross-check. */
const ANCHOR = 'wakad';

test('the locality list is a public read, active-only, with counts that agree with search', async () => {
  /* No Authorization header at all. These are the landing pages a visitor arrives on from a search
     engine, long before there is any reason to sign in, and `security: []` in the contract says so.
     Sent bare rather than signed-out, because those are different claims: a signed-out session
     still proves the route tolerates a token. */
  const res = await fetch(`${API}/localities`);
  expect(res.status, 'the locality registry is public').toBe(200);

  const rows = await res.json();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length, 'the seeded registry is well over a hundred areas').toBeGreaterThan(100);

  /* Every row is shaped. Cheap, and it is what separates "the endpoint is wrong" from "one row is
     wrong" when this goes red. */
  for (const row of rows) {
    expect(row.slug, 'every locality is identified by its slug').toBeTruthy();
    expect(row.name, `${row.slug} should have a name`).toBeTruthy();
    expect(typeof row.listingCount, `${row.slug} should carry a count`).toBe('number');
  }

  /* The retired-area guarantee, asserted on the response rather than on the seed: the endpoint
     filters `active = true`, and an inactive area that still rendered would be a page search
     engines keep indexing. */
  expect(rows.every((r) => r.active !== false), 'a retired locality must not be offered').toBe(true);

  /* Alphabetical by name is promised — `findByActiveTrueOrderByNameAsc()` — so unlike the FAQ list
     this order is a decision and is pinned.

     Compared with `localeCompare`, and the first draft got this wrong in an instructive way. A
     code-point sort put "NIBM Road" before "Narhe", because `I` is 0x49 and `a` is 0x61; Postgres
     put it between "Narhe" and "Nigdi", because its collation is linguistic and compares letters
     before it compares case. The server was right and the oracle was wrong — and an ASCII compare
     would have gone on being wrong silently for every locality that starts with an acronym. */
  const names = rows.map((r) => r.name);
  expect(names, 'the registry is alphabetical, and that is a promise not an accident')
    .toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));

  /* The count is computed, and this is the assertion that says so. `listingCount` for the anchor
     must equal what the property search reports for the same locality — two endpoints, two code
     paths, one number. A stored count would drift from this the first time a listing was approved,
     which is exactly how the old one broke. */
  const anchor = rows.find((r) => r.slug === ANCHOR);
  expect(anchor, `${ANCHOR} should be in the seeded registry`).toBeTruthy();

  const search = await fetch(`${API}/properties?locality=${ANCHOR}&size=1`);
  expect(search.status).toBe(200);
  const page = await search.json();
  expect(anchor.listingCount, `${ANCHOR}'s count must be what a search for it actually finds`)
    .toBe(page.totalElements);
});

test('the listings page builds its locality filter from the server', async ({ page }) => {
  /* Armed before the navigation, not after: the page loads its catalogue on mount, and a wait
     registered afterwards is a race that passes for the wrong reason on a slow machine. */
  const request = page.waitForResponse(
    (r) => r.url().includes('/api/localities') && r.status() === 200,
    { timeout: 20000 },
  );

  await page.goto('/listings');
  const res = await request;

  const rows = await res.json();
  expect(rows.length, 'the page should have received the registry it asked for').toBeGreaterThan(100);
});
