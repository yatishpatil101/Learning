/**
 * `/home-loans` against the **live** backend: the public page, and the gate that stands in
 * front of its quote form.
 *
 * ## Why this exists when two live specs already touch these routes
 *
 * Neither of them covers this page's public half or its gate:
 *
 * - `live-emi-calculator.spec.js` drives `/emi-calculator`, which is `EmiCalculator.jsx` — a
 *   *different component* from the compact `LoanEmiCalc.jsx` embedded here (`HomeLoans.jsx:82`).
 *   The two share the product idea, not the code, so neither one's coverage implies the other's.
 * - `live-loans-team.spec.js` drives this exact page but only ever signed **in**, and asserts
 *   which desk the enquiry lands on. It never sees the hero, the calculator, or what happens to
 *   someone signed out. That spec owns "the enquiry reaches the loans desk"; this one does not
 *   re-assert it.
 *
 * ## What is actually server-observable here, and what is not
 *
 * Most of this page is client-side: the hero is copy from `services.json`, and the EMI figure is
 * `computeEmi` running in the browser. Converting those proves nothing new about the server, and
 * they are kept only because a mock spec is being deleted and these claims should not vanish with
 * it — they cost nothing to assert on a live build and one of them (the calculator rendering at
 * all) is the kind of thing a bad chunk split breaks.
 *
 * The **gate** is the reason this is a live spec rather than a mock one. The mock version asserted
 * only that a signed-out press changes the URL. That is half the claim, and the safe half: a page
 * can redirect you to sign-in *and still have filed the enquiry*, and the customer would never
 * know, because the redirect looks identical either way. The claim worth making is that nothing
 * reached the desk — and that can only be asked of a server.
 *
 * ## What the mutation proof turned up, and why the assertion is kept anyway
 *
 * Deleting the client gate (`ServiceLanding.jsx:82`) does **not** turn the desk assertion red. Two
 * mutations were run: bypassing the redirect outright kills the URL assertions but never reaches
 * the desk one; letting the submit through and bouncing 3s later — a faithful model of "posts,
 * then redirects", the exact failure this is aimed at — leaves the test green. The reason is that
 * the enquiry is refused twice, and the second refusal is the server's: an unauthenticated
 * `POST /tickets` answers `401 unauthorized` (probed directly, not inferred).
 *
 * That is defence in depth and a good thing, and it means this assertion cannot be killed by any
 * client-side change alone. It is kept regardless, because it is the only thing here that would
 * notice the endpoint becoming reachable without a session — the failure that would make the
 * client gate the *sole* guard, at which point a redirect that fires after the post is a silent
 * leak. The delta mechanism itself is exercised in its positive direction by
 * `live-loans-team.spec.js:93`, which uses the same helper shape and requires exactly one new row.
 *
 * ## Why the desk is checked by an id delta
 *
 * Same reason as `live-loans-team.spec.js:19`: `GET /tickets` returns a list projection with **no
 * `body`**, so a marker stamped into the enquiry text is invisible to every reader on this side
 * and an absence assertion built on it passes for the wrong reason. Snapshotting ids before and
 * diffing after is immune to that, and also survives a desk that another spec is writing to
 * concurrently, which an absolute count is not.
 */
import { expect, test, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAs } from '../../../helpers/liveAuth.js';

const PAGE = '/home-loans';

/**
 * Consent is seeded because the bar overlays the bottom of the viewport and intercepts clicks on
 * anything beneath it. This is a genuine browser-side preference, not server state being faked —
 * the distinction that matters when a live spec touches `localStorage` at all.
 */
async function withConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

/** Read the loans desk as the staffer who works it. */
async function loansQueue() {
  const res = await fetch(`${API}/tickets?team=loans&size=100`, { headers: await authHeaders(STAFF.loans) });
  expect(res.status, 'the loans desk is readable by its own staff').toBe(200);
  return (await res.json())?.content || [];
}

const idsOf = (rows) => new Set(rows.map((r) => r.id));

/**
 * The form's dropdowns are the project's own `Select` (via `NativeSelect`), not a native
 * `<select>`, so `selectOption` never resolves. `getByLabel` fails too: `ServiceLanding` renders a
 * bare `<label>` with no `htmlFor` and passes no `aria-label` (`ServiceLanding.jsx:188`,
 * `NativeSelect.jsx:44`), so the control has no accessible name at all. `data-err` is the anchor.
 */
