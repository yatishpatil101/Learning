import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/* Paid placement is ranked and disclosed — but never over an order the buyer chose (D59).
 *
 * A boost buys position in the default order. It must not buy position in an order the buyer asked
 * for by name, and it must never be silent: an unlabelled paid result is an undisclosed
 * advertisement. Live, all three of those are decided by the server —
 * `PropertySpecs.relevanceFirst` / `boostedFirst` weight `boosted_until > now()`, and
 * `PropertyService.search` drops ranking entirely the moment `PropertySort.hasExplicitSort` sees a
 * column order. The browser only reads `boosted` off the wire and paints a badge.
 *
 * WHY THE FIXTURE IS A SEEDED WINDOW AND NOT A PURCHASE. `BoostService.promote` is private and
 * reachable only from the payment-callback settlement path, so the sole way to open a promotion
 * window through the API is to drive a payment through the gateway. That is a billing test. The
 * catalogue's entire interface to a boost is the `boosted_until` column, so the seed sets it
 * directly (see the comment above the UPDATE in `R__zz_DML_dev_demo_data.sql`) and this file asserts
 * what the catalogue does with it.
 *
 * WHY WAGHOLI. The promoted listing p5145 sits in a block of ten flats that share an owner, a
 * locality, a posting date and a trust profile. Those nine siblings are the adversarial rows: they
 * clear every filter p5145 clears and differ from it in nothing the ranker can see, so the boost is
 * the only available explanation for first place. They are asserted to be on screen before anything
 * is asserted about position — a ranking claim over a grid holding one card is not a claim.
 *
 * Nothing here is a hard-coded position or price. Cheapest and dearest are read back from the API
 * inside the test that uses them, and each is guarded against being the promoted row itself, so a
 * fixture edit that accidentally made p5145 the cheapest Wagholi flat turns this file red instead of
 * quietly turning test C into a tautology. */

const BOOSTED = 'p5145';
const LOC = 'wagholi';

const cards = (page) => page.locator('a[href^="/property/"]');
const slugOf = async (card) => (await card.getAttribute('href')).split('/').pop().toLowerCase();

const get = async (query) => {
  const res = await fetch(`${API}/properties?${query}`);
  expect(res.ok, `GET /properties?${query} answered ${res.status}`).toBe(true);
  return res.json();
};

/** Every approved buy listing in the fixture locality, as the catalogue orders it by default. */
const wagholi = () => get(`deal=buy&localities=${LOC}&size=100`);

/**
 * The grid's page size (`Listings.jsx:39`), and the reason the count assertions below can compare
 * a rendered grid against an unpaged API read at all.
 *
 * Every `toHaveCount(rows.length)` in this file rests on the whole locality fitting on one page.
 * That is an invariant about a constant in a different file crossed with a row count other live
 * specs can grow — `live-post-on-behalf` and `live-properties-moderation` approve listings against
 * this same database. Left unstated, the 25th Wagholi buy listing turns three tests red with
 * "expected 25, received 24", which reads as a ranking defect. Asserted, it names itself.
 */
const PAGE_SIZE = 24;
const assertFitsOnePage = (rows) => expect(
  rows.length,
  `Wagholi holds ${rows.length} buy listings but the grid pages at ${PAGE_SIZE}; the count `
  + 'assertions in this file compare a paged grid against an unpaged API read and can no longer',
).toBeLessThanOrEqual(PAGE_SIZE);

/** Drive the custom sort listbox (not a native `<select>`), then wait for the grid to settle. */
async function sortBy(page, label) {
  await page.getByRole('button', { name: /sort/i }).first().click();
  await page.getByRole('option', { name: label, exact: true }).click();
  const line = page.locator('main p:visible', { hasText: /Showing/ }).first();
  await expect(line).not.toHaveAttribute('aria-busy', 'true', { timeout: 15000 });
}

