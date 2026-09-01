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
 * ## The browser cannot reach this endpoint today, and that is a live defect
 *
 * `OwnerConsentModal` runs `useOtpFlow()` against the mock dispatch and writes
 * `setOwnerConsent()` straight to localStorage — it never goes through `flatmateService`, so the
 * http seam's `recordOwnerConsent` has never once executed. `Flatmates.jsx:133` then only flips
 * `consentVerified` on the *form*, and `useFlatmateSupply.jsx:233` turns that into an
 * `ownerConsent: true` key on the create payload.
 *
 * The server drops it. `FlatmateMapper.applyTo(FlatmateGroupCreateRequest, ...)` is
 * `@BeanMapping(ignoreByDefault = true)` and its docblock names `ownerConsent` as deliberately
 * **not client-settable** — correct, and the whole point of the guardrail, since a tenant who
 * could assert their own landlord's consent would make the record worthless. The only writer is
 * `FlatmateSupplyService.ownerConsent`, behind a purpose-scoped OTP and a self-consent refusal.
 *
 * So on a live build the tenant completes the OTP, is told "Owner consent recorded", and the group
 * is created with `ownerConsent = false`: no chip, no `flatmate_owner_consents` row, no audit
 * entry. It fails closed, so it is a broken feature rather than a hole — but the feature is broken.
 * Closing it means moving consent *after* group creation and putting the modal on the seam, which
 * is a product/architecture change; it is written up in `tasks/todo.md` rather than taken here.
 *
 * That is why this spec drives the endpoint over HTTP and only then asks the browser what it
 * renders. The chip assertion below is real — it proves `GroupCard` reads `ownerConsent` off the
 * server's feed — but the consent it renders was recorded by this test, not by the UI.
 *
 * ## What is deliberately NOT asserted
 *
 * - The OTP modal's own interactions: they are mock-only by construction, per the paragraph above.
 * - The "Pending Ops review" badge: that reads the localStorage review map, not the review route
 *   (see `agreement-evidence.spec.js`).
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
