import { test, expect } from '@playwright/test';
import { API, E2E_OTP, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Owner-consent OTP ping against the real backend.
 *
 * ## What this proves
 *
 * 1. The consent endpoint (`POST /flatmates/groups/{id}/owner-consent`) works as a two-step flow:
 *    the first call (without OTP) triggers the code dispatch and stores the owner's mobile on the
 *    group; the second call (with the fixed E2E OTP) records the consent permanently.
 * 2. A group created by a tenant that receives consent carries `ownerConsent: true` on the public
 *    feed — and the browser's GroupCard renders the "Owner-consented" trust chip from it.
 * 3. The consent button in the group form is disabled until a full 10-digit mobile is entered
 *    (a purely frontend guard, but still live-provable since the form submits to a real server).
 *
 * ## The browser now reaches this endpoint
 *
 * It did not used to, and this spec recorded that as a live defect rather than fixing it.
 * `OwnerConsentModal` ran `useOtpFlow()` against the simulated dispatch and wrote
 * `setOwnerConsent()` straight to localStorage, so the http seam's consent call had never once
 * executed. `Flatmates.jsx` then flipped `consentVerified` on the *form*, and
 * `useFlatmateSupply.jsx` turned that into an `ownerConsent: true` key on the create payload —
 * which the server correctly dropped: `FlatmateMapper.applyTo` is
 * `@BeanMapping(ignoreByDefault = true)` and names `ownerConsent` as deliberately not
 * client-settable. A tenant who could assert their own landlord's consent would make the record
 * worthless. So the tenant did the whole OTP round-trip with their landlord, was told "Owner
 * consent recorded", and the group was created with `ownerConsent = false`: no chip, and an Ops
 * review entry stating consent was absent.
 *
 * The modal now calls `flatmateService.requestOwnerConsent` twice — send, then record — against
 * `POST /flatmates/owner-consent`. That route exists because the form asks for consent *before*
 * the group exists, and V27 already anticipated it: `flatmate_owner_consents` is unique on
 * `(owner_mobile, granted_by)` with a **nullable** `group_id`. Consent is a fact about two
 * people, not about one post, so it can be granted first and read back when `createGroup` runs.
 *
 * The last test below is the one that could not be written before. It drives the modal in the
 * browser and then proves the consent reached the database the only way a black-box test can — by
 * creating a group afterwards and finding `ownerConsent: true` on it. Nothing the browser sends
 * can make that flag true; only a row the server wrote does.
 *
 * ## What is deliberately NOT asserted
 *
 * - The "Pending Ops review" badge: that reads the review route, covered in `live-review-status`.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function approve(id) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status, `approve ${id}: ${await res.clone().text()}`).toBeLessThan(300);
}

test('owner-consent OTP flow records consent on the server, and the card shows the chip', async ({ page }) => {
  // --- Create a tenant and a group ---
  const tenantMobile = uniqueMobile();
  const { accessToken: tenantToken } = await apiLogin(tenantMobile);
  // The owner mobile must be a DIFFERENT number (the server refuses self-consent).
  const ownerMobile = uniqueMobile();

  const title = `Consent live ${Date.now().toString(36)}`;
  const createRes = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(tenantToken),
    body: JSON.stringify({
      title,
      name: 'Consent Tenant',
      locality: 'Baner',
      rent: 35000,
      seats: 3,
      seatsOpen: 1,
      policy: 'any',
      role: 'tenant',
      consentMobile: ownerMobile,
    }),
  });
  const createBody = await createRes.text();
  expect(createRes.status, createBody).toBe(201);
  const group = JSON.parse(createBody);
  track('groups', group.id, tenantToken);

  // The group starts without consent.
  expect(group.ownerConsent).toBe(false);

  // --- Step 1: request the OTP (no otp field) ---
  const sendRes = await fetch(`${API}/flatmates/groups/${group.id}/owner-consent`, {
    method: 'POST',
    headers: auth(tenantToken),
    body: JSON.stringify({ ownerMobile }),
  });
  const sendBody = await sendRes.text();
  expect(sendRes.status, `send OTP: ${sendBody}`).toBe(200);
  expect(JSON.parse(sendBody).consentRecorded).toBe(false);

  // --- Step 2: confirm with the fixed E2E OTP ---
  const confirmRes = await fetch(`${API}/flatmates/groups/${group.id}/owner-consent`, {
    method: 'POST',
    headers: auth(tenantToken),
    body: JSON.stringify({ ownerMobile, otp: E2E_OTP }),
  });
  const confirmBody = await confirmRes.text();
  expect(confirmRes.status, `confirm OTP: ${confirmBody}`).toBe(200);
  expect(JSON.parse(confirmBody).consentRecorded).toBe(true);

  // --- Read the group back from the caller-scoped list and verify ownerConsent is now true ---
  const myGroupsRes = await fetch(`${API}/me/flatmate-groups?size=50`, {
    headers: auth(tenantToken),
  });
  expect(myGroupsRes.status).toBe(200);
  const myGroups = await myGroupsRes.json();
  const items = myGroups.content ?? myGroups.items ?? myGroups;
  const updatedGroup = items.find((g) => g.id === group.id);
  expect(updatedGroup, 'the group should appear in my list').toBeTruthy();
  expect(updatedGroup.ownerConsent).toBe(true);

  // --- Approve the group so it appears on the public board ---
  await approve(group.id);

  // --- Browser: verify the "Owner-consented" chip renders on the card ---
  await signedInAs(page, tenantMobile);
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Team up/ }).first().click();

  const card = page.locator('.sf-card', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(/Owner-consented/i)).toBeVisible({ timeout: 5_000 });

  // Persist across reload.
  await page.reload();
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Team up/ }).first().click();
  const cardAfter = page.locator('.sf-card', { hasText: title }).first();
  await expect(cardAfter).toBeVisible({ timeout: 15_000 });
  await expect(cardAfter.getByText(/Owner-consented/i)).toBeVisible({ timeout: 5_000 });
});

