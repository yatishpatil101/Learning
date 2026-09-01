/**
 * `/services/packers-movers` against the **live** backend.
 *
 * ## The division of labour with `live-service-landing-ticket.spec.js`
 *
 * That file already drives this exact page's quote form end to end: it submits, then reads the
 * packers board over HTTP and asserts the flow request names the ticket the server minted
 * (`live-service-landing-ticket.spec.js:57`). Everything downstream of the submit button is its
 * job, and duplicating it here would only mean two files to update when the board changes.
 *
 * What is left, and what this file is for, is everything *upstream* of that submit — the parts the
 * retired mock owned:
 *
 *   - the estimator, which is pure client-side arithmetic (`PackersEstimator.jsx`, a table of base
 *     ranges times a distance/packing/floor factor). It talks to nothing, and it is worth saying so
 *     rather than implying the server prices moves;
 *   - the sign-in gate, which fires in the handler before any request is made
 *     (`ServiceLanding.jsx:81`) — so it is the one part of the submit path the ticket spec cannot
 *     reach, because that spec is signed in;
 *   - and the prefill, which is the claim the mock structurally could not make. `initial` is
 *     `isIn ? user?.name : ''` (`ServiceLanding.jsx:50`). Mock-side `user` is whatever the test
 *     wrote into `puneNestUser`, so asserting it proves localStorage round-trips. Live it is the
 *     session, which matters here more than on most pages: the live branch deliberately does *not*
 *     send the form's contact pair to the server (`ServiceLanding.jsx:112-113` — the server copies
 *     name and number off the session instead), so if the prefill and the session ever disagreed
 *     the customer would be shown one identity and the desk handed another, with nothing failing.
 */
import { expect, test, ACTORS } from '../../../fixtures/live.js';
import { apiLogin, signIn } from '../../../helpers/liveAuth.js';

const PAGE = '/services/packers-movers';

/** The estimator section, located by its heading so a second `.gradient-text` on the page — the
 *  hero has one — cannot be mistaken for the output. */
const estimator = (page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Instant moving-cost estimate' }) });

test.describe('packers & movers landing, live', () => {
  test('the hero, the quote card and the estimator render for a signed-out visitor', async ({ page }) => {
    await page.goto(PAGE);

    await expect(page.locator('h1')).toContainText('Stress-free home shifting');
    await expect(page.locator('h1')).toContainText('in & from Pune');
    await expect(page.getByRole('heading', { name: 'Get a Free Quote' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Instant moving-cost estimate' })).toBeVisible();
  });

  test('the estimate is arithmetic on the home size, not a fixed banner', async ({ page }) => {
    await page.goto(PAGE);

    const est = estimator(page);
    const out = est.locator('.gradient-text');

    // Defaults: 2 BHK, within Pune, standard packing, ground/lift.
    await expect(out).toContainText('₹9,000');
    await expect(out).toContainText('₹18,000');

    await est.locator('.pn-dropdown__trigger').first().click();
    await page.getByRole('option', { name: '4 BHK / Villa' }).click();

    /* Both bounds, both directions. Asserting only that the text changed would be satisfied by a
       widget that had started rendering an error, and asserting only the new figures would be
       satisfied by one that renders every range at once. */
    await expect(out).toContainText('₹22,000');
    await expect(out).toContainText('₹40,000');
    await expect(out).not.toContainText('₹9,000');
  });

  test('the quote is gated behind sign-in, and the gate remembers where it interrupted', async ({ page }) => {
    await page.goto(PAGE);

    await page.getByRole('button', { name: 'Request Free Quote' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
    /* The mock stopped at `reason=service`. `next=` is the half that makes this an interruption
       rather than a dead end, and it is also what keeps the gate honest about *which* service was
       being asked for — a gate that forgot would send a packers enquiry back to the home page. */
    await expect(page).toHaveURL(new RegExp(`next=${encodeURIComponent(PAGE).replace(/\//g, '%2F')}`));
  });

  test('for a signed-in visitor the form is addressed to the session, not to this browser', async ({ page }) => {
    const { user } = await apiLogin(ACTORS.buyer);
    expect(user.name).toBeTruthy();

    await signIn(page, ACTORS.buyer);
    await page.goto(PAGE);

    const form = page.locator('form');
    await expect(form.getByRole('button', { name: 'Request Free Quote' })).toBeVisible();

    /* Compared against what the API just returned rather than a literal, so a reseed cannot turn a
       real regression into a passing test — and so a page that had gone back to reading
       `puneNestUser` cannot pass by coincidence of the fixture using the same name. */
    await expect(form.locator('input[data-err="name"]')).toHaveValue(user.name);
    await expect(form.locator('[data-err="mobile"] input')).toHaveValue(new RegExp(user.mobile.slice(-10)));
  });

  test('the page loads without console errors', async ({ page, consoleErrors }) => {
    await page.goto(PAGE);
    await expect(page.locator('h1')).toContainText('Stress-free home shifting');
    expect(consoleErrors).toEqual([]);
  });
});
