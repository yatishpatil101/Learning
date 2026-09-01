/**
 * LIVE integration check for the `society` domain — the directory's rating aggregate.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend on :8081
 * under the `dev,e2e` profiles and the `punenest_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/live-society-rating.spec.js --config=playwright.config.js
 *
 * Sign-in is `helpers/liveAuth.js`; the `e2e` profile fixes the OTP, so nothing reads the backend
 * log any more.
 *
 * ## Why this file exists, and why it writes a review before it asserts one
 *
 * `Societies.jsx` spent its whole life calling `entityRating('society', …)` — a reduce over the
 * `pnEntityReviews` localStorage bucket, which only the mock provider ever writes. Against a real
 * server that read is not wrong, it is *dead*: every card in a 348-society directory says "Not
 * rated yet" no matter what Postgres holds, and the mock suite is green throughout, because in mock
 * mode the bucket is exactly where the reviews are.
 *
 * That is the shape of failure a mock spec structurally cannot see, so the replacement needs a live
 * one. But a live spec can reproduce the same blindness at one remove: the seeded database contains
 * **zero** society reviews — every row of `GET /societies` comes back `"avgRating": null,
 * "reviewCount": 0` — so a test that merely loads `/societies` and looks for a rating would find
 * none, pass its `not.toContainText` assertions, and prove only that the fixture is empty. It would
 * pass just as happily with the backend switched off.
 *
 * So the first test writes the review it later reads, through the review seam, as a user would; the
 * number it asserts is one only a round trip through Postgres can produce. The second test proves
 * the other half — that when the read fails the card says so rather than saying "Not rated yet",
 * which is the one sentence a broken aggregate must never be allowed to print.
 */
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/liveAuth.js';

/* A seeded consumer. Reviewing an entity has no eligibility gate (unlike a property review), so any
   signed-in account can post one — but it must be a real seeded user for sign-in to succeed. */
const REVIEWER = { mobile: '9708919481', name: 'Omkar Kulkarni' };

/* A curated society, so it is present regardless of how much of the MahaRERA import is seeded. Its
   slug is the key both the hub and the directory join on.

   This is the *preferred* target, not a fixed one — see `resolveTarget`. */
const SLUG = 'aditya-shagun-kothrud';
const NAME = 'Aditya Shagun';

/** Force the scroll-reveal classes on: `.reveal` sits at opacity 0 until the observer fires. */
const reveal = (page) => page.evaluate(() => {
  document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible'));
});

/** The `/societies` directory card for one society, found by its hub link. */
const gridCard = (page, slug) =>
  page.locator('div.glass').filter({ has: page.locator(`a[href="/society/${slug}"]`) }).first();

async function findInDirectory(page, slug, name) {
  await page.goto('/societies');
  await page.getByRole('textbox', { name: /search societies/i }).fill(name);
  const card = gridCard(page, slug);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await reveal(page);
  return card;
}

test.describe.configure({ mode: 'serial' });

/* The server's society vocabulary — `ReviewCategories.SOCIETY_KEYS`, and the ids the hub's bars are
   keyed on. Capitalisation included: these are stored keys, not labels, and renaming one would
   orphan every rating already written under the old id. */
const SOCIETY_ASPECTS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];

/* Did *this* run write the fixture? The aspect assertions below are only honest about a review we
   posted ourselves — a database already carrying reviews from before per-aspect writes existed
   would have an empty `categoryAverages` for entirely legitimate reasons. */
let seeded = false;

/* The society this run actually transacts on, resolved once by `resolveTarget`. */
let target = null;

/**
 * Pick the society to rate — the preferred one if it is still unrated, otherwise any unrated row.
 *
 * The reason this is not just `SLUG` is a trap the first version walked into. `ReviewService`
 * allows one review per author per target, so once a run has rated the preferred society, every
 * later run finds `reviewCount > 0`, skips the write, and leaves `seeded` false — which silently
 * disables the entire per-aspect block below. The spec stays green and stops testing the thing it
 * was written for, on every machine that has ever run it, permanently. That is worse than a flaky
 * test: a flaky test tells you something.
 *
 * Choosing an unrated row keeps the write path reachable indefinitely — the catalogue holds 348
 * societies and a run consumes one — and it also means the aggregate being asserted was produced
 * by *this* run rather than inherited, which is what makes `Safety = 5` a claim about the server's
 * grouped SQL instead of a claim about the seed.
 *
 * The fallback matters too: if every society is rated, we still have a target and the test degrades
 * to asserting the read half, with `seeded` false, rather than failing for want of a fixture.
 */
