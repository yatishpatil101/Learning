// LIVE integration check for the `society` domain — the directory's rating aggregate.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/liveAuth.js';
import { seedSocietyReviews } from '../helpers/liveSociety.js';

// A seeded consumer.
const REVIEWER = { mobile: '9708919481', name: 'Omkar Kulkarni' };

// Force the scroll-reveal classes on: `.reveal` sits at opacity 0 until the observer fires.
const reveal = (page) => page.evaluate(() => {
  document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible'));
});

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

// The server's society vocabulary — `ReviewCategories.SOCIETY_KEYS`, and the ids the hub's bars are keyed on.
const SOCIETY_ASPECTS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];

// Did *this* run write the fixture?
let seeded = false;

let target = null;

// Pick the society to rate — any unrated row, else the first.
async function resolveTarget(request) {
  if (target) return target;
  const rows = [];
  for (let page = 0; page < 4; page += 1) {
    const body = await request.get(`/api/societies?size=100&page=${page}`).then((r) => r.json());
    rows.push(...body.content);
    if (page + 1 >= body.totalPages) break;
  }
  expect(rows.length, 'the seeded catalogue must not be empty').toBeGreaterThan(0);
  const unrated = rows.find((s) => Number(s.reviewCount) === 0);
  const row = unrated || rows[0];
  target = { slug: row.slug, name: row.name };
  return target;
}

// The server's own aggregate for the resolved target, straight off the endpoint the directory reads.
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
  // Seed the fixture through the product, not around it, and only if it is empty.
  if (Number((await serverAggregate(page.request)).reviewCount) === 0) {
    const { slug } = await resolveTarget(page.request);
    // Two more reviews so the hub offers its Reviews tab (it needs three).
    await seedSocietyReviews(page.request, slug, 2, { categories: { Safety: 5, Connectivity: 1 } });
    await signIn(page, REVIEWER.mobile);
    await page.goto(`/society/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    await reveal(page);

    await page.getByRole('button', { name: 'Review', exact: true }).click();
    // `exact` on the overall strip: the composer's per-aspect rows are labelled "5 star for
    // Safety" and `getByRole`'s name match is a substring one.
    await page.getByRole('button', { name: '5 star', exact: true }).click();
    // Two aspects, and only two.
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

  // The card has to agree with the server's grouped SQL, both numbers.
  const card = await findInDirectory(page, chosen.slug, chosen.name);
  await expect(card.getByTestId('society-rating')).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(`(${server.reviewCount})`);
  await expect(card).toContainText(String(server.avgRating));
  await expect(card).not.toContainText('Not rated yet');

  // The per-aspect half, against Postgres rather than a browser store.
  const summary = await page.request
    .get(`/api/reviews/society/${chosen.slug}`)
    .then((r) => r.json())
    .then((body) => body.summary);
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

    // API-only checks cannot catch client mapper defects.
    await page.goto(`/society/${chosen.slug}?tab=reviews`);
    await expect(page.getByTestId('society-bar-Safety')).toHaveText('5', { timeout: 20_000 });
    await expect(page.getByTestId('society-bar-Connectivity')).toHaveText('1');
    await expect(page.getByTestId('society-bar-Maintenance')).toHaveCount(0);

    // The UI must not invent an author badge absent from the server response.
    const reviewCard = page.locator('div.glass.rounded-xl').filter({ hasText: REVIEWER.name });
    await expect(reviewCard.first()).toBeVisible({ timeout: 20_000 });
    await expect(reviewCard.getByText('Resident', { exact: true })).toHaveCount(0);
    await expect(reviewCard.getByText('Verified resident', { exact: true })).toHaveCount(0);
  }
});

test('when the catalogue rating read fails the directory says so, rather than claiming societies are unrated', async ({ page }) => {
  // "Not rated yet" is a claim about the building; a failed read licenses no claim at all.
  await page.route('**/api/societies?*', (route) => route.abort('failed'));

  await page.goto('/societies');
  await expect(page.getByText('We couldn’t load the society directory')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Not rated yet')).toHaveCount(0);
  await expect(page.getByTestId('society-rating')).toHaveCount(0);
});
