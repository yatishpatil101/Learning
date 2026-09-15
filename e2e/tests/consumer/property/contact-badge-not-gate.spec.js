import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs, grantIdentityBadge } from '../../../helpers/liveAuth.js';

/* ADR-019 badge-not-gate: the identity badge is offered, never demanded. "Required nowhere else"
 * is the half that decays silently, so the first two tests here are deliberately dull. */

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

/* Minted per test rather than borrowed from the seed: contact requests are idempotent per
 * (requester, property), so a shared listing would make the assertions describe history. */
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

/* The offer of the badge is a *route*, not a dialog — `VerifyIdentityRedirect` renders nothing — so a
   dialog-name assertion would pass vacuously in the negative cases below. Staying on the listing is
   the negative, and `toHaveURL` retries, so a late redirect still fails it. */
const stayedOnListing = (page, ref) => expect(page).toHaveURL(new RegExp(`/property/${ref}`));
const offeredTheBadge = (page) => expect(page).toHaveURL(/\/verify-identity/);

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
  await stayedOnListing(page, fixture.ref);

  /* The same probe the third test uses in the negative, asserted here in the affirmative: a probe
     that always answered `none` would satisfy `not.toBe('pending')` over there forever. */
  const status = await request.get(`${API}/contacts/status?propertyId=${fixture.id}`, { headers: buyer.headers });
  expect(status.ok()).toBeTruthy();
  expect((await status.json()).status, 'the probe cannot see a request that was made').toBe('pending');
});

test('holding a badge changes nothing for an ordinary owner', async ({ page }) => {
  const fixture = await listing();
  const buyer = await actor('Zztest Verified Buyer');
  await grantIdentityBadge(buyer.mobile);

  await signedInAs(page, buyer.mobile);
  await openListing(page, fixture.ref);

  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/contacts\/request$/.test(r.url()) && r.request().method() === 'POST'),
    requestBtn(page).click(),
  ]);
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe('pending');
  await stayedOnListing(page, fixture.ref);

  /* Near-identical to the previous test on purpose: the badge must be *inert*, and a single test of
     the unverified case still passes if a badge silently starts improving the outcome. */
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
  // `error`, not `code`: asserting the raw wire name means a rename on either side of the client's
  // normalisation surfaces as a failure rather than being absorbed by the mapping.
  expect((await res.json()).error).toBe('verification_required');

  /* Offered, not walled: the refusal comes with the way through it. Only the route is asserted —
     the screen behind it branches on whether the device has a camera, so a heading assertion here
     would be a claim about the runner's viewport rather than about the refusal. */
  await offeredTheBadge(page);

  /* A 403 that still opened a pending request is invisible on the buyer's screen, so only the
     server can tell the two apart; probed out-of-band so the console guard ignores the 403. */
  const status = await request.get(`${API}/contacts/status?propertyId=${fixture.id}`, { headers: buyer.headers });
  expect(status.ok()).toBeTruthy();
  expect((await status.json()).status, 'the refused request was stored anyway').not.toBe('pending');
});

test('the same buyer gets through once the badge is earned', async ({ page }) => {
  const fixture = await listing({ verifiedOnly: true });
  const buyer = await actor('Zztest Upgrading Buyer');

  // Granted server-side: driving the issuing flow would make a failure ambiguous between "the gate
  // ignores badges" and "the issuing screen broke".
  await grantIdentityBadge(buyer.mobile);

  await signedInAs(page, buyer.mobile);
  await openListing(page, fixture.ref);

  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/contacts\/request$/.test(r.url()) && r.request().method() === 'POST'),
    requestBtn(page).click(),
  ]);
  expect(res.status(), 'a badged buyer was still refused by a verified-only owner').toBe(200);
  expect((await res.json()).status).toBe('pending');
  await stayedOnListing(page, fixture.ref);
});