async function resolveTarget(request) {
  if (target) return target;
  const rows = [];
  for (let page = 0; page < 4; page += 1) {
    const body = await request.get(`/api/societies?size=100&page=${page}`).then((r) => r.json());
    rows.push(...body.content);
    if (page + 1 >= body.totalPages) break;
  }
  expect(rows.length, 'the seeded catalogue must not be empty').toBeGreaterThan(0);
  const preferred = rows.find((s) => s.slug === SLUG);
  const unrated = rows.find((s) => Number(s.reviewCount) === 0);
  const row = preferred && Number(preferred.reviewCount) === 0 ? preferred : (unrated || preferred || rows[0]);
  target = { slug: row.slug, name: row.name };
  return target;
}

/** The server's own aggregate for the resolved target, straight off the endpoint the directory reads. */
async function serverAggregate(request) {
  const { slug } = await resolveTarget(request);
  const body = await request.get('/api/societies?size=100').then((r) => r.json());
  let row = body.content.find((s) => s.slug === slug);
  for (let page = 1; !row && page < 4; page += 1) {
    const next = await request.get(`/api/societies?size=100&page=${page}`).then((r) => r.json());
    row = next.content.find((s) => s.slug === slug);
  }
  expect(row, `${slug} must exist in the seeded catalogue`).toBeTruthy();
  return row;
}

