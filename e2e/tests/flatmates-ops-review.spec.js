import { test, expect } from '@playwright/test';

/* Ops agreement-review queue. Tenant-tier flatmate posts are self-declared, so
   they land in an Ops queue. Approve → the consumer card shows Ops-verified;
   reject(+reason) → it shows Review failed. A pending post shows Pending Ops review. */

const BASE = 'http://localhost:5173';
const STAFF = '9900000009';

function group(id, title) {
  return { id, title, locality: 'Baner', policy: 'any', rent: 45000, seatsTotal: 3, seatsOpen: 1, members: [{ name: 'Queue Host', initials: 'QH', verified: true }], tags: [], note: '', time: 'Just now', createdAt: Date.now(), ownerMobile: '9811111111', ownerName: 'Queue Host', hostRole: 'tenant', verificationTier: 'tenant', agreementDeclared: true };
}
function review(id, groupId, title, extra = {}) {
  return { id, groupId, kind: 'group', host: 'Queue Host', hostMobile: '9811111111', address: title + ' · Baner', tier: 'tenant', flagForReview: false, ownerConsent: false, status: 'pending', reason: '', createdAt: Date.now(), updatedAt: Date.now(), ...extra };
}

async function seedOps(page, groups, reviews) {
  await page.addInitScript((args) => {
    const [m, g, r] = args;
    // User is constant; groups/reviews are seeded ONCE so an Ops decision made
    // mid-test isn't overwritten when a later navigation re-runs this init script.
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Ops Staff', mobile: m, role: 'staff', loginAt: Date.now() }));
    if (!localStorage.getItem('puneNestFlatmateGroups')) localStorage.setItem('puneNestFlatmateGroups', JSON.stringify(g));
    if (!localStorage.getItem('puneNestFlatmateReviews')) localStorage.setItem('puneNestFlatmateReviews', JSON.stringify(r));
  }, [STAFF, groups, reviews]);
}

test('Ops approves a tenant declaration → consumer card shows Ops-verified', async ({ page }) => {
  const title = 'Queue approve in Baner';
  await seedOps(page, [group('mgQ1', title)], [review('revQ1', 'mgQ1', title)]);
  await page.goto(`${BASE}/ops/flatmate-review`);
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
  await page.locator('.approve-review-btn').first().click();
  // Moves out of Pending; visible under Ops-verified tab.
  await page.getByRole('button', { name: /^Ops-verified/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  // Consumer sees the Ops-verified cue.
  await page.goto(`${BASE}/flatmates?view=groups`);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  await expect(card.getByText(/Ops-verified/i)).toBeVisible();
});

test('Ops rejects with a reason → consumer card shows Review failed', async ({ page }) => {
  const title = 'Queue reject in Baner';
  await seedOps(page, [group('mgQ2', title)], [review('revQ2', 'mgQ2', title)]);
  await page.goto(`${BASE}/ops/flatmate-review`);
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
  await page.locator('.reject-review-btn').first().click();
  await page.getByPlaceholder(/Reason for rejection/i).fill('Agreement not registered');
  await page.getByRole('button', { name: /Confirm/i }).click();
  await page.goto(`${BASE}/flatmates?view=groups`);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  await expect(card.getByText(/Review failed/i)).toBeVisible();
});

test('a pending tenant post shows Pending Ops review on the consumer card', async ({ page }) => {
  const title = 'Queue pending in Baner';
  await seedOps(page, [group('mgQ3', title)], [review('revQ3', 'mgQ3', title)]);
  await page.goto(`${BASE}/flatmates?view=groups`);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  await expect(card.getByText(/Pending Ops review/i)).toBeVisible();
});
