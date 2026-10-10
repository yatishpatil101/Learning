import { expect, test } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

/** Live coverage verifies that the home strip renders server catalogue societies. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/** The societies strip, scoped by its own heading — `.cat-card` is shared with the property-type
 *  strip on the same page, which this must not accidentally measure. */
function strip(page) {
  /* `.last()`, not `.first()`: `filter` returns ancestors before descendants, and the outermost
     match would be a wrapper holding the property-type strip as well. */
  return page.locator('section').filter({ hasText: 'Explore Pune societies' }).last();
}

/** The slugs the strip is currently showing, in the order it shows them. */
async function renderedSlugs(page) {
  const cards = await revealStrip(page);
  /* Only the ~10 societies with a live listing are eligible, so "fewer than 8 cards" is a seed fact
     rather than a strip defect — said here so a seed change does not read as a component timeout. */
  await expect(
    cards,
    'the strip fills from societies with live listings; if the seed has fewer than 8, fix the seed',
  ).toHaveCount(8, { timeout: 30_000 });
  const hrefs = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  return hrefs.map((h) => String(h).replace('/society/', ''));
}

/** Scrolls the strip into view: its fetch is gated on an `IntersectionObserver`. */
async function revealStrip(page) {
  await strip(page).scrollIntoViewIfNeeded();
  return strip(page).locator('a.cat-card');
}

test('every society the home strip shows is the server\'s row, with no verified tick', async ({ page, request }) => {
  await page.goto(BASE);
  const slugs = await renderedSlugs(page);

  for (const slug of slugs) {
    /* Read back from outside the browser: a strip built from the bundle can name a society the
       platform does not have, and a 404 here is that caught before a visitor taps it. */
    const res = await request.get(`${API}/societies/${slug}`);
    expect(res.status(), `the strip links to /society/${slug}`).toBe(200);
    const row = await res.json();

    const card = strip(page).locator(`a.cat-card[href="/society/${slug}"]`);
    await expect(card).toHaveText(new RegExp(escapeRegExp(row.name)));
    await expect(card).toHaveText(new RegExp(escapeRegExp(titleCase(row.localitySlug))));

    await expect(card.locator('p svg'), `${slug} must not carry a verified tick`).toHaveCount(0);
  }
});

test('the home strip shows the eight societies with the most homes, ties by name', async ({ page, request }) => {
  const res = await request.get(`${API}/societies?hasListings=true&page=0&size=100`);
  expect(res.status()).toBe(200);
  const { content = [] } = await res.json();
  const expected = [...content]
    .sort((a, b) => (b.listingCount - a.listingCount) || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((s) => s.slug);

  await page.goto(BASE);
  expect(await renderedSlugs(page)).toEqual(expected);
});

test('the strip shows societies you can browse homes in, and the server\'s count of them', async ({ page, request }) => {
  /* Comparing the rendered number against the server's is what keeps `listingCount` server-side: a
     regression to client-side counting still renders a plausible integer. */
  const res = await request.get(`${API}/societies?hasListings=true&page=0&size=100`);
  expect(res.status(), 'GET /societies accepts hasListings').toBe(200);
  const { content = [] } = await res.json();
  const counts = new Map(content.map((s) => [s.slug, s.listingCount]));
  expect(counts.size, 'at least eight societies have live listings').toBeGreaterThanOrEqual(8);

  await page.goto(BASE);
  const slugs = await renderedSlugs(page);

  for (const slug of slugs) {
    const homes = counts.get(slug);
    expect(homes, `${slug} is on the strip, so the filtered read must contain it`).toBeGreaterThan(0);
    const card = strip(page).locator(`a.cat-card[href="/society/${slug}"]`);
    await expect(card, `${slug} should read "${homes} home(s)"`)
      .toHaveText(new RegExp(`${homes} home${homes > 1 ? 's' : ''}\\b`));
  }
});

test('the strip asks for nothing until it is scrolled to', async ({ page }) => {
  /* Zero-then-one, not a timing measurement: "later" is unfalsifiable on a fast machine, and a gate
     that never opened would also record zero. Needs >400px of page above the strip (`rootMargin`). */
  const hits = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/societies/top') hits.push(url.search);
  });

  await page.goto(BASE);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(hits, 'the societies read must not start while the hero is on screen').toHaveLength(0);

  await renderedSlugs(page);
  expect(hits.length, 'exactly one read once the strip is reached').toBe(1);
});

/** The page's own transform, duplicated so the expectation does not depend on the code under test. */
function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
