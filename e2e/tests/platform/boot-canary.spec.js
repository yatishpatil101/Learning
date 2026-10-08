import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';

/* Boot canary: an import-cycle TDZ error thrown during bootstrap passes lint and the Vite build, since only a
   browser executes it. Assertions stay crude: no pageerror, non-empty body, a structural landmark. Never skip. */

/** Anything shorter than this is a spinner or a stray character, not a rendered page. */
const MIN_RENDERED_CHARS = 20;

/** Attached before navigating: the error is thrown during bootstrap, so a later listener passes a blank app. */
function trapPageErrors(page) {
  return trackErrors(page);
}

/** Assert the page mounted and threw nothing on the way. */
async function expectBooted(page, errors, label, landmark) {
  // Errors first: a TDZ crash leaves a blank body, so reporting "body was empty"
  // would bury the message that actually names the broken module.
  expect(errors, `${label} threw during boot`).toEqual([]);

  const text = ((await page.locator('body').innerText()) || '').trim();
  expect(text.length, `${label} rendered an empty body`).toBeGreaterThan(MIN_RENDERED_CHARS);
  await expect(landmark, `${label} did not mount its own screen`).toBeVisible({ timeout: 20_000 });
}

test.describe('Boot canary', () => {
  test('the public home route renders', async ({ page }) => {
    const errors = trapPageErrors(page);
    await page.goto('/');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    await expectBooted(page, errors, '/', page.locator('.hero-search-wrap'));
  });

  test('the listings route renders', async ({ page }) => {
    const errors = trapPageErrors(page);
    await page.goto('/listings');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    await expectBooted(page, errors, '/listings', page.locator('a[href^="/property/"]').first());
  });

  test('the authenticated dashboard renders', async ({ page, login }) => {
    const errors = trapPageErrors(page);
    // `loginAsOwner` seeds localStorage and opens the app, so the trap is already
    // attached for the first navigation it performs.
    await login.asOwner();
    await page.goto('/dashboard');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    await expectBooted(page, errors, '/dashboard', page.getByRole('navigation', { name: 'Dashboard sections' }));
  });

  test('the admin console renders', async ({ page, login }) => {
    const errors = trapPageErrors(page);
    // Signs in through /staff-login (password + authenticator) and lands on /admin.
    await login.asAdmin();
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    await expectBooted(page, errors, '/admin', page.getByRole('heading', { name: 'Dashboard' }));
  });
});
