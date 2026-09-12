import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/* D194 — the tenancy half of review eligibility, against real HTTP.
 *
 * WHY THIS FILE EXISTS. `tenancy-declaration.spec.js` asked for it in words: "It runs in mock mode,
 * so it proves the UI agrees with the mock provider — which is the same kind of self-agreement that
 * hid the original bug." That is not modesty, it is an accurate description of how the bug got in.
 * `ReviewsSection` decided "has a tenancy" by reading a localStorage bucket (`getTenanciesFor`) that
 * nothing on the live path ever writes. In mock mode that bucket was the source of truth for both
 * halves of the check at once, so the term agreed with itself and passed; against the real API it
 * was unconditionally false, and the review composer was closed to the one person most entitled to
 * open it. A spec that cannot tell those two worlds apart cannot catch that class of bug, so this
 * one runs against Postgres and the mock file is retired by it.
 *
 * WHY THE NEGATIVE ASSERTIONS ARE THE POINT. Making a former resident eligible is easy; making them
 * eligible without handing every visitor a self-service review button is the entire problem. So the
 * load-bearing steps here are the two refusals:
 *
 *   - a claim the owner has not answered must NOT open the composer, and
 *   - a confirmation the owner takes back must CLOSE it again.
 *
 * If either ever passes with the confirmation step removed, the feature has quietly become "assert
 * you lived somewhere, then review it" — strictly worse than the dead check it replaced, because
 * that one at least failed closed.
 *
 * WHY TWO CONTEXTS AND NOT A SESSION SWAP. The claim is a conversation between two people about one
 * flat, so a single actor cannot exercise it. The mock version swapped `draazyUser` in place and
 * reloaded, which works only because the mock reads identity from storage. Live, identity is a
 * bearer token held by the app in its own context, so the two sides genuinely need two browsers —
 * and that is closer to the truth anyway: this feature's whole risk is that one party can act for
 * the other, and a test that shares a session is poorly placed to notice.
 *
 * WHY THE FIXTURE IS BUILT OVER HTTP. The listing, the approval and both accounts are set up with
 * `fetch`, and the browser time is spent only on the screens under test. Driving the wizard here
 * would test the wizard — `live-seam-write` already does that, and doing it again per test would
 * add a minute to a run to prove something already proved.
 */

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

/* A named account. Registration leaves `name` unset — `POST /auth/login` on an unknown mobile
   creates the row and nothing else — so without this the owner's claims panel would render the
   `property.someone` fallback for everybody, and "the panel shows who is asking" would be asserted
   against a constant string that is true whether or not the name ever reached the DTO. */
async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { mobile, headers };
}

/* An approved listing owned by a brand-new account. Fresh rather than seeded because the test
   writes to it: the seeded catalogue is what the read-only specs assert against, and a declaration
   left on P5013 would be visible to them. */
async function listing() {
  const owner = await actor('Zztest Landlord');
  const res = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest tenancy-declaration ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 21000,
    city: 'Pune',
    // A real row in `GET /localities`, so the resolver files the listing instead of leaving
    // `locality_slug` null and dropping it into the curation queue.
    locality: 'Baner',
    bhk: 2,
    area: 900,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);

  const approved = await api('PATCH', `/properties/${res.body.id}/status`,
    await authHeaders(ACTORS.admin), { status: 'approved' });
  expect(approved.status).toBe(200);

  return { owner, id: res.body.id, ref: res.body.slug || res.body.id };
}

/* `?tab=amenities`: PropertyTabs mounts the reviews block only while that tab is current, so on the
   default Overview tab none of this exists and neither read fires. The reveal flush is the house
   pattern — the fade-in observer never fires for content Playwright scrolls past instantly, and
   `scrollIntoViewIfNeeded` deadlocks on an element that is at `opacity: 0` until scrolled to.
 *
 * The readiness anchor is the section *heading*, not the Rate button, and the difference is the
 * whole reason this helper is worth a comment. The Rate button is rendered only for a non-owner —
 * that is the behaviour under test — so waiting on it here made the owner's half of every test time
 * out on the wait rather than reach its assertion, and reported the fix as a regression. An anchor
 * has to be something both roles see, or it is quietly asserting the thing it is supposed to be
 * merely waiting for.
 */
