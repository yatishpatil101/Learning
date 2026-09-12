import { test, expect } from '../../fixtures/live.js';

/**
 * What a shopper sees once a second city is actually live — against the real roster.
 *
 * ## Why this file exists
 *
 * `platform/city-propagation.spec.js` asserted all of this against the mock. To reach a second
 * live city it wrote `live: true` into the `draazyDB_v5` roster in local storage and fired
 * `draazy-settings-change`. Once `providers/mock/cityProvider.js` was deleted that write had no
 * reader: it still landed, and it still changed nothing. That is the worse kind of dead test — it
 * does not error, it goes green while asserting about a city that never launches. So the four
 * propagation tests were removed from that file rather than left lying, with the ideas explicitly
 * held open for this port. This is that port; `city-propagation.spec.js` is retired by it.
 *
 * `cities.set(slug, live)` writes through `PATCH /admin/cities/{slug}` — the route the admin
 * console uses — and the page reads back through the public `GET /cities`. Operator and shopper
 * therefore look at one server-owned roster, which is the whole point: the bug this lane was built
 * to catch was an operator taking Mumbai live in a row no visitor's browser had ever read.
 *
 * ## What is asserted here and not in `live-geo-policy.spec.js`
 *
 * That file proves the roster *reaches* the browser: a live city stops prompting for the waitlist,
 * a toggle lands without a reload, an untouched city keeps its built-in policy. It stops at the
 * heading. This file starts there and asks the question that actually protects the trust promise —
 * whether Pune's inventory leaks into a city that has none. A city-aware `h1` over a grid of Baner
 * flats is the failure users would report, and no assertion above the fold catches it.
 *
 * Mumbai is the vehicle because the seed has no inventory for it. If that ever changes, the empty
 * states below start failing honestly rather than passing vacuously — the `h1` assertions would
 * still hold while the leak assertions would not, which is the right way round.
 */

/** Pick a city through the picker, as a shopper does, and wait for the page to agree. */
async function selectCity(page, city) {
  const pill = page.getByRole('button', { name: /^City: / }).first();
  const list = page.getByRole('listbox', { name: 'Select city' });

  /* The picker is opened inside `toPass` rather than clicked once. The roster arrives from
     `GET /cities` after first paint, so a single click can open the list while the city is still
     filed under "Coming soon", and the option would resolve to the waitlist entry instead. Retrying
     the open-and-look asserts on the settled roster without sleeping for it. */
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

    // The positive control. `toHaveCount(0)` below is only evidence if the chip is there to lose:
    // a home that stopped rendering locality chips at all, for any reason, would otherwise satisfy
    // the leak assertion perfectly.
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

    // Pune's grid first, as the positive control: the zero asserted below has to be the *absence of
    // something this page demonstrably renders*, or a listings route broken for every city would
    // read as a clean city boundary.
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

    // The operator un-launching the city the shopper is standing in. Without the revert they would
    // be left browsing a city the server no longer serves, with a picker that will not offer it
    // back — a dead end reachable only by clearing storage.
    await cities.set('mumbai', false);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('draazy-settings-change')));

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
    await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('draazyCity'))).toBe('Pune');
  });

  test('cancelling the waitlist prompt for a coming-soon city is a true no-op', async ({ page }) => {
    // No `cities.set` here: Mumbai's default state is the subject. This is the other half of
    // `live-geo-policy`'s "a city taken live is a destination" — that one proves the prompt goes
    // away once the server says live, this proves declining it leaves nothing behind.
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
