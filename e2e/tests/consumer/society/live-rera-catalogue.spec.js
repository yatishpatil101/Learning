import { test, expect } from '../../../fixtures/live.js';
import { seedStorage } from '../../../helpers/seed.js';
import { API, signedInAsNew } from '../../../helpers/liveAuth.js';

/* Exact RERA values catch fabricated society pages; presence checks pass even when the async
   catalogue has not loaded. */

const SLUG = 'palm-court-panchshil-undri';
const NAME = 'Palm Court';
const LOCALITY = 'Undri';
const BUILDER = 'Panchshil Realty';

/* An unknown slug. Not a typo of a real one — `resolveSociety` follows ops merge redirects, so a
   near-miss could legitimately resolve. */
const UNKNOWN_SLUG = 'zzz-not-a-real-society-baner';

/* Use two database-bound properties because one reviewed society and one unrated society are needed
   to exercise both rating branches. */
const REVIEWED_PROP = 'p5013';
const UNRATED_PROP = 'p5008';

/* This society stays unrated for the whole file; the fresh-review society is written to later. */
const UNRATED_SLUG = 'golden-nest-mahindra-baner';
const UNRATED_NAME = 'Golden Nest';

/* A society with no seeded reviews, for the post-a-review test: it must reach exactly (1)
   afterwards, which a society that already carries the 5+4 fixture never could. */
const FRESH_SLUG = 'green-meadows-baner';
const FRESH_NAME = 'Green Meadows';

const CONSENT = { necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() };

/* Reviews are seeded server-side by society uuid; the 4.5 average catches truncation, rounding and
   count-as-average mistakes. */

/** Force the scroll-reveal classes on: `.reveal` sits at opacity 0 until the observer fires. */
const reveal = (page) => page.evaluate(() => {
  document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible'));
});

