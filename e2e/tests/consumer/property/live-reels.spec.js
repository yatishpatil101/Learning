import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/* The Reels feed, against the catalogue it actually draws from.
 *
 * ## What the mock version could not ask
 *
 * Reels used to be eight hardcoded entries. It is now the live catalogue passed through two gates,
 * and the gates are the whole feature:
 *
 *   isResidentialHome  land has no interior to walk and commercial is searched by spec, so both
 *                      belong on /listings instead of in a vertical swipe feed.
 *   photoCount >= 3    a reel is a walkthrough. Two frames is a card, and swiping into a dead end
 *                      reads as a broken listing.
 *
 * The retired mock twin checked the type gate by fetching `/src/data/db.json` from inside the page
 * and looking each rendered id up in it — asking the fixture whether the fixture agreed with itself.
 * Worse, it could not pose the question that matters. A type gate is only load-bearing if something
 * would otherwise get through it, and in the mock fixture nothing would: every non-residential row
 * there also failed the photo gate, so deleting `isResidentialHome` entirely would have left the
 * feed identical and the test green.
 *
 * The live catalogue has a real adversary. `p5032` is an approved Plot carrying six photos — it
 * clears the photo bar outright, and the type gate is the only thing keeping it out. This file
 * asserts it is in the catalogue and absent from the feed, in that order, so the claim is "the gate
 * excluded it" rather than "it happened not to be there".
 *
 * ## The second thing that got real
 *
 * Saving used to be proved by reading a `dzSavedProps:` localStorage bucket. Live, `SavedContext`
 * writes through `PUT /me/saved/{uuid}` and the shortlist is server state — so the save is checked
 * by asking the API, from outside the browser, whether the row exists. That is the difference
 * between "the page updated its own copy" and "the save happened".
 *
 * ## What is deliberately still shallow
 *
 * Like is session-only and uncounted by design (there is no like on a listing to read, so any
 * number beside the heart would be invented). The assertion is therefore about `aria-pressed`
 * flipping, not about persistence — there is nothing to persist.
 */

/* An approved Plot with six photos: past the photo gate, stopped only by the type gate. Named
   rather than discovered because the point is a specific adversarial row — a "find me any
   non-residential listing" helper would silently pass on a day when the only one left had two
   photos, which is exactly the vacuum the mock version sat in. */
const PLOT_WITH_PHOTOS = 'p5032';

const RESIDENTIAL = /flat|studio|penthouse|independent house|row house|villa/i;
const MIN_PHOTOS = 3;
const MAX_PHOTOS = 5;

async function catalogue() {
  const res = await fetch(`${API}/properties?sort=newest&size=100`);
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.content || body.items || body;
}

const refOf = (p) => p.slug || p.id;
const eligibleIn = (rows) => rows.filter(
  (p) => RESIDENTIAL.test(p.propertyType || '') && (p.imageCount ?? 0) >= MIN_PHOTOS,
);

/* Cookie consent, seeded before boot so the global bottom banner never overlaps the bottom-of-reel
   CTAs. Same reason the legal-pages and mobile-inbox specs do it. */
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
      necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
    }));
  });
}

/* The feed opens a detail request per qualifying listing, so "loaded" is later here than on most
   screens and `networkidle` alone has let an empty `.reel` count through. Anchor on a reel being
   present, which is the state every assertion below assumes. */
async function openFeed(page) {
  await seedConsent(page);
  await page.goto('/reels');
  await expect(page.locator('.reel').first()).toBeVisible({ timeout: 20_000 });
}

