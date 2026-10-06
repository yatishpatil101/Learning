import { test, expect } from '@playwright/test';
import { API, E2E_OTP, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { postAsGroup, haveAFlat } from '../../../helpers/app.js';
import { uploadAgreementDocument } from '../../../helpers/flatmateAgreement.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const AGREEMENT_DOC = {
  mime: 'image/png',
  name: 'agreement.png',
  size: 70,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    + 'AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
};

async function agreementDoc(token, doc = {}) {
  const uploaded = await uploadAgreementDocument(token);
  return {
    ...AGREEMENT_DOC,
    id: uploaded.id,
    name: uploaded.fileName || AGREEMENT_DOC.name,
    size: uploaded.sizeBytes || AGREEMENT_DOC.size,
    mime: uploaded.mimeType || AGREEMENT_DOC.mime,
    ...doc,
  };
}

async function adminToken() {
  return (await apiLogin(ACTORS.admin)).accessToken;
}

async function createTenantGroup(token, body = {}) {
  const proof = await agreementDoc(token, body.agreementDoc);
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
      agreementDoc: proof,
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
async function recordConsent(group, token, ownerMobile) {
  const address = { title: group.title, locality: group.locality };
  for (const payload of [{ ownerMobile, ...address }, { ownerMobile, otp: E2E_OTP, ...address }]) {
    const response = await fetch(`${API}/flatmates/owner-consent`, {
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
  // The whole point of the field: a desk that cannot see it is deciding on a photograph.
  const review = await queuedReview(group.id);
  expect(review.ownerConsent).toBe(false);
  // The refusal. 422 rather than 403 because the moderator holds every permission this needs —
  // "you are not allowed" would send them hunting for a role that cannot exist.
  const refused = await decide(review.id, 'approved');
  expect(refused.status, refused.body).toBe(422);
  expect(refused.body, 'the message must name the OTP as the way out').toMatch(/consent OTP/i);

  const rejected = await decide(review.id, 'rejected', 'e2e — refusing without consent');
  expect(rejected.status, rejected.body).toBe(200);
  // Now the owner actually consents, and the same claim goes through.
  const consented = await createTenantGroup(accessToken, { consentMobile: ownerMobile });
  await recordConsent(consented, accessToken, ownerMobile);

  const secondReview = await queuedReview(consented.id);
  expect(secondReview.ownerConsent, 'the OTP must have written the flag the gate reads').toBe(true);

  const approved = await decide(secondReview.id, 'approved');
  expect(approved.status, approved.body).toBe(200);
  expect(JSON.parse(approved.body).status).toBe('approved');
});
test('a consent taken before the group exists vouches for that flat and no other', async () => {
  const hostMobile = uniqueMobile();
  const ownerMobile = uniqueMobile();
  const { accessToken } = await apiLogin(hostMobile);
  const title = `Consented flat ${stamp()} in Baner`;

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

  const elsewhere = await createTenantGroup(accessToken, {
    title: `Another flat ${stamp()} in Baner`,
    consentMobile: ownerMobile,
  });
  expect(elsewhere.ownerConsent, 'an unrelated flat must not inherit the consent').toBe(false);

  const refused = await decide((await queuedReview(elsewhere.id)).id, 'approved');
  expect(refused.status, refused.body).toBe(422);
});

test('the agreement step asks only for the document, names the obligations and offers a way out', async ({ page }) => {
  const hostMobile = uniqueMobile();
  const { accessToken } = await apiLogin(hostMobile);
  await signedInAs(page, hostMobile);

  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await postAsGroup(page);
  await haveAFlat(page);
  // The registration fields belong to the tenant path, so they appear with it.
  await page.getByText(/registered rent agreement/i).click();
  // L5 — §55, the police intimation and the owner's consent, stated before the sub-let happens.
  const disclosure = page.getByTestId('tenant-disclosure');
  await expect(disclosure).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#agreement-reg-no, #agreement-registered-on, #agreement-valid-till')).toHaveCount(0);
  await expect(disclosure).toContainText(/owner/i);
  await expect(disclosure).toContainText(/police/i);
  // L4 — a host without an agreement is told where to get one rather than left to guess.
  const serviceLink = page.getByTestId('agreement-service-link');
  await expect(serviceLink).toHaveAttribute('href', '/services/rent-agreement?from=flatmates');

  await page.getByPlaceholder('e.g. 2 girls → 1 more for a 2BHK in Baner').fill(`Consent group ${stamp()}`);
  await page.getByPlaceholder('e.g. 34,000').fill('35000');
  await page.getByPlaceholder('Your name').fill('Consent Tenant');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'agreement.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByText(/agreement\.(png|jpg)/)).toBeVisible();
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
  await queuedReview(group.id);
});
