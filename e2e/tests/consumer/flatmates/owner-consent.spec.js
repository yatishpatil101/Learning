import { test, expect } from '@playwright/test';
import { API, E2E_OTP, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { postAsGroup } from '../../../helpers/app.js';

/* `ownerConsent` is not client-settable (`FlatmateMapper.applyTo` drops it), so consent can only be
 * proven by creating a group afterwards and finding the flag the server itself wrote. */

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

  // Navigate to the group form: "I'm looking for a place" → "We're already a group"
  await postAsGroup(page);

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
  await postAsGroup(page);
  await page.getByText(/registered rent agreement/i).click();

  await page.getByPlaceholder(/owner.*mobile|seeking a replacement/i).fill(ownerMobile);
  await page.getByRole('button', { name: /Verify owner consent/i }).click();

  // Step 1 — dispatch, a real server call rather than a client-side timer.
  await page.getByRole('button', { name: /Send OTP to owner/i }).click();
  for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);

  // Step 2 — record. The success path is conditional on the server agreeing: a wrong code answers
  // 401 and the modal stays open with an error.
  await page.getByRole('button', { name: /Confirm consent/i }).click();
  await expect(page.getByRole('button', { name: /Confirm consent/i })).toBeHidden({ timeout: 15_000 });

  // The proof: `ownerConsent` is not client-settable, so it can only come back true from a
  // `flatmate_owner_consents` row keyed on (owner mobile, tenant) and found again at create time.
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