async function pickOption(page, field, label) {
  await page.locator(`[data-err="${field}"] .pn-dropdown__trigger`).click();
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test.describe('home loans landing, live', () => {
  test('the hero, the EMI calculator and the rate comparison all render', async ({ page, consoleErrors }) => {
    await withConsent(page);
    await page.goto(PAGE);

    await expect(page.locator('h1')).toContainText('Home loans made');
    await expect(page.locator('h1')).toContainText('simple & affordable');
    await expect(page.getByRole('heading', { name: 'Check Your Eligibility' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plan your EMI before you apply' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compare Home Loan Rates' })).toBeVisible();

    /* Folded in rather than given its own test: a second navigation to assert the same page loaded
       cleanly is a second chance to be flaky, not a second claim. */
    expect(consoleErrors).toEqual([]);
  });

  test('the EMI figure recomputes when the loan amount moves', async ({ page }) => {
    await withConsent(page);
    await page.goto(PAGE);

    const emiCalc = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Plan your EMI before you apply' }) });
    const emi = emiCalc.locator('.gradient-text');
    await expect(emi).toContainText(/₹[\d,]+/);
    const before = await emi.innerText();

    // First slider is the loan amount (min 5L, max 3Cr, step 1L).
    const amount = emiCalc.locator('input[type=range]').first();
    await amount.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');

    /* `toHaveText` retries; `innerText()` does not, which is why the mock version of this needed a
       sleep to be reliable. The recomputed figure is the thing worth waiting for. */
    await expect(emi).not.toHaveText(before);
  });

  test('a signed-out request for offers is sent to sign-in, and files nothing on the loans desk', async ({ page }) => {    /* Signed into first: an absence on a desk nobody can read is not an absence. */
    const desk = await apiLogin(STAFF.loans);
    expect(desk.accessToken).toBeTruthy();
    const before = idsOf(await loansQueue());

    await withConsent(page);
    await page.goto(PAGE);

    /* Every ticket POST the page makes is recorded, so the absence below is about what the browser
       *sent*, not only about what a later read happened to find. A read alone can pass for the
       wrong reason: `ServiceLanding` shows its confirmation before the POST resolves, so a request
       still in flight looks exactly like a request never made — the race that made the sibling
       spec fail one run in three. */
    const ticketPosts = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/tickets') && r.method() === 'POST') ticketPosts.push(r.url());
    });

    /* Filled in completely on purpose. An empty form is turned away by validation as well as by
       the gate, so a spec that submits nothing cannot tell the two apart — and the negative below
       would hold for a reason that has nothing to do with being signed out. This form is
       submittable; only the visitor's session is missing.

       `name` is addressed directly and the other two through a descendant: `data-err` sits on the
       input itself for the two fixed fields (`ServiceLanding.jsx:178`) but on the wrapper for the
       quote-defined ones (`:189`). The inconsistency is easy to trip over — `[data-err="name"]
       input` matches nothing and reads as "the form is not rendered". */
    await pickOption(page, 'loanType', 'Home Purchase Loan');
    await page.locator('[data-err="amount"] input').fill('5000000');
    await page.locator('input[data-err="name"]').fill('Gate Probe');
    await page.locator('[data-err="mobile"] input').fill('9812345678');

    await page.getByRole('button', { name: 'Get Loan Offers' }).click();

    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);

    /* The redirect is not the claim. A gate that bounces the browser *after* posting the enquiry
       produces exactly this URL, so both the wire and the desk are checked. */
    expect(ticketPosts, 'a signed-out press sends no ticket request at all').toEqual([]);

    const arrived = (await loansQueue()).filter((t) => !before.has(t.id));
    expect(arrived, 'a signed-out press files no enquiry').toHaveLength(0);
  });

  /**
   * The signed-in counterpart of the gate, and a pin on prefill.
   *
   * The claim is small and entirely user-visible: a customer the app has already identified does
   * not retype their name and number to ask a question about a loan. It is anchored to the server's
   * answer rather than to a fixture constant, so it fails if the form and the session ever disagree.
   *
   * It is worth pinning because the mechanism is fragile by construction. `ServiceLanding` builds
   * its form state in a `useState` initialiser (`ServiceLanding.jsx:50-52`), which runs on the first
   * render and never again, while live `AuthContext` seeds `user` from cache and then *replaces* it
   * with the answer to `GET /auth/me` (`AuthContext.jsx:26`, `:36`). Today that is harmless — the
   * cached copy and the fresh one both carry `name`, so whichever render wins, the box is filled.
   * It stops being harmless the moment either copy gets thinner, and nothing else would notice:
   * every other live spec on this form types the name in by hand.
   *
   * Recorded honestly: this began as the proof for a backfill effect added on the theory that the
   * replacement could arrive after the initialiser had already read an empty user. Mutation-testing
   * the effect out did **not** turn this red, because with a warm session cache that state is not
   * reachable — the draft hook merges rather than clobbers (`hooks.js:204`) and `/auth/me` returns
   * the full user. The effect was speculative and was removed; the assertion earns its place on its
   * own, as the only thing watching prefill on this form.
   */
  test('the quote form already knows a signed-in customer, without being told', async ({ page }) => {
    await withConsent(page);
    await signedInAs(page, ACTORS.buyer);

    /* Read from the server rather than from a constant, and through the very endpoint the app uses:
       `AuthContext` revalidates the cached session against `GET /auth/me` and replaces `user` with
       whatever comes back (`authProvider.js:88`). Asserting the form against that answer is the
       claim — a literal here would pass a form that had merely been handed the same fixture string
       the seed uses. (There is no `GET /me` on this backend; the route is under `/auth`.) */
    const me = await fetch(`${API}/auth/me`, { headers: await authHeaders(ACTORS.buyer) });
    expect(me.status, 'the session the browser is holding is readable').toBe(200);
    const user = await me.json();
    expect(user?.name, 'this actor has a name for the form to copy').toBeTruthy();
    await page.goto(PAGE);

    /* Asserted against the server's answer, not a hardcoded string: the claim is that the form and
       the session agree, and a literal here would pass a form that had simply been given the same
       constant the fixture uses. */
    await expect(page.locator('input[data-err="name"]')).toHaveValue(user.name, { timeout: 15000 });
    await expect(page.locator('[data-err="mobile"] input')).toHaveValue(new RegExp(String(user.mobile).slice(-10)), { timeout: 15000 });
  });
});
