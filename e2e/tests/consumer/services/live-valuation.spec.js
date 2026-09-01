/**
 * `/services/property-valuation` against the **live** backend.
 *
 * ## What this file is, and what it deliberately is not
 *
 * The valuation landing is unusual among the service pages: almost all of it is arithmetic. The
 * instant estimate is a `useMemo` over a hard-coded rate table (`PropertyValuation.jsx:75`), and
 * the locality list comes from the static registry in `data/localities.js`, not from `GET
 * /localities`. So converting the mock spec was never going to be "point it at the server and
 * watch the numbers change" — under either backend those four tests assert the same client-side
 * behaviour, and saying so plainly is more useful than implying otherwise.
 *
 * What the mock could not assert, and what this file adds, is the **third** state of the form.
 * `form` is initialised from `isIn ? user?.name : ''` (`PropertyValuation.jsx:61`). Mock-side
 * `user` is whatever the test wrote into `puneNestUser`, so a prefill test there proves only that
 * localStorage round-trips. Live it is the session — `GET /auth/me` — which is the claim actually
 * worth making: the certified-report form addresses the person who is signed in, not a name this
 * browser happened to be holding.
 *
 * The submit itself is already covered: `live-property-integration.spec.js:2314` drives this page's
 * form through `POST /service-requests` and asserts the record round-trips. This file stops at the
 * boundary of that test rather than duplicating it.
 *
 * Fixture: `ACTORS.buyer`, a seeded account whose name and mobile the assertions read from
 * `apiLogin` rather than hard-coding, so a reseed cannot turn a real regression into a passing test
 * or a renamed fixture into a false failure.
 */
import { expect, test, ACTORS } from '../../../fixtures/live.js';
import { apiLogin, signIn } from '../../../helpers/liveAuth.js';

const PAGE = '/services/property-valuation';

test.describe('property valuation landing, live', () => {
  test('the hero and both cards render for a signed-out visitor', async ({ page }) => {
    await page.goto(PAGE);

    await expect(page.locator('h1')).toContainText('Know what your');
    await expect(page.locator('h1')).toContainText('property is really worth');
    await expect(page.getByRole('heading', { name: 'Instant Valuation Estimate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Request a Certified Valuation Report' })).toBeVisible();
  });

  test('the instant estimate recomputes from the carpet area, and is a figure not a placeholder', async ({ page }) => {
    await page.goto(PAGE);

    const widget = page.locator('.svc-quote');
    const out = widget.locator('.gradient-text');

    /* Positive anchor first. `est` returns `null` for an area of 0 and the widget renders an em
       dash, so "the number changed" is satisfiable by two different placeholders — the assertion
       below only means something once there is a real figure to move. */
    await expect(out).toContainText('₹');
    const before = await out.innerText();

    await widget.locator('input[type=number]').fill('2500');
    await expect(out).not.toHaveText(before);
    // And still a figure afterwards: `fill` with a value the memo rejects would also change the text.
    await expect(out).toContainText('₹');
  });

  test('the certified report is gated behind sign-in, and the gate remembers where it interrupted', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('form').getByRole('button', { name: 'Request Valuation' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
    /* The mock stopped at `reason=service`. The handler also writes `next=`
       (`PropertyValuation.jsx:98`), which is the half that makes the gate an interruption rather
       than a dead end — the draft is restored on return only if the return happens. */
    await expect(page).toHaveURL(new RegExp(`next=${encodeURIComponent(PAGE).replace(/\//g, '%2F')}`));
  });

  test('for a signed-in visitor the form is addressed to the session, not to this browser', async ({ page }) => {
    const { user } = await apiLogin(ACTORS.buyer);
    expect(user.name).toBeTruthy();

    await signIn(page, ACTORS.buyer);
    await page.goto(PAGE);

    const form = page.locator('form');
    await expect(form.getByRole('button', { name: 'Request Valuation' })).toBeVisible();

    /* Compared against the values the API just returned, not against a literal. A hard-coded
       'Rohan Sharma' would keep passing if the page had gone back to reading `puneNestUser` and
       the seed happened to use the same name — which is exactly the failure this page's live
       conversion exists to rule out. */
    await expect(form.locator('input[data-err="name"]')).toHaveValue(user.name);
    await expect(form.locator('[data-err="mobile"] input')).toHaveValue(new RegExp(user.mobile.slice(-10)));

    // And the gate is genuinely open now: submitting no longer bounces to /signin.
    await form.getByRole('button', { name: 'Request Valuation' }).click();
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('the page loads without console errors', async ({ page, consoleErrors }) => {
    await page.goto(PAGE);
    await expect(page.locator('h1')).toContainText('Know what your');
    expect(consoleErrors).toEqual([]);
  });
});
