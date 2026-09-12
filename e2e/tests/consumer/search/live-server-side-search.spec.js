import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/* Regression cover for moving the listings search onto the server.
   ------------------------------------------------------------------
   The listings grid used to fetch the entire approved catalogue in one request and then do all of
   the work in the browser: filtering, sorting, the "showing N properties" count, the verified
   tally, and the page slice. Every one of those has moved to `GET /properties`, which now answers
   with one page of results plus the totals for the whole match (`totalElements`,
   `verifiedElements`).

   That change is unusually hard to test, because the old and new implementations agree on almost
   every observable as long as the catalogue fits on a single page. If a search returns 19 rows and
   a page holds 24, then "the server filtered the catalogue and sent you page 1" and "the server
   sent you everything and the browser filtered it" produce byte-identical output. A regression to
   client-side filtering would be invisible.

   So this file leans on the three things that only separate once the catalogue is larger than a
   page - which is what the Wagholi block at the end of the demo seed exists to guarantee:

   1. A filtered search must reach listings that are not on page 1 of the unfiltered search. Half
      the Wagholi stock sits on page 2 of `deal=buy`, so a browser filtering the page it happens to
      be holding returns six of eleven. Only a server that filtered the catalogue returns eleven.

   2. Page 2 must be a DIFFERENT, non-overlapping set of listings that still match the filter. A
      pager that slices a locally held array satisfies the first half of that and not the second
      once the array is itself the wrong array.

   3. The totals must describe the match, not the page. `verifiedElements` is the sharp one: the
      seed deliberately holds more buy listings than fit on a page, and fewer badged than the page
      holds, so a count computed from the rows on screen cannot agree with itself across two pages.

   ## Why nothing here is a hard-coded number

   An earlier draft pinned the exact totals (29 buy, 19 badged, 4 rent flats) and was green when run
   alone and red inside the full suite: `live-notes`, `live-post-on-behalf`,
   `live-properties-moderation` and `live-fees-and-photos` all POST approved listings while this
   file runs, so `deal=rent&types=flat` was 4 in isolation and 7 under load. The database is shared
   and the catalogue is a moving target, so an absolute count is not a fact about the product - it
   is a fact about who else happened to be running.

   What survives that is the STRUCTURE of the answer: disjointness, subset, membership,
   non-overlap between pages, and above all the identity `the number the page displays === the
   totalElements the API reports for the same query`. Those hold at any catalogue size, and they
   are exactly the claims a regression to client-side filtering breaks. Every expected value is
   therefore read from the API inside the test that uses it, the same convention
   `qa-location-search.spec.js` states as "expected is never hand-maintained".

   The risk of a derived expectation is that it goes vacuous - `expect(x).toEqual(x)` passes for a
   broken implementation too - so each test carries a guard asserting the fixture is still large
   enough to discriminate (`> 0`, `> PAGE_SIZE`, "some rows are off page 1"). If the seed shrinks,
   these fail loudly on the guard rather than passing quietly on nothing. */

const PAGE_SIZE = 24;

/* Listings seeded by fixture carry a slug; ones another spec POSTs mid-run do not, and their card
   links fall back to the id. Both sides of every comparison below therefore go through this, or a
   concurrently created listing would look like a mismatch between the API and the grid. */
const ref = (p) => p.slug || p.id;

const cards = (page) => page.locator('a[href^="/property/"]');

const slugs = async (page) => {
  const hrefs = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  return hrefs.map((h) => h.split('/').pop());
};

/* Two things about the count line, both learned the hard way by `qa-location-search.spec.js`:
   it is rendered twice (a mobile `sm:hidden` copy and a desktop one), so a plain `.first()` grabs
   the hidden copy and never resolves; and it holds the PREVIOUS query's answer while a refinement
   is in flight, marking that with `aria-busy`. Reading through the busy flag is how that sibling
   spec once compared a pre-filter total against a filtered oracle. */
const settledCount = async (page) => {
  const line = page.locator('main p:visible', { hasText: /Showing/ }).first();
  await line.waitFor({ timeout: 15000 });
  await expect(line).not.toHaveAttribute('aria-busy', 'true', { timeout: 15000 });
  return Number((await line.locator('span.text-teal-400').first().textContent()).replace(/[^\d]/g, ''));
};

