import { test, expect } from '../../fixtures/base.js';

/* Ops → Drafting desk (D173), **in mock mode** — which is now one assertion, not seven.
 *
 * ## What changed, and why this file shrank
 *
 * D184: the desk's status filter sends `?status=` in the server's vocabulary (`new`, `assigned`,
 * `in-progress`, `draft-shared`, `changes-requested`, …) while `lib/serviceFlow.js` rows carry the
 * stepper's (`docs_review`, …). In mock mode most filters therefore matched nothing and the desk
 * looked idle when it was not — the worst failure a work queue has. A translation table between the
 * two was rejected by name in the register, and again here: it exists only to make a demo look
 * right, and it is a second vocabulary to keep in sync with a third (the server's own list).
 *
 * So the mock provider's three desk operations were removed and the screen gates itself on
 * `isHttpDomain('serviceRequest')`. In mock mode it now says plainly that it needs the live API
 * rather than rendering a queue it cannot filter. The five disclosure tests that used to live here
 * needed mock rows to exist, so they could not stay; they were **moved, not dropped** — see
 * `tests/ops/live-drafting-desk.spec.js`, which runs under `playwright.live.config.js`.
 *
 * ## What is still verifiable with no backend running
 *
 * One thing: the refusal itself — that mock mode shows the offline panel and *not* an empty table,
 * which is precisely the confusion D184 closed. An empty table is indistinguishable from a finished
 * desk; a panel that names the cause is not. That is a claim about mock mode, so mock mode is the
 * only place it can be made.
 *
 * ## The route guard went to `live-drafting-desk.spec.js`
 *
 * It used to assert here that an unauthenticated visitor is bounced to staff-login. That is the
 * only refusal a browser with no server behind it can observe, and it is the weakest of the three
 * that matter on a screen which discloses PAN and Aadhaar numbers. The live version keeps it and
 * adds the two that carry the weight: a signed-in **customer** is bounced by the same router, and
 * `GET /service-requests` answers that customer with his own matters rather than the desk's queue. */

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Ops → Drafting desk (mock mode)', () => {
  test('with no live API the desk says so, and does not render an empty queue', async ({ page, login, consoleErrors }) => {
    await seedConsent(page);
    await login.asStaff('Rental');

    await page.goto('/ops/drafting-desk');
    await expect(page.getByRole('heading', { name: 'Drafting desk' })).toBeVisible();

    // The whole point of D184: the honest answer, not a queue that reads as finished.
    await expect(page.getByText(/needs the live API/i)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    // And nothing invites an action that cannot work.
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeDisabled();

    // A retired provider must not surface as a thrown loader — the screen refuses before it asks.
    expect(consoleErrors).toEqual([]);
  });
});
