import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs, grantAadhaarBadge } from '../../../helpers/liveAuth.js';

/* ADR-019 badge-not-gate — the Aadhaar badge is offered, never demanded, against real HTTP.
 *
 * ## What the policy actually says
 *
 * Reaching an owner needs a signed-in account and nothing more. There is exactly one circumstance
 * in which a badge is asked for: the owner has opted into "accept verified contacts only". Even
 * then the caller is offered the badge rather than refused — the refusal is a detour, not a wall.
 *
 * That is a policy with two halves, and only one of them is a positive claim. "The badge is
 * required here" is easy to test and easy to notice when it breaks. "The badge is required nowhere
 * else" is the half that decays silently: a gate added to any other path looks like a security
 * improvement in review, reads as a bug only to the user who hits it, and no existing test
 * necessarily covers the path it was added to. So the first two tests here are the load-bearing
 * ones, and they are deliberately dull.
 *
 * ## Why this has to run live
 *
 * The mock version decided the gate in the browser — `lib/contact.js:143` reads the owner's
 * preference out of `dzOwnerPrefs:<mobile>` in localStorage and the caller's badge out of
 * `draazyAadhaar:<mobile>`, both of which the test itself had written moments earlier. Every
 * outcome was therefore a statement about seed data the same process controlled. Live the decision
 * belongs to `ContactService`, the preference is a column on the owner's account, and the refusal
 * is a real `403 verification_required` — so these tests can be wrong, which is what makes them
 * worth running.
 *
 * The mock's fourth test is not carried over in its original form. It completed a fake DigiLocker
 * round-trip in the browser and then asserted `draazyAadhaar:<buyer>` had been written — a test
 * of the mock's own storage write. Live the badge is granted server-side and what matters is that
 * holding one changes the answer, which is what the third test asserts.
 */

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/* A brand-new account with a name. Registration leaves `name` unset, and an owner card that falls
   back to a placeholder would let a "the owner is named" assertion pass against a constant. */
async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, `naming ${name}`).toBe(200);
  return { mobile, headers };
}

/* An approved listing owned by a throwaway account.
 *
 * Minted per test rather than borrowed from the seed, because a contact request is a row keyed on
 * (requester, property) and the server is deliberately idempotent about it: a second run against a
 * shared listing would re-read the first run's row instead of creating one, and the assertions
 * below would then be describing history rather than behaviour. `verifiedOnly` is set on the owner
 * before the listing is approved so there is no window in which the listing is reachable under the
 * wrong policy. */
async function listing({ verifiedOnly = false } = {}) {
  const owner = await actor('Zztest Contact Owner');
  if (verifiedOnly) {
    const pref = await api('PATCH', '/auth/me', owner.headers, { verifiedContactOnly: true });
    expect(pref.status).toBe(200);
    expect(pref.body.verifiedContactOnly, 'the preference did not stick').toBe(true);
  }

  const res = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest badge-not-gate ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 24000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 950,
  });
  expect(res.status, 'creating the fixture listing').toBe(201);
  const id = res.body.id;
  created.add(id);

  const admin = await authHeaders(ACTORS.admin);
  const appr = await api('PATCH', `/properties/${id}/status`, admin, { status: 'approved' });
  expect(appr.status, 'approving the fixture listing').toBe(200);

  return { owner, id, ref: res.body.slug || id };
}

test.afterEach(async () => {
  const admin = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, admin, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic badge-not-gate fixture',
    });
  }
  created.clear();
});

/* The request button lives in the contact box on the detail page. Waiting for it by role rather
   than by a container class, because the box is rendered in two places at two viewports and this
   spec has no opinion about which one answered. */
const requestBtn = (page) => page.getByRole('button', { name: /Request number/i }).first();