async function open(page, ref) {
  await page.goto(`/property/${ref}?tab=amenities`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await expect(page.getByRole('heading', { name: /ratings/i })).toBeVisible({ timeout: 20000 });
}

/* Ask the UI whether it believes the caller may review — by clicking, which is the only form of the
   question that cannot lie. Reading the button's presence would answer a different one.
 *
 * The click is inside the `try` on purpose. "No composer" is a legitimate way for the UI to say no,
 * and hiding the button from an ineligible viewer would be a reasonable change; if that ever
 * happens this should keep answering `false` rather than failing the negative assertions on a click
 * timeout and reporting a broken test where the behaviour is correct.
 */
async function rateOpensComposer(page) {
  const dialog = page.getByRole('dialog', { name: 'Rate this property' });
  try {
    await page.getByRole('button', { name: 'Rate this property' }).click({ timeout: 5000 });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    return true;
  } catch {
    return false;
  }
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic tenancy-declaration fixture',
    });
  }
  created.clear();
});

test('a stay only counts once the owner confirms it — and stops counting when they withdraw', async ({ page, browser }) => {
  const { owner, ref } = await listing();
  const resident = await actor('Zztest Resident');
  /* `uniqueMobile()` is `97` + the low 8 digits of `Date.now()`, so two calls inside the same
     millisecond return the same number and this test would silently become one person talking to
     themselves — every assertion below would still pass. The awaits above make a collision very
     unlikely rather than impossible, so it is checked rather than assumed. */
  expect(resident.mobile, 'the two actors minted the same mobile').not.toBe(owner.mobile);

  const residentCtx = await browser.newContext();
  const residentPage = await residentCtx.newPage();
  try {
    await signedInAs(residentPage, resident.mobile);
    await open(residentPage, ref);

    // 1. No visit and no tenancy, so the door is offered. Before D194 this reader was told to "book
    //    a visit first" — for a flat they are saying they used to live in.
    const declare = residentPage.getByTestId('tenancy-declare');
    await expect(declare).toBeVisible();
    await Promise.all([
      residentPage.waitForResponse((r) => /\/api\/properties\/[^/]+\/tenancy-declarations$/.test(r.url())
        && r.request().method() === 'POST'),
      declare.getByRole('button', { name: 'I lived here' }).click(),
    ]);

    // 2. Claimed, unanswered, and therefore worth nothing. The anti-loophole assertion: if declaring
    //    alone opened the composer, the owner's confirmation would be decoration.
    await expect(residentPage.getByTestId('tenancy-declaration-pending')).toBeVisible();
    expect(await rateOpensComposer(residentPage), 'a pending claim opened the review composer').toBe(false);

    // 3. The owner sees the claim on their own listing, with a name and no phone number. The
    //    negative half is the one worth having: the row is written by a stranger, and leaking the
    //    number of everyone who claims a stay would make the feature a directory.
    await signedInAs(page, owner.mobile);
    await open(page, ref);
    const claims = page.getByTestId('tenancy-claims');
    await expect(claims).toBeVisible();
    await expect(claims).toContainText('Zztest Resident');
    await expect(claims).not.toContainText(resident.mobile);

    await claims.getByRole('button', { name: `Confirm` }).first().click();
    await expect(claims.getByText('Confirmed')).toBeVisible();

    // 4. Now — and only now. Nothing about the resident changed between step 2 and here except that
    //    the landlord agreed, which is exactly the property under test.
    await open(residentPage, ref);
    await expect(residentPage.getByTestId('tenancy-declare')).toHaveCount(0);
    expect(await rateOpensComposer(residentPage), 'a confirmed claim did not open the review composer').toBe(true);

    // 5. Withdrawal actually withdraws. A confirmation an owner cannot take back is not a decision,
    //    it is a trap — and this is the half a "does the button appear" test never reaches.
    await open(page, ref);
    await page.getByTestId('tenancy-claims').getByRole('button', { name: 'Withdraw' }).first().click();
    await expect(page.getByTestId('tenancy-claims').getByText('Not confirmed')).toBeVisible();

    await open(residentPage, ref);
    await expect(residentPage.getByTestId('tenancy-declaration-revoked')).toBeVisible();
    expect(await rateOpensComposer(residentPage), 'a withdrawn claim still opened the review composer').toBe(false);
  } finally {
    await residentCtx.close();
  }
});

test('an owner is never offered a claim on their own listing', async ({ page }) => {
  // The owner is already barred from reviewing their own flat, so without this they would be shown
  // a button whose only possible outcome is a refusal from a rule they cannot do anything about.
  const { owner, ref } = await listing();
  await signedInAs(page, owner.mobile);
  await open(page, ref);
  await expect(page.getByTestId('tenancy-declare')).toHaveCount(0);
});
