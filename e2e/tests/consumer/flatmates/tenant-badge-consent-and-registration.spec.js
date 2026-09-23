import { test, expect } from '@playwright/test';
import { API, E2E_OTP, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { postAsGroup } from '../../../helpers/app.js';

/**
 * What the Tenant-verified badge is allowed to certify.
 *
 * Without these gates a tenant could post a sub-let, upload a photograph of anything at all, and
 * have Ops turn it into "Tenant-verified" — with the flat's owner never asked and nothing on the
 * row that could tell a real agreement from a sheet of stamp paper. Two separate holes, and the
 * badge is what makes them matter: Draazy is not merely hosting the claim, it is vouching for it.
 *
 * The domain is not optional here. Maharashtra Rent Control Act 1999 §55 makes Leave & License
 * registration compulsory, and a tenant who parts with possession without the owner's written
 * consent hands that owner a ground for eviction. So an unconsented sub-let can cost the host their
 * home and the seeker their deposit, and the platform's word is the thing being withheld — the post
 * itself stays up either way, at identity tier.
 *
 * ## What each test pins
 *
 * - **Consent is a precondition of the badge, not of posting.** The refusal is a 422 the moderator
 *   cannot click their way out of, because nothing about the caller fixes it: only the owner
 *   typing an OTP does. The same review approves once that has happened, which is what proves the
 *   422 is a gate rather than a wall.
 * - **Consent names a flat.** It is keyed on the address the owner was read out, so an OTP taken
 *   for one sub-let cannot badge an unrelated one — otherwise a host's first consent would vouch
 *   for every post they ever make, including flats that owner has never heard of.
 * - **The registration number reaches the desk.** It is the only field separating a registered
 *   agreement from a photo, so it is worthless if it stops at the database.
 * - **The disclosure and the way out are on screen.** A host being told to produce an agreement
 *   they have never heard of needs both the obligation and the route named on the same step.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const REG_NO = 'PNE-3/1234/2025';
const REGISTERED_ON = '2025-10-01';
const VALID_TILL = '2027-09-01';

/**
 * The scan itself. A tenant claim is four things and the document is one of them: the server reads
 * the flag, the document, the number and the dates together, and anything short of all four is a
 * claim it files at identity tier instead — at 201, because an undocumented post is a perfectly
 * legal post, just not a certified one. A fixture that omitted this got a created group, a green
 * status code and no queue row, which reads as "the desk never received it".
 */
const AGREEMENT_DOC = {
  mime: 'image/png',
  name: 'agreement.png',
  size: 70,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    + 'AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
};

async function adminToken() {
  return (await apiLogin(ACTORS.admin)).accessToken;
}

async function createTenantGroup(token, body = {}) {
  const response = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title: `Consent badge ${stamp()} in Baner`,
      name: 'Consent Tenant',
      locality: 'Baner',
      rent: 35000,
      seats: 3,
      seatsOpen: 1,
      policy: 'any',
      role: 'tenant',
      agreement: true,
      agreementDoc: AGREEMENT_DOC,
      agreementRegNo: REG_NO,
      agreementRegisteredOn: REGISTERED_ON,
      agreementValidTill: VALID_TILL,
      ...body,
    }),
  });
  const group = await response.json();
  expect(response.status, JSON.stringify(group)).toBe(201);
  track('groups', group.id, token);
  return group;
}

/** The queue row behind a post, read as the desk reads it rather than round the route. */
async function queuedReview(target) {
  const queue = await (await fetch(`${API}/admin/flatmate-reviews?size=100`, {
    headers: auth(await adminToken()),
  })).json();
  const row = queue.content.find((r) => r.groupId === target || r.roomId === target);
  expect(row, `an agreement-backed post must be queued for Ops (${target})`).toBeTruthy();
  return row;
}

