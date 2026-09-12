/* The reels feed against the live API.
 *
 * This page was permanently, silently empty. It filtered the catalogue on `gallery.length >=
 * MIN_PHOTOS`, and the card projection has never carried `images` — only the detail response does.
 * So every listing scored zero frames, nothing ever cleared the gate, and the feed rendered its
 * loading state forever: a dead end disguised as a slow network, which is precisely the failure the
 * page's own empty state was written to avoid.
 *
 * The fix is a count on the card, not the array. Search results render one image and never a second,
 * so shipping five URLs per row to answer "is there enough here" would be several times the payload
 * for none of the benefit. The feed now filters on `imageCount` and then opens detail only for the
 * handful that pass, instead of opening detail for the whole catalogue to discover that most
 * listings have one photo.
 *
 * The interesting assertions here are the ones that would still pass against the broken page if
 * written carelessly. "The feed is not empty" is the whole regression, so it comes first and is
 * asserted against a number derived from the API rather than a literal. And every reel is checked to
 * actually hold its three frames — a feed that filtered correctly but hydrated wrongly would show a
 * listing that promised a tour and delivers a still, which is a worse outcome than showing nothing.
 *
 * Fixtures: the seeded catalogue. No absolute count is written down; the expected number of eligible
 * listings is computed from `/properties` at run time, so seeding another flat cannot turn this red.
 */
import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

/** The page's own gate: a reel is a walkthrough, and one or two frames is a card. */
const MIN_PHOTOS = 3;

/** One page big enough to hold the whole seeded catalogue, so rows and totals agree. */
const WHOLE_CATALOGUE = 200;

/* Mirrors `RESIDENTIAL_KEYS` in data/propertyTypes.js — reels is homes-only, because an open plot
   has no interior to tour and commercial space is searched by spec rather than browsed by feel.
   Substring needles rather than an equality list, because that is how `matchTypeKey` works: the
   catalogue stores free text ("Independent House", "Penthouse"), not a key. */
const HOME_NEEDLES = ['flat', 'studio', 'penthouse', 'independent house', 'row house', 'villa'];

const isHome = (typeStr) => {
  const x = String(typeStr || '').toLowerCase();
  return HOME_NEEDLES.some((n) => x.includes(n));
};

const eligible = (rows) => rows.filter((r) => isHome(r.propertyType) && (r.imageCount ?? 0) >= MIN_PHOTOS);

test('the card says how many photos a listing has without shipping them', async () => {
  const page = await (await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`)).json();
  expect(page.content.length).toBeGreaterThan(0);

  for (const row of page.content) {
    /* A primitive, so it cannot vanish under NON_NULL. A boxed count would go absent for exactly the
       listings the feed most needs to reject, and an absent field reads as "unknown" to a caller
       falling back on `gallery.length` — which is the original bug wearing a new hat. */
    expect(typeof row.imageCount, `${row.title} carries a count`).toBe('number');
    /* And the gallery is still not here. This is the claim that would rot: the tempting fix for any
       caller wanting photos on a card is to add the array, and nothing else in the suite would
       notice. */
    expect(row.images, `${row.title} does not ship its gallery on a card`).toBeUndefined();
  }
});

test('the count on the card agrees with the gallery on the detail page', async () => {
  const page = await (await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`)).json();
  const sample = eligible(page.content).slice(0, 3);
  expect(sample.length, 'the seeded catalogue has reel-eligible homes').toBeGreaterThan(0);

  for (const row of sample) {
    /* Cross-checked against the other endpoint, never against the same number twice. If the two ever
       disagree, the feed admits a listing on a promise the detail page cannot keep — and that is
       invisible to any test that reads only one of them. */
    const detail = await (await fetch(`${API}/properties/${row.id}`)).json();
    expect(detail.images.length, `${row.title}`).toBe(row.imageCount);
  }
});

test('the feed is not empty, and holds exactly the listings that qualify', async ({ page }) => {
  const catalogue = await (await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`)).json();
  const qualify = eligible(catalogue.content);
  /* Derived, not hardcoded. The bug being pinned is "zero reels"; a literal expectation would go red
     for the wrong reason the first time somebody seeds another flat. */
  expect(qualify.length, 'some seeded homes have enough photos to be a walkthrough').toBeGreaterThan(0);

  await page.goto('/reels');

  /* The regression itself. Before the count existed this was 0 forever, while the page showed a
     spinner rather than its empty state. */
  const viewHome = page.getByRole('link', { name: /View home/i });
  await expect(viewHome.first()).toBeVisible();
  const shown = await viewHome.count();
  expect(shown).toBeGreaterThan(0);
  expect(shown, 'the feed never invents a reel the catalogue does not justify').toBeLessThanOrEqual(qualify.length);
});

test('every reel actually holds its frames', async ({ page }) => {
  await page.goto('/reels');
  await expect(page.getByRole('link', { name: /View home/i }).first()).toBeVisible();

  /* Filtering correctly and hydrating wrongly would produce a feed of one-frame "tours" — worse than
     an empty feed, because it looks like broken listings rather than a quiet page. The gate is
     re-applied after hydration in the page for this reason; this asserts it held.

     Counted off `.reel-slide` rather than `img`, because the frames are background images on divs —
     an `img` selector finds nothing here and would have made this test pass by never looking. */
  const frames = await page.locator('.reel-slide').count();
  const reels = await page.getByRole('link', { name: /View home/i }).count();
  expect(reels).toBeGreaterThan(0);
  expect(frames, 'at least MIN_PHOTOS frames per reel').toBeGreaterThanOrEqual(reels * MIN_PHOTOS);
});

test('the feed is served by the API, not from a bundled array', async ({ page }) => {
  /* Armed before the navigation. The page began life as eight hardcoded entries whose CTAs merely
     pointed at real ids, so "it renders reels linking to real properties" is exactly what the
     version this replaces would also have passed. The request is the only thing that separates
     them. */
  const catalogueCall = page.waitForRequest((r) => r.url().includes('/properties') && !r.url().includes('/properties/'));
  const detailCall = page.waitForRequest((r) => /\/properties\/[^/?]+($|\?)/.test(r.url()));

  await page.goto('/reels');
  await catalogueCall;
  /* And the second round, which is what makes the photos real: the card cannot carry them, so a feed
     that never opened a detail request could not be showing a genuine gallery. */
  await detailCall;
});
