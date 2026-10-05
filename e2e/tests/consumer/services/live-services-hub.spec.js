// @ts-check
import { test, expect } from '../../../fixtures/live.js';

/* /services — the hub itself, against the real API. The Move-in Pack is covered by
   `live-move-in-pack.spec.js`; this file covers the hub's actual job, routing people to the nine
   services. A broken category filter or a card pointing at a dead route surfaces only as "nobody
   reaches the paid services", which no other spec would notice. */

const cards = (page) => page.locator('a.svc-card');

/* One data-bearing element per destination, so a route that mounts but renders an empty shell fails.
   Six of the nine are data-backed pages; the rest fall back to a non-empty h1. */
const PROOF = {
  '/listings?deal=buy': (page) => page.locator('a[href^="/property/"]').first(),
  '/listings?deal=rent': (page) => page.locator('a[href^="/property/"]').first(),
  '/locality/baner': (page) => page.locator('h1', { hasText: 'Locality insights' }),
  '/home-loans': (page) => page.locator('h1', { hasText: 'Home loans made' }),
  '/services/packers-movers': (page) => page.locator('h1', { hasText: 'Stress-free home shifting' }),
  '/services/interior-renovation': (page) => page.locator('h1', { hasText: 'Interiors that' }),
  '/services/property-valuation': (page) => page.locator('h1', { hasText: 'Know what your' }),
};

test.describe('LIVE: the services hub routes people to the nine services', () => {
  test('the Rent Agreement spotlight leads, and category tabs genuinely filter the grid', async ({ page, consoleErrors }) => {
    await page.goto('/services');
    await expect(cards(page)).toHaveCount(9);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('One platform.');

    // Rent Agreement is the platform's primary paid service (`Services.jsx:30`): losing this slot is a
    // revenue regression that looks like a layout tweak.
    const spotlight = page.locator('a.ra-spot');
    await expect(spotlight).toBeVisible();
    await expect(spotlight).toHaveAttribute('href', '/services/rent-agreement');
    await expect(spotlight.getByText('Rent Agreement, done online')).toBeVisible();

    await page.locator('button.cat-tab', { hasText: 'Finance & Legal' }).click();
    // Rent Agreement + Home Loans + Property & Legal.
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator('a.svc-card[href="/home-loans"]')).toBeVisible();
    // The negative is what makes this a filter test and not a count test.
    await expect(page.locator('a.svc-card[href="/services/packers-movers"]')).toHaveCount(0);

    await page.locator('button.cat-tab', { hasText: 'Move & Setup' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('a.svc-card[href="/services/packers-movers"]')).toBeVisible();
    await expect(page.locator('a.svc-card[href="/home-loans"]')).toHaveCount(0);

    await page.locator('button.cat-tab', { hasText: 'All Services' }).click();
    await expect(cards(page)).toHaveCount(9);

    // An empty console also means the `GET /settings` read behind the Move-in Pack resolved.
    expect(consoleErrors).toEqual([]);
  });

  test('every service card points at a route that renders its content against the API', async ({ page }) => {
    // Nine full route loads against a real backend — comfortably over the default budget.
    test.slow();
    await page.goto('/services');
    await expect(cards(page)).toHaveCount(9);
    const hrefs = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(hrefs).toHaveLength(9);

    for (const href of hrefs) {
      await page.goto(href);
      await expect(page.getByText('404', { exact: true }), `${href} fell through to the 404 stub`).toHaveCount(0);
      const proof = PROOF[href] ? PROOF[href](page) : page.locator('h1').first();
      await expect(proof, `${href} rendered no content`).toBeVisible({ timeout: 20_000 });
      await expect(proof, `${href} content is empty`).toHaveText(/\S/);
      // A provider missing from `VITE_API_DOMAINS` produces a heading and an apology, which the checks above would pass.
      await expect(
        page.getByText(/something went wrong|couldn't load|failed to load/i),
        `${href} rendered an error surface`,
      ).toHaveCount(0);
    }
  });

  test('a finalized rental focuses the rent-agreement card, and a finalized sale focuses the legal card instead', async ({ page }) => {
    await test.step('rent', async () => {
      await page.goto('/services?finalize=rent');
      await expect(page.getByText(/Rental finalized/i)).toBeVisible({ timeout: 20000 });

      // `svc-focus` is applied on a 350ms timer and removed after 4s (`Services.jsx:188-195`), so
      // assert it inside that window rather than polling for it.
      await expect(page.locator('a.svc-card[href="/services/rent-agreement"].svc-focus')).toBeVisible({ timeout: 10_000 });
    });

    await test.step('sale', async () => {
      // Someone who just completed a purchase needs registration help, not a rent agreement.
      await page.goto('/services?finalize=sale');
      await expect(page.getByText(/Rental finalized/i)).toHaveCount(0);
      await expect(page.locator('a.svc-card[href="/services/property-legal"].svc-focus')).toBeVisible({ timeout: 10_000 });
    });
  });
});