/** Decide a queued review and hand back the raw response, so a refusal can be asserted on. */
async function decide(reviewId, decision, note = 'e2e verdict') {
  const response = await fetch(`${API}/admin/flatmate-reviews/${reviewId}`, {
    method: 'PATCH',
    headers: auth(await adminToken()),
    body: JSON.stringify({ decision, note }),
  });
  return { status: response.status, body: await response.text() };
}

/** Walk the owner through both legs of the consent OTP, which is the only way the flag is set. */
async function recordConsent(groupId, token, ownerMobile) {
  for (const payload of [{ ownerMobile }, { ownerMobile, otp: E2E_OTP }]) {
    const response = await fetch(`${API}/flatmates/groups/${groupId}/owner-consent`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify(payload),
    });
    expect(response.status, `owner-consent ${JSON.stringify(payload)}`).toBe(200);
  }
}

test('Ops cannot badge a sub-let the owner never consented to, and can once they have', async () => {
  const hostMobile = uniqueMobile();
  const ownerMobile = uniqueMobile(); // a different number — the server refuses self-consent
  const { accessToken } = await apiLogin(hostMobile);

  const group = await createTenantGroup(accessToken, { consentMobile: ownerMobile });
  expect(group.ownerConsent, 'a fresh group starts unconsented').toBe(false);

  const review = await queuedReview(group.id);
  expect(review.ownerConsent).toBe(false);

  // The refusal. 422 rather than 403 because the moderator holds every permission this needs —
  // "you are not allowed" would send them hunting for a role that cannot exist.
  const refused = await decide(review.id, 'approved');
  expect(refused.status, refused.body).toBe(422);
  expect(refused.body, 'the message must name the OTP as the way out').toMatch(/consent OTP/i);

  // Rejection stays open: refusing a claim needs no corroboration.
  const rejected = await decide(review.id, 'rejected', 'e2e — refusing without consent');
  expect(rejected.status, rejected.body).toBe(200);

  // Now the owner actually consents, and the same claim goes through.
  const consented = await createTenantGroup(accessToken, { consentMobile: ownerMobile });
  await recordConsent(consented.id, accessToken, ownerMobile);

  const secondReview = await queuedReview(consented.id);
  expect(secondReview.ownerConsent, 'the OTP must have written the flag the gate reads').toBe(true);

  const approved = await decide(secondReview.id, 'approved');
  expect(approved.status, approved.body).toBe(200);
  expect(JSON.parse(approved.body).status).toBe('approved');
});

test('the L&L registration number and its dates reach the Ops queue row', async () => {
  const hostMobile = uniqueMobile();
  const { accessToken } = await apiLogin(hostMobile);

  const group = await createTenantGroup(accessToken, {
    agreementRegNo: REG_NO,
    agreementRegisteredOn: REGISTERED_ON,
    agreementValidTill: VALID_TILL,
  });

  // The whole point of the field: a desk that cannot see it is deciding on a photograph.
  const review = await queuedReview(group.id);
  expect(review.agreementRegNo).toBe(REG_NO);
  expect(review.agreementRegisteredOn).toBe(REGISTERED_ON);
  expect(review.agreementValidTill).toBe(VALID_TILL);
});

