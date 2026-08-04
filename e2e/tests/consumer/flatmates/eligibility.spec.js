import { test, expect } from '@playwright/test';
import { postAsGroup, switchToTeamUp } from '../../../helpers/app.js';

/* Host eligibility tiers on flatmate groups. A sitting tenant seeking a
   replacement flatmate can't produce ownership docs, so they UPLOAD a registered
   rent agreement — the artifact Ops reviews. The "Tenant-verified" badge is EARNED
   only after Ops approves it; until then the post shows "Pending Ops review". An
   owner attaches an Ops-verified property to earn "Owner-verified". Identity-only
   posts carry no host badge. The "Verified only" filter surfaces owner-verified and
   Ops-approved tenant groups. */

const BASE = 'http://localhost:5173';
const MOBILE = '9812345678';

async function seedUser(page, { mobile = MOBILE, listing = null } = {}) {
  await page.addInitScript(({ m, l }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Eligible User', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    if (l) localStorage.setItem('puneNestListings:' + m, JSON.stringify([l]));
  }, { m: mobile, l: listing });
}

async function openGroupModal(page) {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postAsGroup(page);
}

async function fillCore(page, title) {
  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('40000');
  await page.getByPlaceholder(/Your name/i).fill('Eligible User');
}

test('tenant who uploads a rent agreement lands in Pending Ops review (no badge yet)', async ({ page }) => {
  const title = 'Tenant replacement AAA in Baner';
  await seedUser(page);
  await openGroupModal(page);
  await fillCore(page, title);
  // Default role is "Current tenant"; declare + upload the registered rent agreement.
  await page.getByText(/registered rent agreement/i).click();
  await page.getByLabel('Upload registered rent agreement for group').setInputFiles({ name: 'agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test agreement') });
  await page.getByRole('button', { name: /Create group/i }).click();
  await switchToTeamUp(page);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // Badge is EARNED, not self-claimed: withheld until Ops approves the upload.
  await expect(card.getByText(/Pending Ops review/i)).toBeVisible();
  await expect(card.getByText(/Tenant-verified/i)).toHaveCount(0);
});

test('tenant who declares but does not upload posts identity-only (no badge)', async ({ page }) => {
  const title = 'Tenant declare-only EEE in Baner';
  await seedUser(page);
  await openGroupModal(page);
  await fillCore(page, title);
  // Check the box but attach no file — declaration alone can't earn the tier.
  await page.getByText(/registered rent agreement/i).click();
  await page.getByRole('button', { name: /Create group/i }).click();
  await switchToTeamUp(page);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.getByText(/Tenant-verified|Owner-verified/i)).toHaveCount(0);
});

test('tenant without an agreement posts identity-only (no host badge)', async ({ page }) => {
  const title = 'Tenant no-proof BBB in Baner';
  await seedUser(page);
  await openGroupModal(page);
  await fillCore(page, title);
  // Leave the agreement box unchecked.
  await page.getByRole('button', { name: /Create group/i }).click();
  await switchToTeamUp(page);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.getByText(/Tenant-verified|Owner-verified/i)).toHaveCount(0);
});

test('owner with a verified property can attach it and earns Owner-verified', async ({ page }) => {
  const title = 'Owner room-by-room CCC in Baner';
  await seedUser(page, { listing: { id: 'p777', title: 'My 2BHK, Baner', locality: 'Baner', status: 'verified' } });
  await openGroupModal(page);
  await fillCore(page, title);
  await page.getByRole('button', { name: /Flat owner/i }).click();
  // Attach the seeded verified listing (custom Select: trigger button → option).
  await page.getByRole('button', { name: /Attach a verified property/i }).click();
  await page.getByRole('option', { name: 'My 2BHK, Baner' }).click();
  await page.getByRole('button', { name: /Create group/i }).click();
  /* NO Team-up hop here, unlike the other group tests: attaching a property gives
     this group an address, and `tabOf()` sorts an addressed group into Move in now
     (it is a place you can move into, not a set of people still hunting). */
  const card = page.locator('.sf-card', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.getByText(/Owner-verified/i)).toBeVisible();
});

test('"Verified only" filter keeps an Ops-approved Tenant-verified group', async ({ page }) => {
  const title = 'Tenant filter DDD in Baner';
  // Seed a tenant group whose uploaded agreement Ops has already APPROVED — that is
  // the only state in which a tenant post earns its badge and passes verified-only.
  await page.addInitScript(({ m, t }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Eligible User', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    localStorage.setItem('puneNestFlatmateGroups', JSON.stringify([
      { id: 'mgApproved1', title: t, locality: 'Baner', policy: 'women', rent: 40000, seatsTotal: 3, seatsOpen: 1, members: [{ name: 'Eligible User', initials: 'EU', verified: true }], tags: [], note: '', time: 'Just now', createdAt: Date.now(), ownerMobile: m, ownerName: 'Eligible User', verificationTier: 'tenant', agreementDeclared: true },
    ]));
    localStorage.setItem('puneNestFlatmateReviews', JSON.stringify([
      { id: 'revApproved1', groupId: 'mgApproved1', kind: 'group', host: 'Eligible User', tier: 'tenant', status: 'approved', createdAt: Date.now(), updatedAt: Date.now() },
    ]));
  }, { m: MOBILE, t: title });
  await page.goto(`${BASE}/flatmates?view=groups`);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  await expect(card.getByText(/Tenant-verified/i)).toBeVisible();
  // Turn on the verified-only filter; the Ops-approved tenant group must remain.
  await page.getByRole('button', { name: /Verified only/i }).first().click();
  await expect(page.locator('.sf-card', { hasText: title }).first()).toBeVisible();
});