const get = async (query) => {
  const res = await fetch(`${API}/properties?${query}`);
  expect(res.ok, `${query} answered ${res.status}`).toBe(true);
  return res.json();
};

test('a filter narrows the catalogue, not the page you are holding', async ({ page }) => {
  /* Wagholi is the whole point of this test. Its buy listings are the oldest rows in the catalogue,
     so the default order puts half of them on page 1 of `deal=buy` and half on page 2. A browser
     filtering its current page therefore has only the first half to work with. The server has all
     of them, and the guard below fails if that ever stops being true. */
  const unfiltered = await get(`deal=buy&size=${PAGE_SIZE}&page=0`);
  const onPageOne = new Set(unfiltered.content.map(ref));

  const filtered = await get('deal=buy&localities=wagholi&size=100');
  expect(filtered.totalElements, 'no Wagholi buy stock - the seed no longer discriminates')
    .toBeGreaterThan(0);

  const beyondPageOne = filtered.content.filter((p) => !onPageOne.has(ref(p)));
  expect(
    beyondPageOne.length,
    'the Wagholi block must straddle the page boundary or this test proves nothing',
  ).toBeGreaterThan(0);

  await page.goto('/listings?deal=buy&loc=Wagholi');
  expect(await settledCount(page)).toBe(filtered.totalElements);
  await expect.poll(async () => (await slugs(page)).sort()).toEqual(filtered.content.map(ref).sort());
});

test('page 2 is a different set of listings that all still match', async ({ page }) => {
  const [first, second] = await Promise.all([
    get(`deal=buy&size=${PAGE_SIZE}&page=0`),
    get(`deal=buy&size=${PAGE_SIZE}&page=1`),
  ]);

  expect(first.totalElements, 'the buy catalogue must not fit on one page')
    .toBeGreaterThan(PAGE_SIZE);
  expect(first.content).toHaveLength(PAGE_SIZE);
  expect(second.content.length).toBeGreaterThan(0);

  const a = new Set(first.content.map(ref));
  const overlap = second.content.filter((p) => a.has(ref(p)));
  expect(overlap, 'page 2 repeated listings from page 1').toEqual([]);

  /* Still matching is the half a naive pager gets wrong: it is easy to produce a second page by
     advancing an offset into a set that was never filtered in the first place. */
  for (const p of second.content) expect(p.deal).toBe('buy');

  await page.goto('/listings?deal=buy');
  await expect.poll(async () => (await slugs(page)).length).toBe(PAGE_SIZE);
  const pageOne = await slugs(page);

  await page.getByRole('button', { name: 'Next page' }).click();
  /* Re-read rather than reusing `second`: a listing posted by another spec between the fetch above
     and this click lands at the top of `newest` and shifts the boundary by one. What is being
     tested is that the grid's page 2 is the server's page 2, whatever the server currently says. */
  await expect.poll(async () => (await slugs(page)).sort(), { timeout: 15000 }).toEqual(
    ((await get(`deal=buy&size=${PAGE_SIZE}&page=1`)).content.map(ref)).sort(),
  );
  expect(await slugs(page)).not.toEqual(pageOne);
});

test('the totals describe the whole match, not the page on screen', async ({ page }) => {
  /* Both totals must be identical on page 1 and page 2 - which is only possible if the server
     counted the match. A tally computed from the rows the browser is holding cannot report the
     same badged count twice, and the guards below keep that from being trivially satisfiable:
     the match has to be bigger than a page, and some of it has to be unbadged. */
  const [first, second] = await Promise.all([
    get(`deal=buy&size=${PAGE_SIZE}&page=0`),
    get(`deal=buy&size=${PAGE_SIZE}&page=1`),
  ]);

  expect(first.totalElements).toBeGreaterThan(PAGE_SIZE);
  expect(first.verifiedElements).toBeGreaterThan(0);
  expect(
    first.verifiedElements,
    'every buy listing is badged, so `verifiedElements` cannot be told apart from the total',
  ).toBeLessThan(first.totalElements);

  expect(second.totalElements).toBe(first.totalElements);
  expect(second.verifiedElements).toBe(first.verifiedElements);

  /* And the count line is drawn from that, not from `results.length`. A number larger than the
     cards on screen is exactly the disagreement the old implementation could not produce. */
  await page.goto('/listings?deal=buy');
  const shown = await settledCount(page);
  expect(shown).toBe((await get(`deal=buy&size=${PAGE_SIZE}&page=0`)).totalElements);
  expect(shown).toBeGreaterThan(PAGE_SIZE);
  expect(await slugs(page)).toHaveLength(PAGE_SIZE);
});