test('a consent taken before the group exists vouches for that flat and no other', async () => {
  const hostMobile = uniqueMobile();
  const ownerMobile = uniqueMobile();
  const { accessToken } = await apiLogin(hostMobile);
  const title = `Consented flat ${stamp()} in Baner`;

  // The route the group form actually calls: the consent is taken while the form is still open,
  // so it names its flat by the title the host has typed rather than by a group id. The address
  // rides on the send as well as the verify — an address the server cannot fingerprint is refused
  // either way, and refusing it only at the verify step means the owner has already been texted
  // for a consent that was never going to be storable.
  const address = { title, locality: 'Baner' };
  for (const payload of [{ ownerMobile, ...address }, { ownerMobile, otp: E2E_OTP, ...address }]) {
    const response = await fetch(`${API}/flatmates/owner-consent`, {
      method: 'POST',
      headers: auth(accessToken),
      body: JSON.stringify(payload),
    });
    expect(response.status, `owner-consent ${JSON.stringify(payload)}`).toBe(200);
  }

  // A send that names no flat is refused before it costs the owner an SMS.
  const unscoped = await fetch(`${API}/flatmates/owner-consent`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({ ownerMobile }),
  });
  expect(unscoped.status, await unscoped.clone().text()).toBe(400);

  // The flat the owner was asked about picks the consent up at submit time.
  const consented = await createTenantGroup(accessToken, { title, consentMobile: ownerMobile });
  expect(consented.ownerConsent, 'the flat named in the OTP must carry the flag').toBe(true);

  // A second flat, same host, same owner's number, same OTP — and no consent, because nobody
  // asked that owner about this address. Without the scope one OTP would badge every sub-let the
  // host ever posts, which is the whole thing §55 makes expensive to get wrong.
  const elsewhere = await createTenantGroup(accessToken, {
    title: `Another flat ${stamp()} in Baner`,
    consentMobile: ownerMobile,
  });
  expect(elsewhere.ownerConsent, 'an unrelated flat must not inherit the consent').toBe(false);

  const refused = await decide((await queuedReview(elsewhere.id)).id, 'approved');
  expect(refused.status, refused.body).toBe(422);
});

test('the agreement step captures the registration, names the obligations and offers a way out', async ({ page }) => {
  const hostMobile = uniqueMobile();
  // Its own number, because the Ops row is found by it: the board masks the host mobile
  // (97XXXXX436), so the host is not a usable key, and the shared REG_NO matches every row the
  // other tests queued.
  const regNo = `PNE-3/${stamp()}/2025`;
  const { accessToken } = await apiLogin(hostMobile);
  await signedInAs(page, hostMobile);

  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await postAsGroup(page);

  // The registration fields belong to the tenant path, so they appear with it.
  await page.getByText(/registered rent agreement/i).click();
  const panel = page.getByTestId('agreement-registration');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // L5 — §55, the police intimation and the owner's consent, stated before the sub-let happens.
  const disclosure = page.getByTestId('tenant-disclosure');
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText(/owner/i);
  await expect(disclosure).toContainText(/police/i);

  // L4 — a host without an agreement is told where to get one rather than left to guess.
  const serviceLink = page.getByTestId('agreement-service-link');
  await expect(serviceLink).toHaveAttribute('href', '/services/rent-agreement?from=flatmates');

  await page.locator('#agreement-reg-no').fill(regNo);
  await page.locator('#agreement-registered-on').fill(REGISTERED_ON);
  await page.locator('#agreement-valid-till').fill(VALID_TILL);
  await page.getByPlaceholder('e.g. 2 girls → 1 more for a 2BHK in Baner').fill(`Consent group ${stamp()}`);
  await page.getByPlaceholder('₹ e.g. 34000').fill('35000');
  await page.getByPlaceholder('Your name').fill('Consent Tenant');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'agreement.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });

  // The proof that the inputs are wired to the payload rather than only to the screen: the same
  // three values come back off the server's own queue row.
  const createdResponse = page.waitForResponse(
    (r) => r.url().includes('/flatmates/groups') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Create group' }).click();

  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const group = await created.json();
  track('groups', group.id, accessToken);
  const review = await queuedReview(group.id);
  expect(review.agreementRegNo).toBe(regNo);
  expect(review.agreementRegisteredOn).toBe(REGISTERED_ON);
  expect(review.agreementValidTill).toBe(VALID_TILL);

  await signedInAs(page, ACTORS.admin);
  await page.goto(`${BASE}/ops/flatmate-review`);
  const registration = page.getByTestId('agreement-registration').filter({ hasText: regNo });
  await expect(registration).toContainText(regNo);
  await expect(registration).toContainText(`registered ${REGISTERED_ON}`);
  await expect(registration).toContainText(`valid till ${VALID_TILL}`);
});
