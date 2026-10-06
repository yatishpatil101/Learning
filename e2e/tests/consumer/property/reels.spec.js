import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/* Reels against the live catalogue, behind two gates: `isResidentialHome` and `photoCount >= 3`. Saves are checked
   via the API (`PUT /me/saved/{uuid}`); like is session-only, so only `aria-pressed` is asserted. */

/* An approved Plot with six photos: clears the photo gate, so only the type gate keeps it out. Named, not
   discovered, so the test cannot pass vacuously when no such row exists. */
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

/* `networkidle` alone has let an empty `.reel` count through. Anchor on a reel being present, which
   is the state every assertion below assumes. */
async function openFeed(page) {
  await seedConsent(page);
  await page.goto('/reels');
  await expect(page.locator('.reel').first()).toBeVisible({ timeout: 20_000 });
}

test('the feed is residential homes only — and a plot with six photos proves the gate is doing it', async ({ page }) => {
  const rows = await catalogue();

  /* Assert first that the adversary exists and clears the photo gate, not just that it's absent from the feed. */
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
  /* Guards over-filtering, which the homes-only test can't. Count comparison since the feed caps at FEED_MAX=24;
     relax to min(eligible, 24) if the seeded catalogue outgrows the cap. */
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

test('loads with no console errors and core chrome present, and the contact link and View home resolve', async ({ page, consoleErrors }) => {
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

  await expect(page.getByRole('link', { name: 'Contact owner' }).first())
    .toHaveAttribute('href', /\/contact\?ref=[a-z0-9-]+/i);
  await page.getByRole('link', { name: /View home/i }).first().click();
  await expect(page).toHaveURL(/\/property\/[a-z0-9-]+/i);
  await expect(page.getByText(/not found/i)).toHaveCount(0);

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('both intent filters narrow the feed to their own deal', async ({ page }) => {
  /* Both directions against the catalogue's own answer: a filter that emptied the feed would otherwise pass. */
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
  /* The save is verified by asking the API from outside the browser (`PUT /me/saved/{uuid}` is server state). A
     throwaway account, since the shortlist must contain exactly this and a shared actor carries earlier saves. */
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

test('the Like and Save icons render, and Like toggles the pressed state', async ({ page }) => {
  await openFeed(page);
  const like = page.locator('.rail button[aria-label="Like"] svg').first();
  const save = page.locator('.rail button[aria-label="Save property"] svg').first();
  await expect(like).toBeVisible();
  await expect(save).toBeVisible();
  const box = await like.boundingBox();
  expect(box.width).toBeGreaterThan(10);
  expect(await like.locator('path').count()).toBeGreaterThan(0);

  const likeBtn = page.getByRole('button', { name: 'Like', exact: true }).first();
  await expect(likeBtn).toHaveAttribute('aria-pressed', 'false');
  await likeBtn.click();
  await expect(page.getByRole('button', { name: 'Unlike', exact: true }).first())
    .toHaveAttribute('aria-pressed', 'true');
});

test('photos scroll horizontally within a property and dots update', async ({ page }) => {
  await openFeed(page);
  const gallery = page.locator('.reel .reel-gallery').first();
  await expect(gallery).toBeVisible();

  /* A reel carries between MIN_PHOTOS and MAX_PHOTOS slides; assert both ends so a dropped cap cannot pass. */
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
