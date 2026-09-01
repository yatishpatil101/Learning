import { expect, test } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

/* Whether the home page's society strip is a view of the platform's catalogue or of the one
 * compiled into this build.
 *
 * It was the second: the strip ranked `allSocieties()` — the 348 rows in `data/societies.js` —
 * merged through `resolveSociety`, a lookup into two `localStorage` buckets no live session ever
 * writes. Unlike `/societies`, this did not render anything visibly wrong, and that is worth being
 * precise about rather than overstating: ranked both ways against the live server, the eight cards
 * came out identical, because the seed and the bundle are the same table. The bug was the
 * guarantee, not the pixels — two copies of one table agree only until something changes one of
 * them, and the drift had already begun (a society in the bundle no longer exists on the server,
 * and would link to a hub reading "no such society" if it ever ranked in).
 *
 * That makes this file's job unusual and worth stating: it cannot prove the fix by finding a
 * society the old code missed, because today there isn't one that ranks. What it can do — and what
 * would have been impossible against the bundle — is pin the strip to the server's catalogue, so
 * the day the two disagree, this fails instead of the home page quietly showing the older answer.
 *
 * The two tests are deliberately orthogonal, and their mutations confirm it: breaking the mapper's
 * registration/conveyance fells the first alone, and truncating the provider's paged walk fells the
 * second alone.
 */

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
  const cards = strip(page).locator('a.cat-card');
  await expect(cards).toHaveCount(8, { timeout: 30_000 });
  const hrefs = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  return hrefs.map((h) => String(h).replace('/society/', ''));
}

test('every society the home strip shows is the server\'s row, badge included', async ({ page, request }) => {
  await page.goto(BASE);
  const slugs = await renderedSlugs(page);

  for (const slug of slugs) {
    /* Read back from outside the browser. A strip built from the bundle can name a society the
       platform does not have — the probe that motivated this fix found exactly one — and a 404
       here is that failure caught before a visitor taps it. */
    const res = await request.get(`${API}/societies/${slug}`);
    expect(res.status(), `the strip links to /society/${slug}`).toBe(200);
    const row = await res.json();

    const card = strip(page).locator(`a.cat-card[href="/society/${slug}"]`);
    await expect(card).toHaveText(new RegExp(escapeRegExp(row.name)));
    await expect(card).toHaveText(new RegExp(escapeRegExp(titleCase(row.localitySlug))));

    /* The badge is the assertion with consequences: a tick beside a society name on the home page
       is PuneNest vouching for the building. It must be the server's registration and conveyance
       saying so, not the bundle's copy of them. */
    const shouldBeVerified = !!row.verifiedAt
      || (row.source !== 'community' && !!(row.registration && row.conveyance));
    await expect(
      card.locator('p svg'),
      `${slug} should ${shouldBeVerified ? '' : 'not '}carry the verified tick`,
    ).toHaveCount(shouldBeVerified ? 1 : 0);
  }
});

test('the home strip ranks the whole catalogue, not the first page of it', async ({ page, request }) => {
  /* The strip's ordering — verified, then homes listed, then name — cannot be asked of the server:
     `SocietySort`'s whitelist is name/occupancy/year/units, so the ranking is client-side over
     every row. Which means a read that stops early does not error, it just silently ranks a
     prefix, and the strip fills with eight plausible societies that are merely the alphabetically
     early ones.

     Rather than re-implement the ranking here — a test that copies the code it is testing tells
     you only that you copied it correctly — this asserts the property that truncation destroys:
     at least one society on the strip is not on the catalogue's first page. */
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
    `every strip society was on page 0, so the walk stopped early: ${slugs.join(', ')}`,
  ).toBeGreaterThan(0);
});

/** The page's own transform, duplicated so the expectation does not depend on the code under test. */
function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
