// @ts-check
import { test, expect } from '../../../fixtures/live.js';

/*
 * /services — the hub itself, against the real API.
 *
 * ## Scope: the Move-in Pack is deliberately NOT here
 *
 * The mock twin's last two tests drove the Move-in Pack by writing `settings.movePack` straight
 * into `puneNestDB_v5`. That is not portable and does not need to be: the pack is already covered
 * live and more thoroughly than it ever was in the mock —
 * `live-move-in-pack.spec.js` (5 tests: the booking reaches the ops board with the price the
 * customer accepted, the desk sees what was ordered, the booking leaves the browser, the
 * signed-out guard, and that the customer cannot read the board back) and
 * `live-move-in-pack-waitlist.spec.js` (4 tests, including the malformed-mobile refusal the mock
 * asserted). The mock's own comment records that its "You're on the waitlist!" assertion was a
 * *bug* — it congratulated the customer for a lead that only reached localStorage.
 *
 * What had no live coverage at all is the hub's actual job: routing people to the nine services.
 * A broken category filter or a card pointing at a dead route surfaces only as "nobody reaches the
 * paid services", which no other spec would notice. That is what this file covers.
 *
 * ## Why running it live is not the same test
 *
 * Two of these assertions can only fail against a real backend:
 *
 *   1. `every service card points at a route that renders` walks all nine destinations. Six of them
 *      are data-backed pages (`/listings?deal=buy`, `/locality/baner`, the four service landings).
 *      In a mock build every one of them renders from a seeded localStorage blob that cannot 404,
 *      cannot 500 and cannot be empty. Live, a route whose provider is unregistered in
 *      `VITE_API_DOMAINS`, or whose data the seed does not carry, renders an error surface — and
 *      the mock suite is structurally blind to that entire class.
 *   2. `consoleErrors` is asserted empty on the hub, which on this page means the `GET /settings`
 *      read behind the Move-in Pack resolved. The mock has no such request to fail.
 */

const cards = (page) => page.locator('a.svc-card');

test.describe('LIVE: the services hub routes people to the nine services', () => {
  test('renders the hero, the Rent Agreement spotlight and the full service grid', async ({ page, consoleErrors }) => {
    await page.goto('/services');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('One platform.');

    // The spotlight is the first paid-service surface and links to the wizard. Rent Agreement is
    // the platform's primary paid service (`Services.jsx:30`), so losing this slot is a revenue
    // regression that looks like a layout tweak.
    const spotlight = page.locator('a.ra-spot');
    await expect(spotlight).toBeVisible();
    await expect(spotlight).toHaveAttribute('href', '/services/rent-agreement');
    await expect(spotlight.getByText('Rent Agreement, done online')).toBeVisible();

    await expect(cards(page)).toHaveCount(9);

    // On this page an empty console also means the `GET /settings` read behind the Move-in Pack
    // resolved — there is no client-side fallback for the pack's prices any more (`Services.jsx:63`).
    expect(consoleErrors).toEqual([]);
  });

  test('category tabs genuinely filter the grid rather than restyling the chip', async ({ page }) => {
    await page.goto('/services');
    await expect(cards(page)).toHaveCount(9);

    await page.locator('button.cat-tab', { hasText: 'Finance & Legal' }).click();
    // Rent Agreement + Home Loans + Property & Legal.
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator('a.svc-card[href="/home-loans"]')).toBeVisible();
    // The negative is what makes this a filter test and not a count test: a chip that only
    // restyled itself would leave the movers card on screen.
    await expect(page.locator('a.svc-card[href="/services/packers-movers"]')).toHaveCount(0);

    await page.locator('button.cat-tab', { hasText: 'Move & Setup' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('a.svc-card[href="/services/packers-movers"]')).toBeVisible();
    await expect(page.locator('a.svc-card[href="/home-loans"]')).toHaveCount(0);

    await page.locator('button.cat-tab', { hasText: 'All Services' }).click();
    await expect(cards(page)).toHaveCount(9);
  });

  test('every service card points at a route that renders against the API', async ({ page }) => {
    // Nine full route loads against a real backend — comfortably over the default budget.
    test.slow();
    await page.goto('/services');
    await expect(cards(page)).toHaveCount(9);
    const hrefs = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(hrefs).toHaveLength(9);

    for (const href of hrefs) {
      await page.goto(href);
      // The catch-all stub is the thing we must never land on.
      await expect(page.getByText('404', { exact: true }), `${href} fell through to the 404 stub`).toHaveCount(0);
      await expect(page.locator('h1, h2').first(), `${href} rendered no heading`).toBeVisible({ timeout: 20_000 });
      /* And it must not have rendered the error surface either. This is the half the mock could not
         check: six of these nine routes are data-backed, and against a real API "the page mounted"
         and "the page has anything on it" are different claims. A provider missing from
         `VITE_API_DOMAINS`, or a seed that does not carry the locality, produces a heading and an
         apology — which the 404 check above would happily pass. */
      await expect(
        page.getByText(/something went wrong|couldn't load|failed to load/i),
        `${href} rendered an error surface`,
      ).toHaveCount(0);
    }
  });

  test('a finalized rental shows the congratulations banner and focuses the rent-agreement card', async ({ page }) => {
    await page.goto('/services?finalize=rent');
    await expect(page.getByText(/Rental finalized/i)).toBeVisible({ timeout: 20000 });

    /* The deep link highlights the Rent Agreement card rather than dumping someone who just closed
       a deal at the top of a nine-card grid. `svc-focus` is applied on a 350ms timer and removed
       after 4s (`Services.jsx:188-195`), so this is a genuinely transient class — assert it inside
       that window rather than polling for it. */
    await expect(page.locator('a.svc-card[href="/services/rent-agreement"].svc-focus')).toBeVisible({ timeout: 10_000 });
  });

  test('a finalized sale focuses the legal card instead — the two outcomes are not the same page', async ({ page }) => {
    /* The mock only ever asserted the `rent` branch, so the `else` in `Services.jsx:174` and the
       sale fallback in the focus map (`Services.jsx:186`) were unexercised. Somebody who just
       completed a *purchase* needs registration help, not a rent agreement; pointing them at the
       rental wizard is the kind of wrong that still looks like it worked. */
    await page.goto('/services?finalize=sale');
    await expect(page.getByText(/Rental finalized/i)).toHaveCount(0);
    await expect(page.locator('a.svc-card[href="/services/property-legal"].svc-focus')).toBeVisible({ timeout: 10_000 });
  });
});