test.describe('Paid placement (D59)', () => {
  test('the server promotes exactly one listing, and its rivals are otherwise indistinguishable', async () => {
    const page1 = await wagholi();
    const rows = page1.content;

    // Positive anchor before any claim about scarcity: the locality really does hold a block of
    // comparable listings. Without this a "only one is boosted" assertion passes on an empty page.
    expect(rows.length, 'the Wagholi fixture block is missing from the seed').toBeGreaterThan(5);

    const promoted = rows.filter((p) => p.boosted);
    expect(promoted.map((p) => p.slug)).toEqual([BOOSTED]);

    // The adversarial set, named. These are the rows that make first place mean something: same
    // owner, same locality, same age, same trust badges, no boost.
    const rivals = rows.filter((p) => p.slug !== BOOSTED && p.propertyType === 'Flat');
    expect(rivals.length, 'p5145 has no comparable unboosted siblings left to outrank').toBeGreaterThan(3);
    expect(rivals.every((p) => p.boosted === false)).toBe(true);

    // First place under the default order is the promotion's doing and not the row's own merit.
    expect(rows[0].slug).toBe(BOOSTED);
  });

  test('a promotion buys the top of the order nobody chose', async ({ page }) => {
    const rows = (await wagholi()).content;
    const rivals = rows.filter((p) => p.slug !== BOOSTED).map((p) => p.slug);
    expect(rivals.length).toBeGreaterThan(3);
    assertFitsOnePage(rows);

    await page.goto(`/listings?deal=buy&loc=${LOC}`);
    await cards(page).first().waitFor({ timeout: 15000 });

    // The rivals are on screen. Asserting position over a grid that rendered one card proves
    // nothing, and this locality fits inside a single page.
    await expect(cards(page)).toHaveCount(rows.length, { timeout: 15000 });

    await expect(cards(page).first()).toHaveAttribute('href', `/property/${BOOSTED}`);
    await expect(cards(page).first().getByText(/^Promoted$/i)).toBeVisible();
  });

  test('exactly one card discloses that its position was bought', async ({ page }) => {
    const rows = (await wagholi()).content;
    assertFitsOnePage(rows);
    // Re-derived from the same read rather than written as `1`. A second seeded boost in this
    // locality should fail as "the grid disclosed fewer promotions than the API reported", not as
    // a literal nobody can trace back to a source.
    const boosted = rows.filter((p) => p.boosted).length;

    await page.goto(`/listings?deal=buy&loc=${LOC}`);
    await expect(cards(page)).toHaveCount(rows.length, { timeout: 15000 });

    // One listing was promoted, so one badge may appear. A badge painted on every card would still
    // satisfy a "visible on the boosted one" assertion, which is why this counts instead.
    await expect(page.getByText(/^Promoted$/i)).toHaveCount(boosted);
  });

  test('an explicit price order is the buyer\'s — money does not outrank it', async ({ page }) => {
    const cheapest = (await get(`deal=buy&localities=${LOC}&sort=price,asc&size=1`)).content[0];
    const dearest = (await get(`deal=buy&localities=${LOC}&sort=price,desc&size=1`)).content[0];

    // The guard that stops this test going vacuous: if the promoted row were itself the cheapest or
    // the dearest, "it is first under price order" would be true with the boost deleted.
    expect(cheapest.slug, 'the promoted listing is also the cheapest — the fixture proves nothing').not.toBe(BOOSTED);
    expect(dearest.slug, 'the promoted listing is also the dearest — the fixture proves nothing').not.toBe(BOOSTED);
    expect(cheapest.slug).not.toBe(dearest.slug);

    const rows = (await wagholi()).content;
    assertFitsOnePage(rows);
    const boosted = rows.filter((p) => p.boosted).length;
    await page.goto(`/listings?deal=buy&loc=${LOC}`);
    await expect(cards(page)).toHaveCount(rows.length, { timeout: 15000 });
    // Default order first, so the swap that follows is observable rather than assumed.
    await expect(cards(page).first()).toHaveAttribute('href', `/property/${BOOSTED}`);

    await sortBy(page, 'Price: Low to High');
    await expect(cards(page).first()).toHaveAttribute('href', `/property/${cheapest.slug}`);
    // Disclosure survives the reorder: the promoted listing is still labelled, just no longer first.
    // The whole locality fits on one page, so the badge is genuinely absent if it fails to render
    // rather than merely paged away.
    await expect(page.getByText(/^Promoted$/i)).toHaveCount(boosted);

    await sortBy(page, 'Price: High to Low');
    // Asserted positively. `not.toHaveAttribute(BOOSTED)` would pass against a stale grid still
    // holding the cheapest-first order; naming the row that must be first cannot.
    await expect(cards(page).first()).toHaveAttribute('href', `/property/${dearest.slug}`);
  });
});
