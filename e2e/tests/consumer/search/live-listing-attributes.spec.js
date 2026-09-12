import { test, expect } from '@playwright/test';

/* Regression cover for the listing-attribute fabrication sweep.
   ------------------------------------------------------------------
   Twelve card-level attributes - age, floor, total floors, facing, room type,
   preferred tenants, availability, pets, PG sharing, share type, society-verified
   and conveyance-done - used to be INVENTED in the browser from `fnvHash(listing.id)`,
   because the card payload (PropertySummary) never carried them. The listings grid
   therefore filtered real homes by arithmetic on their slug: a search for "0-3 years
   old" returned whichever properties happened to hash into that bucket.

   Two things make that worth a dedicated regression file rather than a line in an
   existing spec:

   1. The fabrication was not merely fake, it was ARITHMETICALLY BROKEN. `fnvHash`
      returns a uint32, but the derivations used a signed `>>`. For any slug whose
      hash has the high bit set - 14 of the 17 rows sampled - `(h >> 16) % 26` went
      NEGATIVE. Listings advertised "age -18" and "floor -31", were silently dropped
      from every narrowed Age/Floor search (a negative can never clear a lower bound
      of 0), matched no availability option at all (`['now','15','30'][-2]` is
      `undefined`), and - because a negative remainder always satisfies `< 2` - were
      unconditionally badged "conveyance done" instead of the ~40% the comment
      promised. The author had diagnosed this exact hazard one line away, on
      PG_SHARING, and fixed it there alone.

   2. A test that merely asserts "the filter returns fewer rows" passes under BOTH
      implementations. The land_use defect survived precisely that way: the obvious
      assertion was green while the browser was guessing.

   So every test below pins an EXACT set of slugs, and each set is one the hash
   provably cannot produce. The hash-implied values are quoted per test - they were
   recomputed from the deleted code at `HEAD:...enrichProperties.js` and
   `HEAD:...matchers.js`, not from memory. If someone reinstates a derivation, these
   go red on the identity of the rows, not on their number.

   Deep links rather than clicks: `filtersToParams`/`paramsToFilters` already own the
   URL contract, and driving six dropdowns per assertion would test the dropdowns.
   The chip and menu behaviour is covered in live-type-aware-filters.spec.js. */

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

/* Seeded: p5133=1, p5130=2, p5023=3 are the only approved buy rows aged 0-3.
   Hash-implied ages for those slugs are -22, 0 and -6, so the hash yields {p5130}
   alone - every other row is excluded by a negative age it could never have.
   This also pins the `?? 0` fix: the old pipeline coerced an unstated age to 0,
   which quietly swept every attribute-less listing into "brand new". p5010 and
   p5000 are seeded with NO age precisely to hold that line - if they reappear
   here, null is being coerced again. */
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

/* These two are the reason this sweep mattered beyond tidiness. "Society verified"
   and "Conveyance done" are legal assertions about a building's paperwork, and the
   old code decided them with `(h >> 12) % 2` and `(h >> 14) % 5 < 2`. A buyer
   filtering for conveyed societies was reading a coin flip.

   p5120 is the discriminator for both: the seed says society-verified TRUE, the
   hash said FALSE. So this set is unreachable by hashing - and note the hash also
   claimed p5008, p5130, p5007 and p5033 were society-verified, none of which are. */
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

/* ------------------------------------------------------------- PG / flatmates */

/* shareType is now DERIVED, but from stated facts: a listing offering occupancy
   (`sharing`) is a PG, one offering only a room arrangement is a flatmate share,
   and one stating neither is an ordinary rental belonging under neither chip. The
   old code chose with `h % 2`, a literal coin flip on the slug.

   p5033 and p5122 invert that flip - the hash called p5033 flatmates and p5122 pg,
   the seed makes p5033 a PG (double + triple) and p5122 a flatmate share (single
   room, no occupancy). Both tests below are therefore red under any regression to
   hashing, and red in a way that names the wrong rows. */
test('PG type comes from stated occupancy, not a coin flip on the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg`);
  await expectSlugs(page, ['p5007', 'p5033']);
});

test('Flatmates type comes from the stated room, not a coin flip on the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=flatmates`);
  await expectSlugs(page, ['p5014', 'p5122']);
});

/* The Sharing filter is stocked from the jsonb array the server sends. p5033 offers
   double AND triple, p5007 only triple - so `triple` returns both and `double`
   returns p5033 alone. That asymmetry is the point: a per-listing hash produced a
   SINGLE occupancy key (`PG_SHARING[...][0]`), so no listing could ever appear
   under two sharing options, and this pair of assertions could not both hold. */
test('Sharing filter reads the occupancy list the server sent', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg&sharing=triple`);
  await expectSlugs(page, ['p5007', 'p5033']);

  await page.goto(`${BASE}/listings?deal=rent&ptype=pg&sharing=double`);
  await expectSlugs(page, ['p5033']);
});

/* ------------------------------------------------------- the unstated listings */

/* The counterpart to every test above. p5010 (villa, buy) and p5000 (villa, rent)
   are seeded with NO attributes at all, and p5130 has an age but no floor - an
   independent house sits in no building, so a floor for it would be a fabrication
   of a different kind.

   Under the hash every one of them carried a full set of confident values. Under
   the fix they must be absent from every narrowed search, because "unknown" is not
   a value that can match a filter. This is the assertion that would catch a
   well-meaning `?? 0` / `?? false` creeping back into the pipeline - which is
   exactly how the fabrication got its foothold the first time. */
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
