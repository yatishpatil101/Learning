import { test, expect } from '../../fixtures/base.js';

/* Redirects and the 404 catch-all.
 *
 * Six routes in App.jsx exist only to forward somewhere else, and one exists to
 * catch everything that matches nothing. None had a spec, which is a real gap:
 * a redirect is invisible when it works and indistinguishable from a dead link
 * when it breaks. Three of them are permanent public URLs (`/share-flat` from
 * before the Flatmates rename, `/docs` and `/help-center` as guessable aliases),
 * so external links and search results depend on them.
 *
 * The 404 stub matters for the same reason in reverse: an unknown URL must land
 * on something that says so and offers a way back, not a blank consumer shell.
 */

const PUBLIC_REDIRECTS = [
  ['/map', '/listings', 'view=map'],
  ['/docs', '/help', null],
  ['/help-center', '/help', null],
  ['/share-flat', '/flatmates', null],
];

test.describe('Route redirects', () => {
  for (const [from, to, query] of PUBLIC_REDIRECTS) {
    test(`${from} forwards to ${to}`, async ({ page }) => {
      await page.goto(from);
      // Match on the resolved pathname, not a glob: `/help-center` already
      // satisfies a "contains /help" glob, so a glob wait returns before the
      // redirect has happened and the spec passes against a broken route.
      await page.waitForURL((u) => new URL(u).pathname === to, { timeout: 15_000 });

      const url = new URL(page.url());
      expect(url.pathname).toBe(to);
      if (query) expect(url.search).toContain(query);

      // The target actually rendered — a redirect into a blank page is not a fix.
      await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    });
  }

  test('/owner-hub forwards into the dashboard hub anchor', async ({ page, login }) => {
    await login.asOwner();
    await page.goto('/owner-hub');
    await page.waitForURL((u) => new URL(u).pathname === '/dashboard', { timeout: 15_000 });
    expect(page.url()).toContain('#owner-hub');
  });

  test('/admin/support forwards to the services desk that absorbed it', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/support');
    await page.waitForURL((u) => new URL(u).pathname === '/admin/services', { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/admin/services');
  });
});

test.describe('404 catch-all', () => {
  test('an unknown URL renders the not-found page with a way back', async ({ page, consoleErrors }) => {
    await page.goto('/this-route-does-not-exist');

    await expect(page.getByText('404', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse properties' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('the not-found page keeps the consumer chrome so the user is not stranded', async ({ page }) => {
    await page.goto('/nope/nested/deep');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    // Escape hatch works.
    await page.getByRole('link', { name: 'Browse properties' }).click();
    await page.waitForURL('**/listings**');
    expect(new URL(page.url()).pathname).toBe('/listings');
  });

  test('an unknown /help article resolves to the help not-found state, not the app 404', async ({ page }) => {
    // Help articles are compiled into a virtual module and resolved client-side;
    // a missing slug is a help-centre concern, not a routing one.
    await page.goto('/help/a/zzz-no-such-article', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/could not find that article/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
  });
});
