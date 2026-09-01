import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew, grantAadhaarBadge } from '../../../helpers/liveAuth.js';

/* The verify funnel on the account surface, against the live API.
 *
 * **This spec changed subject when it moved onto the live suite, and that is the point.** On mocks
 * it asserted tech-debt D21: modal → DigiLocker mock → the green "ID verified" pill renders. That
 * transition does not exist live and must not. `POST /me/verification/aadhaar` answers **202 with a
 * hosted consent URL**; the badge is granted only when the signed DigiLocker webhook lands, so
 * nothing the browser does can earn it. A live version of the old test would have to fake the
 * webhook, at which point it would be asserting the fake.
 *
 * So the live subject splits in two, and the first half is the one the mock suite never had:
 * **starting does not grant.** A client that could talk itself into a trust badge is a security
 * defect, and this is the spec that would notice. The second half — the badge renders once the
 * provider says yes — is driven through `POST /me/verification/aadhaar/simulate`, the `@DevOnly`
 * endpoint that exists because a dev backend never receives the real callback (D122). That is not
 * the same as faking the webhook in the test: the endpoint runs the production `handleWebhook` path,
 * so what the badge assertion is standing on is the real grant, reached by the one door a developer
 * machine has.
 *
 * What the neighbours own, unchanged: `kyc-growth-levers` asserts the opt-in CTA disappearing,
 * `verify-payoff` (D95) asserts the store flip and the one-shot Featured perk, `seeker-verify`
 * asserts only that the flatmates CTA opens the modal. */

const PROFILE = '/dashboard?tab=profile';

/* A freshly registered account rather than one of the seeded buyers.
 *
 * This spec needs an actor who starts unverified. Neither seeded candidate works: Rahul is
 * `verified = true` in the seed, so the control assertion below would fail on the first line, and
 * Arjun's `verified = false` is published as an invariant in `docs/system/fixture-registry.md`,
 * which means leaning on him risks quietly invalidating another spec's premise. The e2e database
 * persists for the whole run, so that damage would surface somewhere else entirely.
 *
 * `POST /auth/login` auto-registers an unknown mobile as an unverified buyer, which is exactly the
 * starting state this funnel expects. */

test('Starting DigiLocker verification hands off to consent and grants no badge', async ({ page }) => {
  await signedInAsNew(page);                   // brand-new account, so NOT verified

  /* The consent URL is a real navigation the app performs via `window.location.assign`. In dev and
   * e2e `MockKycProvider` issues `https://mock.kyc.local/verify/<ref>` — a host that does not
   * resolve, so left alone the browser lands on a network error and the "no badge" assertions below
   * would pass for the wrong reason. Stubbing it keeps the tab alive and, more importantly, turns
   * "the app tried to redirect" into something assertable. */
  await page.route(/mock\.kyc\.local/, (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<h1 id="consent-stub">DigiLocker consent</h1>',
  }));

  /* The start response is captured in a route handler rather than through `waitForResponse`,
   * because the app redirects the moment it reads the body: by the time a test-side
   * `response.json()` runs, Chromium has already discarded the buffer for a navigated-away
   * response. Reading it here — while the response still belongs to us — is deterministic, and
   * `route.fulfill({ response })` hands the app the untouched original, so the redirect it
   * performs next is driven by the server's real payload. */
  let start = null;
  await page.route(/\/me\/verification\/aadhaar(\?|$)/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    start = { status: response.status(), body: await response.json() };
    await route.fulfill({ response });
  });

  await page.goto(PROFILE);

  // Control — unverified means unverified, or "no badge appeared" below is vacuous. Both funnel
  // entry points are present (identity-header chip + badge-section button); the green pill is not.
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Get verified/i })).toBeVisible();
  await expect(page.getByText('ID verified', { exact: true })).toHaveCount(0);

  // Open the modal — DigiLocker-only, never an Aadhaar field on a PuneNest page.
  await page.getByRole('button', { name: /Get verified/i }).click();
  const modal = page.getByRole('dialog', { name: 'Get your Verified badge' });
  await expect(modal).toBeVisible();
  const digilocker = modal.getByRole('button', { name: /continue with digilocker/i });
  await expect(digilocker).toBeVisible();

  await digilocker.click();

  // The browser is handed to the hosted consent page rather than the app pretending to verify.
  await expect(page).toHaveURL(/mock\.kyc\.local/, { timeout: 15000 });

  // The server accepted the start but did not decide it: 202, with a handle to somewhere else.
  expect(start).not.toBeNull();
  expect(start.status).toBe(202);
  expect(start.body.verificationUrl).toBeTruthy();
  expect(start.body.ref).toBeTruthy();

  /* And the badge was not granted. Re-entering the app re-reads `GET /me/verification/aadhaar`
   * from the server, so this is the server's answer, not a stale render: still unverified, still
   * nudging. Asserting after a fresh navigation matters — a client-side optimistic flip would
   * survive an in-page check and be caught here.
   *
   * The positive assertions come first on purpose. This navigation used to carry
   * `waitUntil: 'networkidle'`, which on a client-rendered app resolves before `main.jsx` has run;
   * with the `toHaveCount(0)` leading, a page that had not rendered yet satisfied it instantly and
   * the strongest claim in this test was the one most likely to be vacuous. Waiting for the two
   * CTAs to be *present* first makes the absence of the badge a statement about a rendered
   * screen — and it is a stronger gate than any load state, because it is the app's own output. */
  await page.goto(PROFILE);
  await expect(page.getByRole('button', { name: /Get verified/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();
  await expect(page.getByText('ID verified', { exact: true })).toHaveCount(0);
});

test('the identity-header "ID not verified" chip is a second funnel entry point', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto(PROFILE);

  // The amber header chip is a button, not decoration — it opens the same modal
  // as the badge-section CTA, so an unverified user can start the funnel from
  // either place.
  await page.getByRole('button', { name: /ID not verified/i }).click();
  await expect(page.getByRole('dialog', { name: 'Get your Verified badge' })).toBeVisible();
});

/* The other half of D21, and the reason the test above is not the whole story.
 *
 * "Starting grants nothing" is only meaningful if something *can* grant it — otherwise the spec
 * above would pass just as happily against a badge feature that was entirely broken. This is the
 * pair that makes it a real assertion rather than a permanent negative. */
test('once the provider confirms, the badge renders and the funnel CTAs retire', async ({ page }) => {
  const mobile = await signedInAsNew(page);

  await page.goto(PROFILE);
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();

  // The grant happens server-side, through the real webhook handler. Nothing in the browser is
  // touched, so what the reload below renders can only have come from the server.
  await grantAadhaarBadge(mobile);

  await page.reload();

  await expect(page.getByText('ID verified', { exact: true })).toBeVisible();
  // Both entry points retire together — a verified user offered "Get verified" is a bug that has
  // shipped before, because the two live in different components reading the same hook.
  await expect(page.getByRole('button', { name: /ID not verified/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Get verified/i })).toHaveCount(0);
});
