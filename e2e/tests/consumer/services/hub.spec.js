import { test, expect } from '../../../fixtures/base.js';

/* /services — the hub itself.
 *
 * Every individual landing page had a spec; the hub that routes to them did not,
 * so a broken category filter or a card pointing at a dead route would only have
 * surfaced as "nobody reaches the paid services". These assertions cover the four
 * things the hub is actually responsible for:
 *
 *   1. The Rent Agreement spotlight — the primary paid service holds the prime slot.
 *   2. The category tabs genuinely filter the grid (not just restyle the chip).
 *   3. Cards navigate to live routes, not the 404 stub.
 *   4. The Move-in Pack runs in "coming soon" mode until an admin flips
 *      settings.movePack.enabled — and the waitlist captures a lead in that mode
 *      instead of pretending to book.
 */

const cards = (page) => page.locator('a.svc-card');

/* The hub animates in with `useScrollReveal`: every `.reveal` block sits at
   opacity 0 until it scrolls into view, so Playwright reads anything below the
   fold as NOT visible and never scrolls to it (scrolling requires visibility —
   a deadlock). Force the end state the same way property-detail-improvements
   does, then locate normally. */
async function packSection(page) {
  await expect(cards(page)).toHaveCount(9); // grid mounted
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible')));
  const section = page.locator('section').filter({ hasText: 'PuneNest Move-in Pack' }).last();
  await expect(section).toBeVisible();
  return section;
}

/* Turn the Move-in Pack on or off and land on the hub.

   `settings.movePack` lives in `puneNestDB_v5`, which mockApi migrates and merges
   at module load — writing a partial object in an init script leaves the app
   without settings and the hub renders nothing. Load once, mutate the real DB,
   then navigate (the order feature-flags.spec.js uses). */
async function openHub(page, packEnabled) {
  await page.goto('/');
  await page.evaluate((on) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    db.settings.movePack = {
      enabled: on,
      items: { movers: 8000, clean: 2500, agreement: 1500, paint: 6000, verify: 999, internet: 500 },
    };
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
  }, packEnabled);
  await page.goto('/services');
}

test.describe('Services hub', () => {
  test('renders the hero, the Rent Agreement spotlight and the full service grid', async ({ page, consoleErrors }) => {
    await page.goto('/services');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('One platform.');

    // The spotlight is the first paid-service surface and links to the wizard.
    const spotlight = page.locator('a.ra-spot');
    await expect(spotlight).toBeVisible();
    await expect(spotlight).toHaveAttribute('href', '/services/rent-agreement');
    await expect(spotlight.getByText('Rent Agreement, done online')).toBeVisible();

    // All nine services render on the default "All Services" category.
    await expect(cards(page)).toHaveCount(9);
    expect(consoleErrors).toEqual([]);
  });

  test('category tabs filter the grid', async ({ page }) => {
    await page.goto('/services');
    await expect(cards(page)).toHaveCount(9);

    await page.locator('button.cat-tab', { hasText: 'Finance & Legal' }).click();
    // Rent Agreement + Home Loans + Property & Legal.
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator('a.svc-card[href="/home-loans"]')).toBeVisible();
    await expect(page.locator('a.svc-card[href="/services/packers-movers"]')).toHaveCount(0);

    await page.locator('button.cat-tab', { hasText: 'Move & Setup' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('a.svc-card[href="/services/packers-movers"]')).toBeVisible();

    await page.locator('button.cat-tab', { hasText: 'All Services' }).click();
    await expect(cards(page)).toHaveCount(9);
  });

  test('every service card points at a route that renders', async ({ page }) => {
    // Nine full route loads in one test — comfortably over the 30s default.
    test.slow();
    await page.goto('/services');
    // The grid is lazily rendered; read the hrefs only once it exists.
    await expect(cards(page)).toHaveCount(9);
    const hrefs = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('href')));

    for (const href of hrefs) {
      await page.goto(href);
      // The catch-all stub is the only thing we must never land on.
      await expect(page.getByText('404', { exact: true })).toHaveCount(0);
      await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test('a finalized deal shows the congratulations banner and focuses the right service', async ({ page }) => {
    await page.goto('/services?finalize=rent');
    await expect(page.getByText(/Rental finalized/i)).toBeVisible();

    // The deep link highlights the Rent Agreement card rather than dumping the
    // user at the top of a nine-card grid.
    await expect(page.locator('a.svc-card[href="/services/rent-agreement"].svc-focus')).toBeVisible({ timeout: 10_000 });
  });

  test('Move-in Pack is coming-soon by default and the waitlist validates the mobile', async ({ page }) => {
    await openHub(page, false);

    const pack = await packSection(page);
    await expect(pack.getByText('Coming soon', { exact: true })).toBeVisible();
    await expect(pack.getByText('Launching soon')).toBeVisible();

    // Item buttons are inert until an admin turns the pack live, and carry no price.
    await expect(pack.getByRole('button', { name: /Packers & Movers/ })).toBeDisabled();
    await expect(pack.getByText('₹8,000')).toHaveCount(0);

    const mobile = pack.getByPlaceholder('Enter mobile number');
    await mobile.fill('12345');
    await pack.getByRole('button', { name: 'Notify me' }).click();
    await expect(pack.getByText('Enter a valid 10-digit mobile number.')).toBeVisible();

    await mobile.fill('9876500009');
    await pack.getByRole('button', { name: 'Notify me' }).click();
    await expect(pack.getByText("You're on the waitlist!")).toBeVisible();
  });

  test('when the pack is live, prices show and booking nothing is refused', async ({ page }) => {
    await openHub(page, true);

    const pack = await packSection(page);
    await expect(pack.getByText('Coming soon', { exact: true })).toHaveCount(0);
    await expect(pack.getByText('₹8,000')).toBeVisible();

    // Booking an empty pack is refused rather than silently creating a zero order.
    await pack.getByRole('button', { name: 'Book Move-in Pack' }).click();
    await expect(page.getByText('Select at least one service for your pack.')).toBeVisible();

    // Selecting an item drives the bundle total (₹2,500 less the 12% bundle saving).
    await pack.getByRole('button', { name: /Deep Cleaning/ }).click();
    await expect(pack.getByText('₹2,200')).toBeVisible();
  });
});