test('consent button is disabled until a full 10-digit owner mobile is entered', async ({ page }) => {
  // Sign in as a fresh user and open the group form.
  const tenantMobile = uniqueMobile();
  await apiLogin(tenantMobile);
  await signedInAs(page, tenantMobile);

  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Post$/ }).first().click();

  // Navigate to the group form: "I'm still looking" → "We're already a group"
  const modal = page.locator('.sf-modal');
  await modal.getByRole('button', { name: /I'm still looking for a place/i }).click();
  await modal.getByRole('button', { name: /We're already a group/i }).click();

  // Select "registered rent agreement" tier to reveal the consent field (tenant path).
  await page.getByText(/registered rent agreement/i).click();

  // The consent button should be disabled with no mobile entered.
  const consentBtn = page.getByRole('button', { name: /Verify owner consent/i });
  await expect(consentBtn).toBeVisible({ timeout: 5_000 });
  await expect(consentBtn).toBeDisabled();

  // Enter a partial mobile — still disabled.
  const mobileField = page.getByPlaceholder(/owner.*mobile|seeking a replacement/i);
  await mobileField.fill('97000');
  await expect(consentBtn).toBeDisabled();

  // Enter a full 10-digit mobile — now enabled.
  await mobileField.fill('9700000001');
  await expect(consentBtn).toBeEnabled();
});

test('the modal records consent on the server, and a group created after it carries the flag', async ({ page }) => {
  const tenantMobile = uniqueMobile();
  const ownerMobile = uniqueMobile();
  const { accessToken: tenantToken } = await apiLogin(tenantMobile);
  await signedInAs(page, tenantMobile);

  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Post$/ }).first().click();

  const modal = page.locator('.sf-modal');
  await modal.getByRole('button', { name: /I'm still looking for a place/i }).click();
  await modal.getByRole('button', { name: /We're already a group/i }).click();
  await page.getByText(/registered rent agreement/i).click();

  await page.getByPlaceholder(/owner.*mobile|seeking a replacement/i).fill(ownerMobile);
  await page.getByRole('button', { name: /Verify owner consent/i }).click();

  // Step 1 — dispatch. This is the call that used to be `useOtpFlow`'s 700ms timer.
  await page.getByRole('button', { name: /Send OTP to owner/i }).click();
  for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);

  // Step 2 — record. Reaching the success path at all is now conditional on the server agreeing:
  // a wrong code answers 401 and the modal stays open with an error.
  await page.getByRole('button', { name: /Confirm consent/i }).click();
  await expect(page.getByRole('button', { name: /Confirm consent/i })).toBeHidden({ timeout: 15_000 });

  // The proof. `ownerConsent` is not client-settable — `FlatmateMapper.applyTo` drops it — so the
  // only way this comes back true is a `flatmate_owner_consents` row the browser caused the server
  // to write, keyed on (owner mobile, tenant) and found again at create time. Before the modal was
  // put on the seam this assertion returned false.
  const createRes = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(tenantToken),
    body: JSON.stringify({
      title: `Consent via UI ${Date.now().toString(36)}`,
      name: 'Consent Tenant',
      locality: 'Baner',
      rent: 35000,
      role: 'tenant',
      consentMobile: ownerMobile,
    }),
  });
  const createBody = await createRes.text();
  expect(createRes.status, createBody).toBe(201);
  const created = JSON.parse(createBody);
  track('groups', created.id, tenantToken);
  expect(created.ownerConsent).toBe(true);
});
