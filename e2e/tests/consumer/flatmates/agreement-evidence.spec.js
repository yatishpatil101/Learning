import { test, expect } from '@playwright/test';
import { postAsGroup, switchToTeamUp } from '../../../helpers/app.js';

/* Agreement evidence + Ops-gated badge (honest trust model). A tenant's
   "Tenant-verified" badge is EARNED, not self-claimed: it is withheld until the
   tenant uploads a registered rent agreement AND Ops approves that document.
   - Upload + post → card shows "Pending Ops review", no badge.
   - Ops sees the uploaded agreement, approves → card shows Tenant-verified.
   - Declared without upload → identity tier, no review, no badge.
   - A tenant review with no document is flagged "No document" in the Ops queue. */

const BASE = 'http://localhost:5173';
const TENANT = '9812345678';
const STAFF = '9900000009';

const PDF = { name: 'agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 evidence test agreement') };

async function seedTenant(page) {
  await page.addInitScript((m) => {
    // Set once so a later becomeStaff() isn't overwritten when this init script
    // re-runs on subsequent navigations.
    if (!localStorage.getItem('puneNestUser')) localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Evidence Tenant', mobile: m, role: 'tenant', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, TENANT);
}

async function createTenantGroup(page, title, { upload = true } = {}) {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postAsGroup(page);
  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('42000');
  await page.getByPlaceholder(/Your name/i).fill('Evidence Tenant');
  await page.getByText(/registered rent agreement/i).click();
  if (upload) await page.getByLabel('Upload registered rent agreement for group').setInputFiles(PDF);
  await page.getByRole('button', { name: /Create group/i }).click();
  await switchToTeamUp(page);
  await expect(page.locator('.sf-card', { hasText: title }).first()).toBeVisible({ timeout: 5000 });
}

async function becomeStaff(page) {
  await page.evaluate((m) => localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Ops Staff', mobile: m, role: 'staff', loginAt: Date.now() })), STAFF);
}

test('tenant uploads → Pending; Ops reviews the agreement and approves → badge appears', async ({ page }) => {
  const title = 'Evidence approve flow in Baner';
  await seedTenant(page);
  await createTenantGroup(page, title, { upload: true });

  // Badge withheld until Ops approves.
  const pendingCard = page.locator('.sf-card', { hasText: title }).first();
  await expect(pendingCard.getByText(/Pending Ops review/i)).toBeVisible();
  await expect(pendingCard.getByText(/Tenant-verified/i)).toHaveCount(0);

  // Ops opens the queue, can view the uploaded agreement, and approves.
  await becomeStaff(page);
  await page.goto(`${BASE}/ops/flatmate-review`);
  const row = page.locator('tr', { hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row.locator('.view-agreement-btn')).toBeVisible();
  await row.locator('.approve-review-btn').click();

  // Consumer card now earns the badge.
  await page.goto(`${BASE}/flatmates?view=groups`);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  await expect(card.getByText(/Tenant-verified/i)).toBeVisible();
});

test('tenant declares but uploads nothing → identity tier, no review, no badge', async ({ page }) => {
  const title = 'Evidence declare-only in Baner';
  await seedTenant(page);
  await createTenantGroup(page, title, { upload: false });
  const card = page.locator('.sf-card', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // No upload → identity tier: neither a badge nor a review chip.
  await expect(card.getByText(/Tenant-verified/i)).toHaveCount(0);
  await expect(card.getByText(/Pending Ops review/i)).toHaveCount(0);
});

test('Ops queue flags a tenant review that has no uploaded document', async ({ page }) => {
  const title = 'Evidence missing doc in Baner';
  await page.addInitScript((args) => {
    const [m, t] = args;
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Ops Staff', mobile: m, role: 'staff', loginAt: Date.now() }));
    localStorage.setItem('puneNestFlatmateGroups', JSON.stringify([
      { id: 'mgNoDoc', title: t, locality: 'Baner', policy: 'any', rent: 40000, seatsTotal: 3, seatsOpen: 1, members: [{ name: 'NoDoc Host', initials: 'NH', verified: true }], tags: [], note: '', time: 'Just now', createdAt: Date.now(), ownerMobile: '9811111111', ownerName: 'NoDoc Host', hostRole: 'tenant', verificationTier: 'tenant', agreementDeclared: true },
    ]));
    localStorage.setItem('puneNestFlatmateReviews', JSON.stringify([
      { id: 'revNoDoc', groupId: 'mgNoDoc', kind: 'group', host: 'NoDoc Host', address: t + ' · Baner', tier: 'tenant', flagForReview: false, ownerConsent: false, status: 'pending', reason: '', createdAt: Date.now(), updatedAt: Date.now() },
    ]));
  }, [STAFF, title]);
  await page.goto(`${BASE}/ops/flatmate-review`);
  const row = page.locator('tr', { hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row.getByText(/No document/i)).toBeVisible();
  await expect(row.locator('.view-agreement-btn')).toHaveCount(0);
});