test('the feed is residential homes only — and a plot with six photos proves the gate is doing it', async ({ page }) => {
  const rows = await catalogue();

  /* The adversary exists, is approved, and would clear the photo gate. Asserted before the feed is
     opened: if this row ever loses its photos or leaves the catalogue the test must say so, rather
     than quietly degrade into "no plots were in the feed today". */
  const plot = rows.find((p) => refOf(p) === PLOT_WITH_PHOTOS);
  expect(plot, `${PLOT_WITH_PHOTOS} is not in the approved catalogue any more`).toBeTruthy();
  expect(plot.propertyType, 'the adversary stopped being non-residential').not.toMatch(RESIDENTIAL);
  expect(plot.imageCount, 'the adversary no longer clears the photo gate, so it proves nothing')
    .toBeGreaterThanOrEqual(MIN_PHOTOS);

  await openFeed(page);

  const shown = await page.locator('.reel a[href^="/property/"]').evaluateAll(
    (links) => [...new Set(links.map((a) => a.getAttribute('href').split('/').pop()))],
  );
  expect(shown.length, 'the feed rendered nothing, so every absence below is vacuous').toBeGreaterThan(0);

  // The positive half. Every id the feed shows is a residential home in the catalogue — checked
  // against the API's own answer for that row, not against a fixture file read from inside the page.
  const byRef = new Map(rows.map((p) => [refOf(p), p]));
  for (const ref of shown) {
    const row = byRef.get(ref);
    expect(row, `the feed showed ${ref}, which the catalogue does not list`).toBeTruthy();
    expect(row.propertyType, `every reel must be a residential home, got "${row.propertyType}"`)
      .toMatch(RESIDENTIAL);
    expect(row.imageCount, `${ref} is a reel with only ${row.imageCount} photos`)
      .toBeGreaterThanOrEqual(MIN_PHOTOS);
  }

  // The negative half, now with something real to exclude.
  expect(shown, `${PLOT_WITH_PHOTOS} is a plot and must not be in the feed`).not.toContain(PLOT_WITH_PHOTOS);
});

test('the feed is the catalogue, not a curated list — every qualifying home is offered', async ({ page }) => {
  /* Guards the direction the type gate cannot: over-filtering. A gate that excluded everything
     would satisfy the homes-only test perfectly, and this is what makes that impossible.
     A count comparison rather than a set comparison because the feed caps at FEED_MAX=24 and the
     seeded catalogue is smaller than that — if it ever grows past the cap this must be relaxed to
     "the feed is a subset, sized min(eligible, 24)" rather than silently start failing. */
  const rows = await catalogue();
  const eligible = eligibleIn(rows);
  expect(eligible.length, 'no listing qualifies for a reel, so the feed proves nothing')
    .toBeGreaterThan(0);
  expect(eligible.length, 'the catalogue outgrew FEED_MAX; this assertion needs the cap applied')
    .toBeLessThanOrEqual(24);

  await openFeed(page);
  const shown = await page.locator('.reel a[href^="/property/"]').evaluateAll(
    (links) => [...new Set(links.map((a) => a.getAttribute('href').split('/').pop()))],
  );

  expect(shown.sort()).toEqual(eligible.map(refOf).sort());
});

