import { test, expect } from '@playwright/test';

/* Twelve card-level attributes were once derived in the browser from `fnvHash(listing.id)`, so the
   grid filtered real homes by arithmetic on their slug. Every test below pins an EXACT set of slugs,
   each one the hash provably cannot produce — "the filter returns fewer rows" passes under both.

   Age and floor belong to `unstated-range-disclosure`: an exact set is not the right assertion
   for them once a bound admits the listings that stated no value. */

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

/* Seeded: p5121 and p5123 are the only rentals stating they accept families, and an owner who
   stated no preference at all is open to anyone, so the filter also admits every silent rental.
   That makes an exact set the wrong assertion here — it would grow with the seed — so this pins
   the rule instead: a STATED family policy matches, and a stated NON-family one never does.
   The hash put `family` on p5008, p5130, p5121 and p5033, so the exclusions still defeat it. */
test('Preferred-tenants filter reflects the stated policy, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&tenants=family`);
  await cards(page).first().waitFor({ timeout: 15000 });
  const shown = await slugs(page);
  for (const stated of ['p5121', 'p5123']) {
    expect(shown, `${stated} states it accepts families`).toContain(stated);
  }
  for (const other of ['p5122', 'p5007', 'p5014', 'p5033']) {
    expect(shown, `${other} states a preference that is not family`).not.toContain(other);
  }
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

/* shareType is DERIVED, but from a stated fact: a listing offering a room
   arrangement (`room`) is a flat share, and one stating none is an ordinary
   rental belonging under neither chip. The old code chose with `h % 2`, a
   literal coin flip on the slug that named the wrong rows either way.

   p5165-p5168 are plain Flats. Every earlier share was a converted Studio or
   Penthouse, so `property_type` and `room` agreed on all four and the chip
   could have been reading either; an ordinary 2 BHK offering a room is the
   only shape that tells them apart. */
test('Flatmates type comes from the stated room, not a coin flip on the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=flatmates`);
  await expectSlugs(page, ['p5007', 'p5014', 'p5033', 'p5122', 'p5165', 'p5166', 'p5167', 'p5168']);
});

/* p5010 and p5000 carry no attributes. For a stated FLAG, "unknown" is not a value that can match,
   so they must be absent from every narrowed search; this is the assertion that catches a
   well-meaning `?? false` creeping back.

   Age and floor are deliberately not here. A nullable MEASUREMENT is the opposite case: most of the
   catalogue states neither, so excluding the silent ones deletes the majority on the first nudge of
   a slider. They are kept and counted out instead, which `unstated-range-disclosure` pins.

   `tenants` is not here either, and for a third reason: an empty preference is not silence but an
   answer — the owner will take anyone — so p5000 is expected to match `tenants=family`. */
test('listings that state nothing are excluded from narrowed searches, not defaulted in', async ({ page }) => {
  for (const url of ['deal=buy&v=society', 'deal=buy&v=conveyance']) {
    await page.goto(`${BASE}/listings?${url}`);
    await cards(page).first().waitFor({ timeout: 15000 });
    expect(await slugs(page), `p5010 states no attributes and must not match ${url}`).not.toContain('p5010');
  }

  for (const url of ['deal=rent&availfrom=now', 'deal=rent&pets=1']) {
    await page.goto(`${BASE}/listings?${url}`);
    await cards(page).first().waitFor({ timeout: 15000 });
    expect(await slugs(page), `p5000 states no attributes and must not match ${url}`).not.toContain('p5000');
  }
});
