import { test, expect } from '../../fixtures/base.js';

/* Boot canary — does the application actually render? (tech-debt D208)
 *
 * On 2026-08-11 the whole app booted to an empty `<body>` on every route. Two
 * providers read `MAX_PAGE_SIZE` at module scope; `services/http.js` imports
 * `services/config.js`, `config.js` eagerly globs every provider, and that cycle
 * meant the providers were evaluated *inside* `http.js` while its exports were
 * still in their temporal dead zone. `Cannot access 'MAX_PAGE_SIZE' before
 * initialization` was thrown during bootstrap, before React mounted.
 *
 * `npm run lint`, `npm run check` and `npm run check:size` were all green while
 * that was true, because a Vite build resolves an import cycle perfectly happily
 * and only a browser ever executes it. `scripts/check-provider-cycle.mjs` now
 * catches the one known shape statically; this spec is the backstop that catches
 * the shapes nobody has thought of yet, and it is the reason D208 says **one e2e
 * spec must actually render a page before any frontend wave is called verified**.
 *
 * The assertions are deliberately the two crudest facts available:
 *
 *   (a) zero `pageerror` events — an uncaught throw anywhere in bootstrap, and
 *   (b) `body.innerText()` is non-empty — the app painted *something*.
 *
 * Neither knows anything about the product, and that is the point: a canary that
 * asserts on copy or a specific element starts failing for design reasons and
 * gets weakened until it no longer says what it exists to say. `pageerror` is
 * used directly rather than the `consoleErrors` fixture because that fixture
 * (correctly, for its purpose) filters by provenance; here nothing is tolerable,
 * because an uncaught exception in our own bundle is exactly the failure mode.
 *
 * Routes are chosen for the distinct *module graphs* they pull in, not for
 * coverage of their features: public shell, the search/listing stack, an
 * authenticated consumer surface, and the admin bundle. The 2026-08-11 crash was
 * detonated by a provider that none of the failing screens used, so the value is
 * in loading different halves of the graph, not in visiting more pages.
 *
 * This spec must never be marked skipped or flaky-tolerated. If it is red, the
 * app is down.
 */

/** Anything shorter than this is a spinner or a stray character, not a rendered page. */
const MIN_RENDERED_CHARS = 20;

/**
 * Attach the error trap *before* navigating.
 *
 * The failure this guards is thrown during bootstrap, so a listener attached
 * after `goto` resolves would miss the only error that matters and the spec
 * would pass against a blank app — the exact false green D208 is about.
 */
function trapPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`));
  return errors;
}

/** Assert the page mounted and threw nothing on the way. */
async function expectBooted(page, errors, label) {
  // Errors first: a TDZ crash leaves a blank body, so reporting "body was empty"
  // would bury the message that actually names the broken module.
  expect(errors, `${label} threw during boot`).toEqual([]);

  const text = ((await page.locator('body').innerText()) || '').trim();
  expect(text.length, `${label} rendered an empty body`).toBeGreaterThan(MIN_RENDERED_CHARS);
}

test.describe('Boot canary', () => {
  test('the public home route renders', async ({ page }) => {
    const errors = trapPageErrors(page);
    await page.goto('/');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    await expectBooted(page, errors, '/');
  });

  test('the listings route renders', async ({ page }) => {
    const errors = trapPageErrors(page);
    await page.goto('/listings');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    await expectBooted(page, errors, '/listings');
  });

  test('the authenticated dashboard renders', async ({ page, login }) => {
    const errors = trapPageErrors(page);
    // `loginAsOwner` seeds localStorage and opens the app, so the trap is already
    // attached for the first navigation it performs.
    await login.asOwner();
    await page.goto('/dashboard');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    await expectBooted(page, errors, '/dashboard');
  });

  test('the admin console renders', async ({ page, login }) => {
    const errors = trapPageErrors(page);
    // Signs in through the real /staff-login quick-access button and lands on /admin.
    await login.asAdmin();
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 20_000 });
    await expectBooted(page, errors, '/admin');
  });
});