test('loads with no console errors and core chrome present', async ({ page, consoleErrors }) => {
  await openFeed(page);
  await expect(page.getByText('Reels', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rent' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible();

  // The CTA points at a real route, and the ref is one the API resolves — the shape alone would
  // pass for a link built from a template with the wrong id in it.
  const href = await page.getByRole('link', { name: /View home/i }).first().getAttribute('href');
  expect(href).toMatch(/^\/property\/[a-z0-9-]+$/i);
  const ref = href.split('/').pop();
  const res = await fetch(`${API}/properties/${ref}`);
  expect(res.status, `the first reel links to ${ref}, which the API does not resolve`).toBe(200);

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('both intent filters narrow the feed to their own deal', async ({ page }) => {
  /* The mock twin only checked Buy, and only that no "Rent" chip text was visible inside
     `.reel-wrap`. Doing both directions against the catalogue's own answer is what turns this from
     "the label changed" into "the right listings survived" — and a filter that emptied the feed
     would have passed the old assertion outright. */
  const rows = await catalogue();
  const eligible = eligibleIn(rows);
  const expected = {
    buy: eligible.filter((p) => p.deal === 'buy').map(refOf).sort(),
    rent: eligible.filter((p) => p.deal === 'rent').map(refOf).sort(),
  };
  expect(expected.buy.length, 'no sale listing qualifies, so the Buy filter proves nothing').toBeGreaterThan(0);
  expect(expected.rent.length, 'no rental qualifies, so the Rent filter proves nothing').toBeGreaterThan(0);

  await openFeed(page);

  for (const [deal, chip] of [['buy', 'Buy'], ['rent', 'Rent']]) {
    await page.getByRole('button', { name: chip }).click();
    await expect
      .poll(async () => page.locator('.reel a[href^="/property/"]').evaluateAll(
        (links) => [...new Set(links.map((a) => a.getAttribute('href').split('/').pop()))].sort(),
      ), { message: `the ${chip} filter did not settle on the ${deal} listings` })
      .toEqual(expected[deal]);
  }
});

test('saving from a reel reaches the caller shortlist on the server', async ({ page }) => {
  /* The claim the localStorage version could not make. `SavedContext` writes through
     `PUT /me/saved/{uuid}` and holds the shortlist as server state, so the save is verified by
     asking the API from outside the browser. A page that only updated its own copy passes the old
     test and fails this one.
   *
   * A throwaway account, because the assertion is "the shortlist contains exactly this" and a
   * shared actor would carry whatever a previous run saved. */
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const before = await (await fetch(`${API}/me/saved?size=100`, { headers })).json();
  expect((before.content || before.items || []).length, 'a brand-new account already had a shortlist').toBe(0);

  await seedConsent(page);
  await signedInAs(page, mobile);
  await page.goto('/reels');
  await expect(page.locator('.reel').first()).toBeVisible({ timeout: 20_000 });

  const ref = (await page.locator('.reel a[href^="/property/"]').first().getAttribute('href')).split('/').pop();
  await page.getByRole('button', { name: 'Save property' }).first().click();
  await expect(page.getByRole('button', { name: 'Remove from saved' }).first()).toBeVisible();

  await expect
    .poll(async () => {
      const res = await fetch(`${API}/me/saved?size=100`, { headers });
      const body = await res.json();
      return (body.content || body.items || []).map((p) => p.slug || p.id);
    }, { message: 'the heart filled but the server shortlist stayed empty' })
    .toEqual([ref]);
});

test('Like toggles the pressed state', async ({ page }) => {
  await openFeed(page);
  const likeBtn = page.getByRole('button', { name: 'Like', exact: true }).first();
  await expect(likeBtn).toHaveAttribute('aria-pressed', 'false');
  await likeBtn.click();
  await expect(page.getByRole('button', { name: 'Unlike', exact: true }).first())
    .toHaveAttribute('aria-pressed', 'true');
});

test('Contact link carries a property ref and View home resolves', async ({ page }) => {
  await openFeed(page);
  await expect(page.getByRole('link', { name: 'Contact owner' }).first())
    .toHaveAttribute('href', /\/contact\?ref=[a-z0-9-]+/i);
  await page.getByRole('link', { name: /View home/i }).first().click();
  await expect(page).toHaveURL(/\/property\/[a-z0-9-]+/i);
  await expect(page.getByText(/not found/i)).toHaveCount(0);
});

test('Like and Save icons render (not fill=none invisible)', async ({ page }) => {
  await openFeed(page);
  const like = page.locator('.rail button[aria-label="Like"] svg').first();
  const save = page.locator('.rail button[aria-label="Save property"] svg').first();
  await expect(like).toBeVisible();
  await expect(save).toBeVisible();
  const box = await like.boundingBox();
  expect(box.width).toBeGreaterThan(10);
  expect(await like.locator('path').count()).toBeGreaterThan(0);
});

test('photos scroll horizontally within a property and dots update', async ({ page }) => {
  await openFeed(page);
  const gallery = page.locator('.reel .reel-gallery').first();
  await expect(gallery).toBeVisible();

  /* A reel carries between MIN_PHOTOS and MAX_PHOTOS slides — the floor is what earned it a reel,
     the ceiling is where the horizontal swipe would start outlasting the vertical feed the page is
     for. Both ends are asserted: the old spec checked only the floor, so a regression that dropped
     the cap and put twenty frames in one reel would have passed. */
  const slides = gallery.locator('.reel-slide');
  const n = await slides.count();
  expect(n).toBeGreaterThanOrEqual(MIN_PHOTOS);
  expect(n).toBeLessThanOrEqual(MAX_PHOTOS);

  await gallery.evaluate((el) => el.scrollTo({ left: el.clientWidth }));
  /* `evaluateAll` does not retry and the dot is driven by a scroll listener, so polling the read
     waits for the dot to move rather than for a duration. */
  await expect
    .poll(async () => page.locator('.reel').first().locator('.reel-dots .reel-dot')
      .evaluateAll((dots) => dots.findIndex((d) => d.classList.contains('is-on'))))
    .toBe(1);
});