/** Open the hub and wait past the curated-rows-only first paint. */
async function openHub(page, slug) {
  await page.goto(`/society/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await reveal(page);
}

/** The stat cell rendered under a given label in the four-up grid. */
const statValue = (page, label) =>
  page.locator('.rd-cell').filter({ has: page.locator('.rd-lbl', { hasText: label }) }).locator('.rd-val');

/** The `/societies` directory card for one society, found by its hub link. */
const gridCard = (page, slug) =>
  page.locator('div.glass').filter({ has: page.locator(`a[href="/society/${slug}"]`) }).first();

/** Search the directory for a society and return its card. */
async function findInDirectory(page, slug, name) {
  await page.goto('/societies');
  await page.getByRole('textbox', { name: /search societies/i }).fill(name);
  const card = gridCard(page, slug);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await reveal(page);
  return card;
}

test.beforeEach(async ({ page }) => {
  await seedStorage(page, { dz_cookie_consent_v1: CONSENT });
});

test('a RERA society hub renders that row\'s real name, locality and specifications', async ({ page }) => {
  await openHub(page, SLUG);

  /* Exact matches are required because the fabricated title contains the real short name. */
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME, { timeout: 15_000 });

  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const localityLink = crumb.getByRole('link', { name: LOCALITY, exact: true });
  await expect(localityLink).toBeVisible();
  await expect(localityLink).toHaveAttribute('href', `/locality/${LOCALITY.toLowerCase()}`);

  // Builder is the hero's own subtitle line, under the `<h1>`, not part of the breadcrumb.
  const hero = page.locator('section').filter({ has: page.getByRole('heading', { level: 1 }) }).first();
  await expect(hero).toContainText(BUILDER);

  /* These catalogue numbers cannot come from a fabricated row; the age suffix moves with the
     clock, but the built year must not. */
  await expect(statValue(page, 'Total units')).toHaveText('1,387');
  await expect(statValue(page, 'Towers')).toHaveText('17');
  await expect(statValue(page, 'Built')).toHaveText(/^2012\s·\s\d+y$/);
});

test('an unknown slug is a 404 from the API and renders an honest placeholder, not a confident society', async ({ page, request }) => {
  /* The page must survive the seam's 404 rather than crash or blank. */
  expect((await request.get(`${API}/societies/${UNKNOWN_SLUG}`)).status()).toBe(404);

  await openHub(page, UNKNOWN_SLUG);

  /* Unknown shared links still render so visitors can report the building, but must not assert
     facts about it. */
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The honest state, and the invitation to fix it.
  await expect(page.getByText('Details not confirmed yet')).toBeVisible();
  await expect(page.getByRole('button', { name: /Help verify/i })).toBeVisible();

  /* No specifications. Each of these was previously printed with an invented value — 3 towers, 160
     units, built 2016, 88% occupancy — indistinguishable from a real row. */
  for (const label of ['Total units', 'Towers', 'Built', 'Occupancy']) {
    await expect(page.locator('.rd-lbl', { hasText: label })).toHaveCount(0);
  }

  /* Unknown societies must not get trust badges or baseline star estimates for buildings nobody
     has confirmed exist. */
  await expect(page.getByText('Society Verified')).toHaveCount(0);
  await expect(page.getByText('(community estimate)')).toHaveCount(0);

  /* Mock and live use different honest sentences here; both must refuse to put a number on an
     unknown society. */
  await expect(page.getByText(/Not rated yet|Rating unavailable right now/).first()).toBeVisible();
  await expect(page.locator('[data-testid="society-rating"]')).toHaveCount(0);
});

test('property page and directory cards report real reviews for a reviewed society and invent none for an unreviewed one', async ({ page }) => {
  const propBlock = () => page.locator('section').filter({ hasText: 'Society Information' }).last();

  await test.step('the property page society block reports reviews written against that society', async () => {
    // The Society block lives on the Amenities & Society tab, not the overview.
    await page.goto(`/property/${REVIEWED_PROP}?tab=amenities`, { waitUntil: 'networkidle' });
    await reveal(page);

    await expect(propBlock()).toContainText('4.5', { timeout: 15_000 });
    await expect(propBlock()).toContainText('2 reviews');
  });

  await test.step('the property page society block invents no rating for a society nobody has reviewed', async () => {
    /* The literal 4.2 is the old fake rating; structural checks alone would miss it returning under
       another constant name. */
    await page.goto(`/property/${UNRATED_PROP}?tab=amenities`, { waitUntil: 'networkidle' });
    await reveal(page);

    await expect(propBlock()).toContainText('Not rated yet', { timeout: 15_000 });
    await expect(propBlock()).not.toContainText('4.2');
    await expect(propBlock().getByTestId('property-society-rating')).toHaveCount(0);
  });

  await test.step('a society with no reviews says so on its directory card, and invents no number', async () => {
    /* No reviews and read-failed are different states; null ratings must not become one-star cards or
       unavailable errors. */
    const card = await findInDirectory(page, UNRATED_SLUG, UNRATED_NAME);

    await expect(card).toContainText('Not rated yet');
    await expect(card).not.toContainText(/\(\d+\)/);
    await expect(card.getByTestId('society-rating')).toHaveCount(0);
    await expect(card.getByTestId('society-rating-unavailable')).toHaveCount(0);
    await expect(card.getByTestId('society-rating-skeleton')).toHaveCount(0);
  });
});

test('a review posted on the hub shows up on that society\'s directory card', async ({ page }) => {
  /* Write through the review seam with a fresh account so the one-review rule and cached sessions
     cannot turn this into a 409 or silent sign-in bounce. */
  await signedInAsNew(page);
  await openHub(page, FRESH_SLUG);

  await page.getByRole('button', { name: 'Review', exact: true }).click();

  /* Wait for the submit button, not the dialog shell; stars clicked before the form settles post
     nothing and still let later assertions look successful. */
  const post = page.getByRole('button', { name: 'Post review' });
  await expect(post).toBeVisible({ timeout: 15_000 });

  // `exact` because the composer's per-aspect rows are labelled "5 star for Safety" and
  // `getByRole`'s name match is a substring one — without it this resolves to six buttons.
  await page.getByRole('button', { name: '5 star', exact: true }).click();

  /* Assert the write, not just composer closure; both success and a silent drop close the dialog. */
  const [created] = await Promise.all([
    page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/api\/reviews\/society\//.test(r.url()), { timeout: 15_000 }),
    post.click(),
  ]);
  expect(created.status()).toBe(201);

  // The composer closes only after the seam round-trip resolves and the hub re-reads.
  await expect(post).toHaveCount(0, { timeout: 15_000 });

  const card = await findInDirectory(page, FRESH_SLUG, FRESH_NAME);
  await expect(card).toContainText('(1)');
  await expect(card).not.toContainText('Not rated yet');
});