async function openListing(page, ref) {
  await page.goto(`/property/${ref}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await requestBtn(page).waitFor({ timeout: 20000 });
}

const badgeModal = (page) => page.getByRole('dialog', { name: 'Get your Verified badge' });

test('an unverified buyer reaches an ordinary owner with no badge asked for', async ({ page, request }) => {
  const fixture = await listing();
  const buyer = await actor('Zztest Buyer');

  await signedInAs(page, buyer.mobile);
  await openListing(page, fixture.ref);

  // The response is what is asserted, not the toast: a request that 200s and a request that quietly
  // failed can look identical for a second, and the second is when a screenshot gets taken.
  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/contacts\/request$/.test(r.url()) && r.request().method() === 'POST'),
    requestBtn(page).click(),
  ]);
  expect(res.status(), 'a plain signed-in buyer was refused').toBe(200);
  expect((await res.json()).status).toBe('pending');

  // And no badge was offered, because none was wanted. This is the assertion that catches a gate
  // added somewhere it does not belong.
  await expect(badgeModal(page)).toHaveCount(0);

  /* The same probe the third test uses to show a refused request left nothing behind, asserted here
     in the affirmative. On its own, `not.toBe('pending')` over there proves very little: a probe
     that always answered `none` — wrong URL, wrong account, an endpoint that quietly 200s with an
     empty body — would satisfy it forever. Running it against a request that genuinely exists is
     what makes the negative reading mean something. */
  const status = await request.get(`${API}/contacts/status?propertyId=${fixture.id}`, { headers: buyer.headers });
  expect(status.ok()).toBeTruthy();
  expect((await status.json()).status, 'the probe cannot see a request that was made').toBe('pending');
});

test('holding a badge changes nothing for an ordinary owner', async ({ page }) => {
  const fixture = await listing();
  const buyer = await actor('Zztest Verified Buyer');
  await grantAadhaarBadge(buyer.mobile);

  await signedInAs(page, buyer.mobile);
  await openListing(page, fixture.ref);

  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/contacts\/request$/.test(r.url()) && r.request().method() === 'POST'),
    requestBtn(page).click(),
  ]);
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe('pending');
  await expect(badgeModal(page)).toHaveCount(0);

  /* This test looks like the previous one and that is the point rather than an oversight. The
     policy's claim is that the badge is *inert* on the ordinary path — it neither unlocks nor
     upgrades anything. A single test of the unverified case would still pass if a badge silently
     started changing the outcome, and "verified users get something extra" is exactly the kind of
     change that gets made without anyone calling it a gate. */
});

test('a verified-contacts-only owner offers the badge instead of the number — and opens no request', async ({ page, request }) => {
  const fixture = await listing({ verifiedOnly: true });
  const buyer = await actor('Zztest Unverified Buyer');

  await signedInAs(page, buyer.mobile);
  await openListing(page, fixture.ref);

  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/contacts\/request$/.test(r.url()) && r.request().method() === 'POST'),
    requestBtn(page).click(),
  ]);
  expect(res.status()).toBe(403);
  // `error`, not `code`: the server's envelope is `ApiError(error, message, status, traceId)`. The
  // client normalises it to `err.code` before `ContactBox` branches on it, and asserting the raw
  // wire name here is deliberate — a rename on either side should surface as a failure rather than
  // be absorbed by the mapping.
  expect((await res.json()).error).toBe('verification_required');

  // Offered, not walled: the refusal comes with the way through it.
  await expect(badgeModal(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with DigiLocker' })).toBeVisible();

  /* No row was written, checked over `request` rather than through the page.
   *
   * This is the half of the refusal that has no visible symptom. A 403 that still opened a pending
   * request would put a lead the owner explicitly did not want into their inbox, and the buyer's
   * screen would look exactly the same either way — so nothing short of asking the server can tell
   * the two apart. Probed out-of-band because the page's own console-error guard would otherwise
   * count the deliberate 403 against the test.
   *
   * Worth knowing what actually holds this up. Moving the badge check *below* the insert — the
   * obvious way to break it — does not break it, because `ContactService.request` is
   * `@Transactional` and `VerificationRequiredException` is unchecked, so the rollback takes the
   * row back out again. The ordering in the service reads like the guarantee and is really just
   * good manners; the transaction boundary is the guarantee. That makes this assertion a guard on
   * the boundary rather than on the ordering, which is the more valuable thing to be watching:
   * dropping `@Transactional`, catching the exception to translate it, or splitting the insert into
   * its own propagation scope would each leave the row behind, and each is a change someone could
   * make while believing the check above still protected them. */
  const status = await request.get(`${API}/contacts/status?propertyId=${fixture.id}`, { headers: buyer.headers });
  expect(status.ok()).toBeTruthy();
  expect((await status.json()).status, 'the refused request was stored anyway').not.toBe('pending');
});

test('the same buyer gets through once the badge is earned', async ({ page }) => {
  const fixture = await listing({ verifiedOnly: true });
  const buyer = await actor('Zztest Upgrading Buyer');

  // Granted server-side rather than by completing the DigiLocker screen. What is being tested is
  // that the badge changes the answer, and driving the issuing flow here would make a failure
  // ambiguous between "the gate ignores badges" and "the issuing screen broke".
  await grantAadhaarBadge(buyer.mobile);

  await signedInAs(page, buyer.mobile);
  await openListing(page, fixture.ref);

  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/contacts\/request$/.test(r.url()) && r.request().method() === 'POST'),
    requestBtn(page).click(),
  ]);
  expect(res.status(), 'a badged buyer was still refused by a verified-only owner').toBe(200);
  expect((await res.json()).status).toBe('pending');
  await expect(badgeModal(page)).toHaveCount(0);
});
