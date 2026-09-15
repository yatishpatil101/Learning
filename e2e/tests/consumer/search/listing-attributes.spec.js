import { test, expect } from '@playwright/test';

/* Twelve card-level attributes were derived in the browser from `fnvHash(listing.id)`, so the grid
   filtered real homes by arithmetic on their slug. Every test below pins an EXACT set of slugs, each
   one the hash provably cannot produce — "the filter returns fewer rows" passes under both. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const cards = (page) => page.locator('a[href^="/property/"]');

/* Identity of every rendered card, sorted so the assertion does not also depend on
   the sort order (which `newest` makes a function of seed timestamps). */
const slugs = async (page) => {
  const hrefs = await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  return hrefs.map((h) => h.replace('/property/', '')).sort();
};

/* The grid renders from `useDeferredValue(f)` while the URL applies immediately, so
   a one-shot read can catch the pre-filter paint and pass by luck. Always poll. */
const expectSlugs = async (page, expected) => {
  await expect.poll(async () => await slugs(page), { timeout: 15000 }).toEqual([...expected].sort());
};

/* ---------------------------------------------------------------- age / floor */

/* Seeded: p5133=1, p5130=2, p5023=3 are the only approved buy rows aged 0-3; hash-implied ages are
   -22, 0 and -6, so hashing yields {p5130} alone. p5010 and p5000 carry NO age deliberately — if
   they appear here, an unstated age is being coerced to 0 and swept into "brand new" again. */
test('Age filter matches the age the server stated, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy&age=0-3`);
  await expectSlugs(page, ['p5133', 'p5130', 'p5023']);
});

/* Seeded floors: p5008=9, p5120=11 are the only approved buy rows on floor 8+.
   Hash-implied floors are -36 and -25, so under the hash neither can appear and
   p5013 (hash floor 18, seeded floor 2) takes their place - a disjoint set. */
test('Floor filter matches the floor the server stated, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy&floor=8-40`);
  await expectSlugs(page, ['p5008', 'p5120']);
});

/* ------------------------------------------------- trust claims (the sharp end) */

/* "Society verified" and "Conveyance done" are legal assertions about a building's paperwork, so a
   buyer filtering on them must not be reading a coin flip. p5120 is the discriminator for both: the
   seed says verified, the hash said not, making this set unreachable by hashing. */
test('Society-verified filter reflects the seeded flag, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy&v=society`);
  await expectSlugs(page, ['p5120', 'p5133', 'p5023']);
});

/* p5133 is the discriminator: seeded conveyance FALSE, hash TRUE. Because the
   signed-shift bug made `(h >> 14) % 5 < 2` true for every negative remainder, the
   hash marked 13 of the 14 sampled slugs as conveyed - so a green here specifically
   proves the broken near-universal TRUE is gone. */
test('Conveyance-done filter reflects the seeded flag, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy&v=conveyance`);
  await expectSlugs(page, ['p5120', 'p5008', 'p5023']);
});

/* -------------------------------------------------------------- rental policy */

/* Seeded: p5121 and p5123 are the only rentals stating they accept families.
   The hash put `family` on p5008, p5130, p5121 and p5033 and gave p5123
   `bachelor-female`, so the sets overlap in exactly one row and differ in the rest. */
test('Preferred-tenants filter reflects the stated policy, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&tenants=family`);
  await expectSlugs(page, ['p5121', 'p5123']);
});

/* Availability is the clearest evidence of the signed-shift bug: `(h >> 4) % 3`
   went negative for both of these slugs, so `['now','15','30'][-1]` was `undefined`
   and NEITHER listing matched any availability option. The hash-era result for this
   URL was the empty set - not a different set, no set at all. */
test('Availability filter reflects the stated date, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&availfrom=now`);
  await expectSlugs(page, ['p5121', 'p5007']);
});

/* Seeded pet-friendly: p5033 and p5122. The hash additionally claimed p5007 and
   p5123 allow pets - a listing being told it welcomes animals when its owner never
   said so. */
test('Pet-friendly filter reflects the stated policy, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&pets=1`);
  await expectSlugs(page, ['p5033', 'p5122']);
});

/* --------------------------------------------------------------- flatmates */

/* shareType is now DERIVED, but from a stated fact: a listing offering a room
   arrangement (`room`) is a flat share, and one stating none is an ordinary
   rental belonging under neither chip. The old code chose with `h % 2`, a
   literal coin flip on the slug that named the wrong rows either way. */
test('Flatmates type comes from the stated room, not a coin flip on the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=flatmates`);
  await expectSlugs(page, ['p5007', 'p5014', 'p5033', 'p5122']);
});

/* ------------------------------------------------------- the unstated listings */

/* p5010 and p5000 carry no attributes and p5130 no floor — an independent house sits in no building.
   "Unknown" is not a value that can match a filter, so they must be absent from every narrowed
   search; this is the assertion that catches a well-meaning `?? 0` / `?? false` creeping back. */
test('listings that state nothing are excluded from narrowed searches, not defaulted in', async ({ page }) => {
  for (const url of ['deal=buy&age=0-3', 'deal=buy&floor=8-40', 'deal=buy&v=society', 'deal=buy&v=conveyance']) {
    await page.goto(`${BASE}/listings?${url}`);
    await cards(page).first().waitFor({ timeout: 15000 });
    expect(await slugs(page), `p5010 states no attributes and must not match ${url}`).not.toContain('p5010');
  }

  await page.goto(`${BASE}/listings?deal=buy&floor=8-40`);
  await expect.poll(async () => await slugs(page), { timeout: 15000 })
    .not.toContain('p5130');

  for (const url of ['deal=rent&tenants=family', 'deal=rent&availfrom=now', 'deal=rent&pets=1']) {
    await page.goto(`${BASE}/listings?${url}`);
    await cards(page).first().waitFor({ timeout: 15000 });
    expect(await slugs(page), `p5000 states no attributes and must not match ${url}`).not.toContain('p5000');
  }
});