test('a narrowed search reports its own smaller total, not the catalogue', async ({ page }) => {
  /* The complement of the test above, and the one that fails if the count line is wired to the
     unfiltered response: refining must move the number DOWN, and to the filtered match rather than
     to the number of cards that survived on screen. */
  await page.goto('/listings?deal=buy');
  const all = await settledCount(page);
  expect(all).toBe((await get('deal=buy&size=1')).totalElements);

  await page.goto('/listings?deal=buy&loc=Wagholi');
  const narrowed = await settledCount(page);
  expect(narrowed).toBe((await get('deal=buy&localities=wagholi&size=1')).totalElements);
  expect(narrowed, 'the Wagholi filter did not narrow anything').toBeLessThan(all);
});

/* The type chips are the other half of moving search to the server, and the half with no live cover
   until now. `property_type` is free text a poster chose - "Flat", "Apartment", "Penthouse",
   "Studio", "PG", "Independent House" - so the browser used to decide what a chip meant by matching
   that string against an alias list. The server now carries a generated `property_type_key` column
   (V98), a commercial-use key (V99) and a share type (V100), and the chips send facet values instead
   of a vocabulary. These tests pin the two rules that vocabulary encodes and that a "returns fewer
   rows" assertion would not notice. */

test('the Flat chip is a family, not a string match', async () => {
  /* A penthouse is a flat to a shopper, and `p5023` is stored as "Penthouse". If the chip ever goes
     back to comparing `property_type` to the word "flat", this row silently disappears from the
     most-used search on the site. Membership, not count: which OTHER rows are in the family depends
     on what the rest of the suite has posted. */
  const flats = await get('deal=buy&types=flat&size=100');

  const penthouse = flats.content.find((p) => p.slug === 'p5023');
  expect(penthouse, 'the Penthouse dropped out of the Flat chip').toBeDefined();
  expect(penthouse.propertyType).toBe('Penthouse');

  /* The family is a family and not everything: a commercial unit and a plot are both `deal=buy`
     and neither is a flat, so a chip that had degenerated into a no-op would fail here. */
  const everything = await get('deal=buy&size=1');
  expect(flats.totalElements).toBeLessThan(everything.totalElements);
});

test('a PG is not a flat, and the two chips do not overlap', async () => {
  /* PG rooms are posted under a "Flat" shape often enough that string matching used to pull them
     into flat searches - a shopper looking for a home to rent got shared rooms. They are separate
     products (a PG has single/double/triple occupancy; a flat does not), so the chips must be
     disjoint in both directions. */
  const [flats, pgs] = await Promise.all([
    get('deal=rent&types=flat&size=100'),
    get('deal=rent&types=pg&size=100'),
  ]);

  expect(flats.totalElements, 'no rent flats - nothing to overlap').toBeGreaterThan(0);
  expect(pgs.totalElements, 'no PGs - nothing to overlap').toBeGreaterThan(0);

  const flatRefs = new Set(flats.content.map(ref));
  const overlap = pgs.content.map(ref).filter((s) => flatRefs.has(s));
  expect(overlap, 'a PG surfaced under the Flat chip').toEqual([]);

  /* `p5033` is a PG posted with a `property_type` of "Flat", which is the row string matching used
     to get wrong in both directions at once. */
  expect(pgs.content.map((p) => p.slug)).toContain('p5033');
  expect(flats.content.map((p) => p.slug)).not.toContain('p5033');
});

