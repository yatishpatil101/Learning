import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/* Guards that listings search stays server-side: only a catalogue larger than a page tells the two
   apart. Expected values are read from the API because other specs POST into the same database. */

const PAGE_SIZE = 24;

/* Fixture listings carry a slug; ones another spec POSTs mid-run fall back to the id, so both
   sides of every comparison go through this or a concurrent listing looks like a mismatch. */
const ref = (p) => p.slug || p.id;

const cards = (page) => page.locator('a[href^="/property/"]');

const slugs = async (page) => {
  const hrefs = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  return hrefs.map((h) => h.split('/').pop());
};

/* The count line is rendered twice (a mobile `sm:hidden` copy and a desktop one), and it holds the
   previous query's answer while a refinement is in flight — hence the `aria-busy` read. */
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
  /* Wagholi's buy listings are the oldest rows, so default order splits them across pages 1 and 2:
     a browser filtering its current page has only half to work with. */
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
  /* Re-read rather than reusing `second`: a listing posted by another spec shifts the page
     boundary by one, and the claim is that the grid's page 2 is whatever the server says. */
  await expect.poll(async () => (await slugs(page)).sort(), { timeout: 15000 }).toEqual(
    ((await get(`deal=buy&size=${PAGE_SIZE}&page=1`)).content.map(ref)).sort(),
  );
  expect(await slugs(page)).not.toEqual(pageOne);
});

test('the totals describe the whole match, not the page on screen', async ({ page }) => {
  /* Identical totals on both pages are only possible if the server counted the match; the guards
     keep that non-trivial by requiring a match bigger than a page with some of it unbadged. */
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
  /* Fails if the count line is wired to the unfiltered response: refining must move the number
     down to the filtered match, not to the number of cards left on screen. */
  await page.goto('/listings?deal=buy');
  const all = await settledCount(page);
  expect(all).toBe((await get('deal=buy&size=1')).totalElements);

  await page.goto('/listings?deal=buy&loc=Wagholi');
  const narrowed = await settledCount(page);
  expect(narrowed).toBe((await get('deal=buy&localities=wagholi&size=1')).totalElements);
  expect(narrowed, 'the Wagholi filter did not narrow anything').toBeLessThan(all);
});

/* `property_type` is free text a poster chose, so chips send facet values against the generated
   `property_type_key` column rather than matching strings against an alias list in the browser. */

test('the Flat chip is a family, not a string match', async () => {
  /* A penthouse is a flat to a shopper, and `p5023` is stored as "Penthouse". Membership, not
     count: which other rows are in the family depends on what the rest of the suite posted. */
  const flats = await get('deal=buy&types=flat&size=100');

  const penthouse = flats.content.find((p) => p.slug === 'p5023');
  expect(penthouse, 'the Penthouse dropped out of the Flat chip').toBeDefined();
  expect(penthouse.propertyType).toBe('Penthouse');

  /* The family is a family and not everything: a commercial unit and a plot are both `deal=buy`
     and neither is a flat, so a chip that had degenerated into a no-op would fail here. */
  const everything = await get('deal=buy&size=1');
  expect(flats.totalElements).toBeLessThan(everything.totalElements);
});

test('a shared room is not a flat, and the two chips do not overlap', async () => {
  /* Shared rooms are posted under a "Flat" shape often enough that string matching drags them into
     flat searches. They are separate products, so the chips must be disjoint in both directions. */
  const [flats, shares] = await Promise.all([
    get('deal=rent&types=flat&size=100'),
    get('deal=rent&types=flatmates&size=100'),
  ]);

  expect(flats.totalElements, 'no rent flats - nothing to overlap').toBeGreaterThan(0);
  expect(shares.totalElements, 'no shared rooms - nothing to overlap').toBeGreaterThan(0);

  const flatRefs = new Set(flats.content.map(ref));
  const overlap = shares.content.map(ref).filter((s) => flatRefs.has(s));
  expect(overlap, 'a shared room surfaced under the Flat chip').toEqual([]);

  /* `p5033` is a share posted with a `property_type` of "Flat" — the row string matching gets
     wrong in both directions at once. */
  expect(shares.content.map((p) => p.slug)).toContain('p5033');
  expect(flats.content.map((p) => p.slug)).not.toContain('p5033');
});

test('the commercial sub-filter narrows within commercial, and stays inside it', async () => {
  /* Commercial listings share one chip and are told apart by use, in a second canonical column
     (BN), so the result must be a strict subset of the commercial match. */
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

/* The contract spells a half-furnished home `semi-furnished` while the browser spells it `semi`, and
   an untranslated chip fails silently as an empty result — so these assert against the server. */

test('the Furnishing chip sends a word the database knows', async () => {
  /* Below the UI on purpose: every contract value must select a non-empty, self-consistent set, so
     a drifting vocabulary fails on the guard rather than passing on an empty page. */
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
  /* The count must come down and land on the server's answer: an untranslated chip lands on zero,
     which the page renders as "no matches" — indistinguishable from a legitimately empty filter. */
  await page.goto('/listings?deal=rent&type=flat');
  const before = await settledCount(page);
  expect(before).toBeGreaterThan(0);

  /* The label, not the input (`.custom-cb` is `display: none`), and by id, not accessible name:
     the mobile drawer mounts a second copy of every filter earlier in the DOM. */
  await page.locator('label[for="furn-semi"]').click();

  const oracle = (await get('deal=rent&types=flat&furnishings=semi-furnished&size=1')).totalElements;
  await expect.poll(async () => settledCount(page), { timeout: 15000 }).toBe(oracle);
  expect(oracle, 'the chip emptied the grid').toBeGreaterThan(0);
  expect(oracle, 'every rent flat is semi-furnished, so "narrows" is unfalsifiable here')
    .toBeLessThan(before);
});

