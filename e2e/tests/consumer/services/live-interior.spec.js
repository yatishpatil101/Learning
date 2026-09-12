/**
 * `/services/interior-renovation` against the **live** backend.
 *
 * ## The division of labour with `live-interior-lead.spec.js`
 *
 * That file owns the submit: it files a lead, reads it back over HTTP, and proves the brief and
 * the typed contact survive the round trip — including the deliberate rule that the lead carries
 * *the contact the customer typed*, not the account holder (`live-interior-lead.spec.js:78`).
 * None of that is repeated here.
 *
 * What is left is the page itself, which is the part the retired mock owned and which is almost
 * entirely client-side: this is a bespoke page rather than a `ServiceLanding`, and its interactive
 * touches — the FAQ accordion and the before/after reveal slider — talk to nothing. They are worth
 * a test because they are easy to break silently, not because the server has an opinion about them.
 *
 * The one claim the mock structurally could not make is the prefill. `form` is initialised from
 * `isIn ? user?.name : ''` (`InteriorRenovation.jsx:61`); mock-side `user` is whatever the test
 * wrote into `draazyUser`, so asserting it proves localStorage round-trips and nothing else.
 * Live it is `GET /auth/me`. That pairs with the override rule above to make a complete statement:
 * the form *opens* addressed to the session, and the customer may then redirect it — here we prove
 * the default, there they prove it is not sticky.
 */
import { expect, test, ACTORS } from '../../../fixtures/live.js';
import { apiLogin, signIn } from '../../../helpers/liveAuth.js';

const PAGE = '/services/interior-renovation';

test.describe('interior & renovation landing, live', () => {
  test('the hero, the transformation panel and the consultation form render for a signed-out visitor', async ({ page }) => {
    await page.goto(PAGE);

    await expect(page.locator('h1')).toContainText('Interiors that');
    await expect(page.locator('h1')).toContainText('feel like home');
    await expect(page.getByRole('heading', { name: 'See the Transformation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Book a Free Design Consultation' })).toBeVisible();
  });

  test('the FAQ accordion opens the question that was clicked, and only that one', async ({ page }) => {
    await page.goto(PAGE);

    const questions = page.locator('.faq-q');
    await expect(questions.first()).toHaveAttribute('aria-expanded', 'false');

    await questions.first().click();
    await expect(questions.first()).toHaveAttribute('aria-expanded', 'true');
    /* The mock stopped at "the one I clicked opened". An accordion that had started opening every
       panel at once would have passed that, and would look obviously wrong to a visitor. */
    await expect(questions.nth(1)).toHaveAttribute('aria-expanded', 'false');
  });

  test('the before/after slider moves the reveal divider', async ({ page }) => {
    await page.goto(PAGE);

    const range = page.locator('.ba-range');
    const after = page.locator('.ba-after');
    const before = await after.getAttribute('style');
    expect(before).toBeTruthy();

    await range.focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');

    // `getAttribute()` does not retry; `not.toHaveAttribute` waits for exactly the change expected.
    await expect(after).not.toHaveAttribute('style', before);
  });

  test('booking the consultation is gated behind sign-in, and the gate remembers where it interrupted', async ({ page }) => {
    await page.goto(PAGE);

    await page.getByRole('button', { name: 'Book My Consultation' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
    /* `next=` is the half that makes this an interruption rather than a dead end — a gate that
       forgot would send someone who came to book interiors back to the home page. */
    await expect(page).toHaveURL(new RegExp(`next=${encodeURIComponent(PAGE).replace(/\//g, '%2F')}`));
  });

  test('for a signed-in visitor the form opens addressed to the session, not to this browser', async ({ page }) => {
    const { user } = await apiLogin(ACTORS.buyer);
    expect(user.name).toBeTruthy();

    await signIn(page, ACTORS.buyer);
    await page.goto(PAGE);

    /* Compared against what the API just returned rather than a literal, so a reseed cannot turn a
       real regression into a passing test — and a page that had gone back to reading
       `draazyUser` cannot pass by coincidence of the fixture using the same name. */
    await expect(page.locator('input[data-err="name"]')).toHaveValue(user.name);
    await expect(page.locator('[data-err="mobile"] input')).toHaveValue(new RegExp(user.mobile.slice(-10)));
  });

  test('the page loads without console errors', async ({ page, consoleErrors }) => {
    await page.goto(PAGE);
    await expect(page.locator('h1')).toContainText('Interiors that');
    expect(consoleErrors).toEqual([]);
  });
});