test('the commercial sub-filter narrows within commercial, and stays inside it', async () => {
  /* Commercial listings share one chip and are told apart by use - office, shop, warehouse. The
     sub-filter is a second canonical column rather than a widening of the type key (BN), so the
     result must be a strict subset of the commercial match, not a fresh search over the catalogue
     that happens to include non-commercial rows with "office" somewhere in their text. */
  const [all, offices] = await Promise.all([
    get('deal=buy&types=commercial&size=100'),
    get('deal=buy&types=commercial&commercialUses=office&size=100'),
  ]);

  expect(offices.totalElements, 'no commercial offices - the sub-filter proves nothing')
    .toBeGreaterThan(0);
  expect(
    offices.totalElements,
    'every commercial listing is an office, so "narrows" is unfalsifiable here',
  ).toBeLessThan(all.totalElements);

  const commercial = new Set(all.content.map(ref));
  for (const p of offices.content) expect(commercial).toContain(ref(p));
});

/* The furnishing chip is the same shape of defect as the type chips, caught later and from the
   other direction. The contract calls a half-furnished home `semi-furnished`; every catalogue in
   the browser calls it `semi`. `toFacetQuery` forwarded the UI word untranslated, so the request
   went out as `furnishings=semi` and Postgres matched no row.

   Nothing caught it, and the reason is worth stating because it is structural rather than an
   oversight. In mock mode the client matcher compares the query against the view-model, and the
   view-model has already been translated back to `semi` — so both halves of the browser agreed
   with each other and disagreed only with the database. And the failure is silent by construction:
   an empty result set is what a genuinely narrow filter looks like, so the page rendered "no
   matches" rather than an error. Two of the three chips also worked (`unfurnished` and `furnished`
   are spelled the same on both sides), which is what made the axis look wired.

   These two tests therefore assert against the SERVER, through the real filter UI, because that is
   the only place the disagreement was ever visible. */

test('the Furnishing chip sends a word the database knows', async () => {
  /* Below the UI on purpose: every contract value must select a non-empty, self-consistent set. If
     the vocabulary drifts again the request stops matching and this fails on the guard rather than
     passing quietly on an empty page. */
  const all = await get('deal=rent&types=flat&size=1');
  expect(all.totalElements, 'no rent flats - nothing to narrow').toBeGreaterThan(0);

  const semi = await get('deal=rent&types=flat&furnishings=semi-furnished&size=100');
  expect(
    semi.totalElements,
    'no semi-furnished rent flats. That is the commonest answer in this market, so an empty match'
    + ' means the word on the wire is not the word the column holds.',
  ).toBeGreaterThan(0);
  for (const p of semi.content) expect(p.furnishing).toBe('semi-furnished');

  /* And the UI spelling must NOT work, or the assertion above proves only that the server ignores
     the parameter. `semi` is what the browser used to send. */
  const uiWord = await get('deal=rent&types=flat&furnishings=semi&size=1');
  expect(
    uiWord.totalElements,
    '`furnishings=semi` now matches rows, so the server has gained the UI spelling and the'
    + ' translation table in facetQuery/propertyMapper is the thing that is now wrong.',
  ).toBe(0);
});

test('ticking Semi-Furnished narrows the grid instead of emptying it', async ({ page }) => {
  /* The whole bug, end to end, in the terms the shopper experiences it: the count must come down
     and must land on the server's answer for the same query. An untranslated chip lands on zero,
     which the page renders as "no matches" - indistinguishable from a filter that legitimately
     found nothing, which is why this needed asserting rather than eyeballing. */
  await page.goto('/listings?deal=rent&type=flat');
  const before = await settledCount(page);
  expect(before).toBeGreaterThan(0);

  /* The label, not the input: `.custom-cb` is `display: none` and the visible control is drawn by
     `label::before`. And the id, not the accessible name — the mobile drawer mounts a second copy
     of every filter (prefixed `m-`) earlier in the DOM, so a by-name lookup finds the off-screen
     one and waits forever on it. */
  await page.locator('label[for="furn-semi"]').click();

  const oracle = (await get('deal=rent&types=flat&furnishings=semi-furnished&size=1')).totalElements;
  await expect.poll(async () => settledCount(page), { timeout: 15000 }).toBe(oracle);
  expect(oracle, 'the chip emptied the grid').toBeGreaterThan(0);
  expect(oracle, 'every rent flat is semi-furnished, so "narrows" is unfalsifiable here')
    .toBeLessThan(before);
});