test('the live directory card reports the aggregate the server computed', async ({ page }) => {
  /* Seed the fixture through the product, not around it, and only if it is empty.
   *
   * `ReviewService.createForEntity` allows one review per author per target
   * (`AlreadyReviewedException`), so an unconditional post makes this spec pass exactly once and
   * then wedge on a composer that never closes. Guarding on the server's own count keeps it
   * re-runnable without ever letting it run against nothing: whatever happens above, the
   * `reviewCount > 0` assertion below is what stops a green tick from meaning "the catalogue has no
   * reviews and the card correctly said so", which is the result this DB gives by default — all 348
   * seeded societies come back `avgRating: null, reviewCount: 0`. */
  if (Number((await serverAggregate(page.request)).reviewCount) === 0) {
    const { slug } = await resolveTarget(page.request);
    await signIn(page, REVIEWER.mobile);
    await page.goto(`/society/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    await reveal(page);

    await page.getByRole('button', { name: 'Review', exact: true }).click();
    // `exact` on the overall strip: the composer's per-aspect rows are labelled "5 star for
    // Safety" and `getByRole`'s name match is a substring one.
    await page.getByRole('button', { name: '5 star', exact: true }).click();
    /* Two aspects, and only two. `Safety` and `Connectivity` are in the server's *society*
       vocabulary (`ReviewCategories.SOCIETY_KEYS`); the property aspects are refused with a 400 for
       this target, so a write that reached here with the wrong keys would fail loudly rather than
       storing sub-ratings the aggregate then filters away. Leaving the other three untouched is
       what makes the sparseness assertion below non-vacuous. */
    await page.getByRole('button', { name: '5 star for Safety' }).click();
    await page.getByRole('button', { name: '1 star for Connectivity' }).click();
    await page.getByRole('button', { name: 'Post review' }).click();
    // The composer closes only once the seam round-trip resolves — i.e. once Postgres has the row.
    await expect(page.getByRole('button', { name: 'Post review' })).toHaveCount(0, { timeout: 20_000 });
    seeded = true;
  }

  const server = await serverAggregate(page.request);
  const chosen = await resolveTarget(page.request);
  expect(Number(server.reviewCount), 'the fixture must be non-empty or this test proves nothing')
    .toBeGreaterThan(0);
  expect(server.avgRating).not.toBeNull();

  /* The card has to agree with the server's grouped SQL, both numbers. `entityRating` could not
     have produced either: it reduced a localStorage bucket that a live session never writes. */
  const card = await findInDirectory(page, chosen.slug, chosen.name);
  await expect(card.getByTestId('society-rating')).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(`(${server.reviewCount})`);
  await expect(card).toContainText(String(server.avgRating));
  await expect(card).not.toContainText('Not rated yet');

  /* The per-aspect half, against Postgres rather than a browser store.
   *
   * `categoryAverages` is a grouped SQL aggregate filtered to the *target's* vocabulary, and until
   * this change that vocabulary was the property one for every target — so a society's map came
   * back permanently `{}` and the hub's five bars were the deterministic baseline alone, on every
   * society, forever. Nothing failed; the page just quietly showed a number nobody had given it.
   *
   * Two assertions, and the second is the one that matters. Any key present must be a society
   * aspect (a property key surviving into a society's aggregate is the defect this replaced), and
   * — only when this run wrote the fixture, so the claim is never vacuous — the two aspects that
   * were rated are present with the values given while the three that were skipped are *absent*
   * rather than 0. An unrated aspect averaged as a zero is the failure this codebase keeps
   * refusing, and it is invisible in every reading of the page. */
  const summary = await page.request
    .get(`/api/reviews/society/${chosen.slug}/summary`)
    .then((r) => r.json());
  const catAvg = summary.categoryAverages || {};
  expect(Object.keys(catAvg).sort())
    .toEqual(Object.keys(catAvg).filter((k) => SOCIETY_ASPECTS.includes(k)).sort());

  if (seeded) {
    expect(catAvg.Safety).toBe(5);
    expect(catAvg.Connectivity).toBe(1);
    for (const skipped of ['Maintenance', 'Management', 'Amenities']) {
      expect(catAvg, `${skipped} was never rated and must be absent, not 0`)
        .not.toHaveProperty(skipped);
    }

    /* And now the same fact on the *rendered* page, which is a genuinely different claim.
     *
     * Everything above reads the API directly, and an API-only assertion cannot catch a client
     * mapper — which is exactly how the next defect survived. `http/reviewMapper.js` copied
     * `categoryAverages` through one hardcoded allowlist holding the property vocabulary, shared by
     * the property summary and the entity summary alike, so all five society keys were dropped on
     * the way to the page: the payload asserted above was correct and `catAvg` still arrived `{}`.
     * The suite stayed green because the *mock* provider is target-aware, and the baseline drew
     * five plausible bars over the hole. Read a bar off the DOM, and neither excuse is available. */
    await page.goto(`/society/${chosen.slug}?tab=reviews`);
    await expect(page.getByTestId('society-bar-Safety')).toHaveText('5', { timeout: 20_000 });
    await expect(page.getByTestId('society-bar-Connectivity')).toHaveText('1');
    await expect(page.getByTestId('society-bar-Maintenance')).toHaveCount(0);

    /* And the review this run just wrote carries **no author badge**, because the server states
       nothing that could justify one.
     *
     * The card used to read `r.resident` — a flag the retired mock computed in the browser from
     * `isVerifiedResident(slug)` and stored beside the review, so a review's standing was whatever
     * the writer's own tab claimed about itself. The view model has carried no such field since the
     * seam moved, which meant the badge had already stopped rendering; what was left was a live
     * reference to a name that does not exist, one rename away from resurrecting the fabrication.
     *
     * The server's own equivalent is `context`, and `http/reviewMapper.js` documents it as **null
     * on society reviews** — there is no visit or tenancy to derive one from. So re-pointing at
     * `context` would have drawn a badge that is null for every row on this tab: the same dead
     * affordance under a more convincing name. Asserted here on a row known to be present, so the
     * absence is an absence within a rendered review rather than on an empty tab. */
    const reviewCard = page.locator('div.glass.rounded-xl').filter({ hasText: REVIEWER.name });
    await expect(reviewCard.first()).toBeVisible({ timeout: 20_000 });
    await expect(reviewCard.getByText('Resident', { exact: true })).toHaveCount(0);
    await expect(reviewCard.getByText('Verified resident', { exact: true })).toHaveCount(0);
  }
});

test('when the rating read fails the card says so, rather than claiming the society is unrated', async ({ page }) => {
  /* The distinction the whole change turns on. "Not rated yet" is a claim about the building; a
     failed read licenses no claim at all. Before the seam there was no difference to draw — the
     localStorage reduce cannot fail — so the failure mode and the empty mode printed the same
     confident sentence, and the dead read was invisible for exactly that reason. */
  await page.route('**/api/societies?*', (route) => route.abort('failed'));

  const card = await findInDirectory(page, SLUG, NAME);
  await expect(card.getByTestId('society-rating-unavailable')).toBeVisible({ timeout: 20_000 });
  await expect(card).not.toContainText('Not rated yet');
  await expect(card.getByTestId('society-rating')).toHaveCount(0);
});
