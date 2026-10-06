import { test, expect } from '../../fixtures/live.js';

/** Once a second city is live, Pune's inventory must not leak into it (Mumbai has no seeded stock, so the empty states fail honestly if that changes).
 * `cities.set` writes via `PATCH /admin/cities/{slug}` and the page reads the same server roster through `GET /bootstrap`. */

/** Pick a city through the picker, as a shopper does, and wait for the page to agree. */
async function selectCity(page, city) {
  const pill = page.getByRole('button', { name: /^City: / }).first();
  const list = page.getByRole('listbox', { name: 'Select city' });

  /* Open the picker inside `toPass`: the roster arrives after first paint, so one click can list the city under "Coming soon"
       and resolve the option to the waitlist entry. */
  await expect(async () => {
    if (!(await list.isVisible())) await pill.click();
    await expect(list.getByRole('button', { name: city, exact: true })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 15000 });

  await list.getByRole('button', { name: city, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(city);
}

test.describe('a second live city', () => {
  test('says it is empty instead of showing Pune', async ({ page, cities }) => {
    await cities.set('mumbai', true);
    await page.goto('/');

    // Positive control: `toHaveCount(0)` below is only evidence if the chip can render at all.
    const baner = page.getByRole('button', { name: 'Baner', exact: true });
    await expect(baner).toBeVisible();

    await selectCity(page, 'Mumbai');

    await expect(page.locator('p.hero-sub')).toContainText(/just launched in/i);
    await expect(page.locator('p.hero-sub')).toContainText('Mumbai');
    await expect(page.getByRole('button', { name: /List your property/i }).first()).toBeVisible();

    // The leak assertion. "Baner" is a Pune locality chip, so its presence on a Mumbai home means
    // Pune content is being served under another city's name.
    await expect(baner).toHaveCount(0);
  });

  test('shows an empty listings page rather than Pune listings', async ({ page, cities }) => {
    await cities.set('mumbai', true);

    // Positive control: the zero below only means a city boundary if this page demonstrably renders Pune's grid.
    const cards = page.locator('a[href^="/property/"]');
    await page.goto('/listings?deal=buy');
    await expect(cards.first()).toBeVisible();

    await page.goto('/');
    await selectCity(page, 'Mumbai');
    await page.goto('/listings?deal=buy');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
    await expect(page.getByRole('heading', { name: /No listings in Mumbai yet/i })).toBeVisible();

    // Not "some cards" — none. A city-scoped query that silently falls back to the whole catalogue
    // still renders a plausible page, so the count has to be zero for this to mean anything.
    await expect(cards).toHaveCount(0);
  });

  test('switching back restores the city that does have inventory', async ({ page, cities }) => {
    await cities.set('mumbai', true);
    await page.goto('/');
    await selectCity(page, 'Mumbai');
    await selectCity(page, 'Pune');

    await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
  });

  test('taken back offline underneath the shopper, it moves them home', async ({ page, cities }) => {
    await cities.set('mumbai', true);
    await page.goto('/');
    await selectCity(page, 'Mumbai');

    // Revert the un-launched city, or the shopper is stuck in a city the server stops serving.
    await cities.set('mumbai', false);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('draazy-settings-change')));

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
    await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('draazyCity'))).toBe('Pune');
  });

  test('cancelling the waitlist prompt for a coming-soon city is a true no-op', async ({ page }) => {
    // No `cities.set`: Mumbai's default state is the subject; declining the prompt must leave nothing behind.
    await page.goto('/');
    const pill = page.getByRole('button', { name: /^City: / }).first();
    await pill.click();
    await page
      .getByRole('listbox', { name: 'Select city' })
      .getByRole('button', { name: /Mumbai/ })
      .click();

    const modal = page.getByRole('heading', { name: /Join the Mumbai waitlist/i });
    await expect(modal).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(modal).toHaveCount(0);
    await expect(pill).toHaveAttribute('aria-label', 'City: Pune');
    await expect(page.getByText(/isn't live in/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
    expect(await page.evaluate(() => localStorage.getItem('draazyCity'))).not.toBe('Mumbai');
  });
});
