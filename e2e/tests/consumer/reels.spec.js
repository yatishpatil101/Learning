/* Reels feed against the live API: cards carry `imageCount`, not `images`, so the feed must filter on it instead of rendering empty forever;
 * the expected eligible count is derived from `/properties` at run time and the reel in view must hold its three frames. */
import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

/** The page's own gate: a reel is a walkthrough, and one or two frames is a card. */
const MIN_PHOTOS = 3;

/** One page big enough to hold the whole seeded catalogue, so rows and totals agree. */
const WHOLE_CATALOGUE = 200;

/* Mirrors `RESIDENTIAL_KEYS` in data/propertyTypes.js (reels is homes-only); substring needles because `matchTypeKey` works that way
   and the catalogue stores free text ("Independent House", "Penthouse"). */
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
    /* A primitive so NON_NULL can't drop it: an absent field reads as "unknown" to `gallery.length` fallbacks. */
    expect(typeof row.imageCount, `${row.title} carries a count`).toBe('number');
    /* The gallery array must stay off the card payload; it is the tempting fix and nothing else would notice. */
    expect(row.images, `${row.title} does not ship its gallery on a card`).toBeUndefined();
  }
});

test('the count on the card agrees with the gallery on the detail page', async () => {
  const page = await (await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`)).json();
  const sample = eligible(page.content).slice(0, 3);
  expect(sample.length, 'the seeded catalogue has reel-eligible homes').toBeGreaterThan(0);

  for (const row of sample) {
    /* Cross-check the other endpoint: disagreement admits a listing on a promise the detail page can't keep. */
    const detail = await (await fetch(`${API}/properties/${row.id}`)).json();
    expect(detail.images.length, `${row.title}`).toBe(row.imageCount);
  }
});

test('the feed is served by the API, is not empty, holds exactly the qualifying listings, and every reel holds its frames', async ({ page }) => {
  const catalogue = await (await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`)).json();
  const qualify = eligible(catalogue.content);
  /* Derived, not hardcoded. The bug being pinned is "zero reels"; a literal expectation would go red
     for the wrong reason the first time somebody seeds another flat. */
  expect(qualify.length, 'some seeded homes have enough photos to be a walkthrough').toBeGreaterThan(0);

  /* Armed before navigation; only the request separates live reels from static entries linking to real ids. */
  const catalogueCall = page.waitForRequest((r) => r.url().includes('/properties') && !r.url().includes('/properties/'));
  const detailCall = page.waitForRequest((r) => /\/properties\/[^/?]+($|\?)/.test(r.url()));

  await page.goto('/reels');
  await catalogueCall;
  /* And the second round, which is what makes the photos real: the card cannot carry them, so a feed
     that never opened a detail request could not be showing a genuine gallery. */
  await detailCall;

  /* The regression itself. Before the count existed this was 0 forever, while the page showed a
     spinner rather than its empty state. */
  const viewHome = page.getByRole('link', { name: /View home/i });
  await expect(viewHome.first()).toBeVisible();
  const shown = await viewHome.count();
  expect(shown).toBeGreaterThan(0);
  expect(shown, 'the feed never invents a reel the catalogue does not justify').toBeLessThanOrEqual(qualify.length);

  /* Frames are counted off `.reel-slide` (background images on divs); an `img` selector finds nothing and would pass by never looking.
     Only the reel in view and the next one hydrate their galleries, so the claim is made on the reel in view. */
  await expect
    .poll(() => page.locator('.reel').first().locator('.reel-slide').count(), { message: 'the reel in view never got its gallery' })
    .toBeGreaterThanOrEqual(MIN_PHOTOS);
});

test('the feed opens detail for the reel in view and the next, not the whole feed', async ({ page }) => {
  const details = [];
  page.on('request', (r) => { if (/\/api\/properties\/[^/?]+($|\?)/.test(r.url())) details.push(r.url()); });
  await page.goto('/reels');
  await expect(page.locator('.reel').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  expect(details.length, details.join('\n')).toBeLessThanOrEqual(2);
});
