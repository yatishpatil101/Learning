import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, authHeaders } from '../../../helpers/liveAuth.js';
import { appReady } from '../../../helpers/app.js';

/**
 * /services — the Move-in Pack waitlist, against the live API (D4).
 *
 * ## What this replaces, and why the assertions are shaped this way
 *
 * The coming-soon panel used to answer "notify me" by writing the lead to browser localStorage and
 * then congratulating the customer. Nothing errored, nothing was logged, and the person believed
 * they were on a list that did not exist — the failure was invisible from every seat in the
 * building. So a spec that only checked for the confirmation banner would have passed against the
 * broken version, which makes it worthless here. Every test below ends at the same question:
 * **can ops actually reach this person?** — answered by reading the ops board back through
 * `GET /tickets` with a packers staff token, which is the screen a human works from.
 *
 * ## What is deliberately not asserted
 *
 * The rate limit. It is per mobile per hour against a shared table, so exercising it here would
 * either need three throwaway numbers and a fourth to trip it — leaving four rows on a board the
 * next spec may count — or a number reused across runs, which the live database does not reset
 * between specs within a run. `ServiceWaitlistTest` covers the budget and the `Retry-After` header
 * at the unit level, where the transaction rolls back. What is worth pinning *here* is the part
 * that only exists end to end: the browser sends what the server expects, and the row that comes
 * out the far side names the right desk.
 *
 * ## Fixtures
 *
 * `STAFF.packers` — the desk that owns the lead; the board is team-scoped server-side, so this
 * token seeing the row is the assertion, not a convenience.
 */

/** Fixed by `ServiceWaitlists` on the server. Asserted literally so a drift in either fails here. */
const SUBJECT = 'Move-in Pack \u2014 waitlist';

/** Unique per run: the live database is not reset between specs, and one row must mean one signup. */
const MOBILE = `98${String(Date.now()).slice(-8)}`;

/* Coming-soon mode is now a server-side fact, set here through the same admin route the console
   uses rather than by reaching into browser storage — `GET /move-pack` closed that read gap, so the
   old localStorage write would be ignored and every test below would silently start asserting
   against the live booking panel instead of the waitlist.

   Set explicitly rather than trusted from the seed, for the reason it always was: a seed change
   must not be able to quietly repurpose this file. It is doubly worth doing now, because the live
   database is not reset between specs and the booking spec next door switches the pack on. */
async function setPackComingSoon() {
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT',
    // `authHeaders` already sets `content-type`; a second, differently-cased key sends it twice
    // and the server answers 415.
    headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ movePack: { enabled: false } }),
  });
  expect(res.status).toBe(200);
}

async function openHubComingSoon(page) {
  await page.goto('/services');
  await appReady(page);
}

/* The hub animates in with `useScrollReveal`, so anything below the fold reads as not visible and
   Playwright will never scroll to it. Force the end state, exactly as the mock hub spec does. */
async function packSection(page) {
  await expect(page.locator('a.svc-card')).toHaveCount(9);
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible')));
  const section = page.locator('section').filter({ hasText: 'PuneNest Move-in Pack' }).last();
  await expect(section).toBeVisible();
  return section;
}

/** The board, as the packers desk sees it. Team scoping is the server's, so this is the real view. */
async function packersBoard() {
  const res = await fetch(`${API}/tickets?size=100`, {
    headers: await authHeaders(STAFF.packers),
  });
  expect(res.status).toBe(200);
  return (await res.json()).content || [];
}

test.describe('Move-in Pack waitlist (live)', () => {
  test.beforeAll(setPackComingSoon);

  /**
   * The lead reaches the desk.
   *
   * The confirmation banner is checked *and* the row is read back, in that order, because the two
   * together are the claim: the banner is only honest if the row exists. The provenance of the
   * write is pinned by waiting on the request — armed before the click — so a page that happened to
   * show the banner for some other reason cannot pass.
   */
  test('a stranger joins without signing in and the lead lands on the packers board', async ({ page }) => {
    await openHubComingSoon(page);
    const pack = await packSection(page);

    await pack.getByPlaceholder('Enter mobile number').fill(MOBILE);
    const nameField = pack.getByPlaceholder(/Your name/i);
    if (await nameField.count()) await nameField.fill('Waitlist Tester');

    const posted = page.waitForResponse(
      (r) => r.url().includes('/service-waitlist') && r.request().method() === 'POST',
    );
    await pack.getByRole('button', { name: 'Notify me' }).click();
    expect((await posted).status()).toBe(201);

    await expect(pack.getByText("You're on the waitlist!")).toBeVisible();

    const rows = (await packersBoard()).filter((t) => t.mobile === MOBILE);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe(SUBJECT);
    expect(rows[0].team).toBe('packers');
    expect(rows[0].status).toBe('open');
  });

  /**
   * Pressing the button twice is one lead, not two.
   *
   * Asserted through the board rather than the banner: the page would look identical either way,
   * and a desk ringing the same person twice is the failure this prevents. Reuses the row the test
   * above created — the whole point is that a second request adds nothing.
   */
  test('asking again does not put the same person on the board twice', async ({ page }) => {
    await openHubComingSoon(page);
    const pack = await packSection(page);

    await pack.getByPlaceholder('Enter mobile number').fill(MOBILE);
    const posted = page.waitForResponse(
      (r) => r.url().includes('/service-waitlist') && r.request().method() === 'POST',
    );
    await pack.getByRole('button', { name: 'Notify me' }).click();
    // 201 again, not 409: the caller's intent is "make sure you have me", and after either outcome
    // the desk does — and a conflict would tell a stranger whether a number was already listed.
    expect((await posted).status()).toBe(201);

    expect((await packersBoard()).filter((t) => t.mobile === MOBILE)).toHaveLength(1);
  });

  /**
   * The waitlist is not a public read.
   *
   * The rows are unverified phone numbers belonging to people who never signed up, so there is no
   * GET on this path at all. A negative like this passes for free against a server that is simply
   * down, so it is paired with the board read above, which proves the same server is answering.
   */
  test('nobody can read the waitlist back without a staff token', async () => {
    const res = await fetch(`${API}/service-waitlist`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  /**
   * A number ops cannot ring is refused before anything is written.
   *
   * The client-side check fires first, so this never reaches the network — which is the assertion:
   * a validation message and no request at all.
   */
  test('a malformed mobile is refused without a request', async ({ page }) => {
    await openHubComingSoon(page);
    const pack = await packSection(page);

    let requested = false;
    page.on('request', (r) => { if (r.url().includes('/service-waitlist')) requested = true; });

    await pack.getByPlaceholder('Enter mobile number').fill('12345');
    await pack.getByRole('button', { name: 'Notify me' }).click();
    await expect(pack.getByText('Enter a valid 10-digit mobile number.')).toBeVisible();
    expect(requested).toBe(false);
  });
});
