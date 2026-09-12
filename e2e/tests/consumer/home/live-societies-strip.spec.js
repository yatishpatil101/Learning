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

/**
 * Scroll the strip into view and hand back its cards: the fetch is gated on an
 * `IntersectionObserver`, so without this every locator below times out.
 */
async function revealStrip(page) {
  await strip(page).scrollIntoViewIfNeeded();
  return strip(page).locator('a.cat-card');
}

test('every society the home strip shows is the server\'s row, badge included', async ({ page, request }) => {
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

    /* A tick beside a society name is Draazy vouching for the building, so it must be the server's
       registration and conveyance saying so, not the bundle's copy of them. */
    const shouldBeVerified = !!row.verifiedAt
      || (row.source !== 'community' && !!(row.registration && row.conveyance));
    await expect(
      card.locator('p svg'),
      `${slug} should ${shouldBeVerified ? '' : 'not '}carry the verified tick`,
    ).toHaveCount(shouldBeVerified ? 1 : 0);
  }
});

test('the home strip ranks the whole catalogue, not the first page of it', async ({ page, request }) => {
  /* The ranking is client-side, so rather than re-implement it, assert the property a "page 0 of
     the directory" prefix would destroy: some strip society is off the unfiltered first page. */
  const res = await request.get(`${API}/societies?page=0&size=100`);
  expect(res.status()).toBe(200);
  const { content = [], totalElements } = await res.json();
  expect(totalElements, 'a catalogue big enough for this to mean anything').toBeGreaterThan(100);
  const firstPage = new Set(content.map((s) => s.slug));

  await page.goto(BASE);
  const slugs = await renderedSlugs(page);

  const beyond = slugs.filter((s) => !firstPage.has(s));
  expect(
    beyond.length,
    'every strip society was also on page 0 of the unfiltered directory, so the strip is '
    + `indistinguishable from a prefix of it (or the seed put every listed society early): ${slugs.join(', ')}`,
  ).toBeGreaterThan(0);
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
    /* Exact, not `endsWith`: an SPA document navigation to `/societies` would otherwise count as
       a catalogue read and make the first assertion fail on a page that fetched nothing. */
    if (url.pathname === '/api/societies') hits.push(url.search);
  });

  await page.goto(BASE);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(hits, 'the societies read must not start while the hero is on screen').toHaveLength(0);

  await renderedSlugs(page);
  expect(hits.length, 'exactly one read once the strip is reached').toBe(1);
  expect(hits[0], 'one filtered page, not a walk of the directory').toContain('hasListings=true');
});

/** The page's own transform, duplicated so the expectation does not depend on the code under test. */
function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
