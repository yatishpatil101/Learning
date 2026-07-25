import { test, expect } from '@playwright/test';

/* "Backfill a seat" — a sitting tenant or group owner manages open seats without
   re-verifying the group. A replacement listing declares only the seat(s) actually
   open now; the owner reopens a seat when a flatmate leaves and closes one when
   filled. The group keeps its verification tier across reopen/close. */

const BASE = 'http://localhost:5173';
const MOBILE = '9812345678';

async function seedUser(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Backfill Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, mobile);
}

async function createGroup(page, title, { sharing = '3', open = '1', agreement = false } = {}) {
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Create a group/i }).click();
  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('45000');
  await page.locator('input[type="number"]').nth(1).fill(sharing); // People sharing
  await page.locator('input[type="number"]').nth(2).fill(open);    // Seats open now
  await page.getByPlaceholder(/Your name/i).fill('Backfill Host');
  if (agreement) await page.getByText(/registered rent agreement/i).click();
  await page.getByRole('button', { name: /Create group/i }).click();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 5000 });
}

test('a replacement listing shows only the seats declared open (1 of 3)', async ({ page }) => {
  const title = 'Backfill one seat AAA in Baner';
  await seedUser(page);
  await createGroup(page, title, { sharing: '3', open: '1' });
  const card = page.locator('.sf-card', { hasText: title }).first();
  // Only 1 seat is open even though the flat is 3-sharing.
  await expect(card.getByText(/1 seat left/i)).toBeVisible();
  await expect(card.getByText(/3 sharing/i)).toBeVisible();
});

test('owner reopens a seat when a flatmate leaves (persists across reload)', async ({ page }) => {
  const title = 'Backfill reopen BBB in Baner';
  await seedUser(page);
  await createGroup(page, title, { sharing: '3', open: '1' });
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.getByRole('button', { name: /Reopen a seat/i }).click();
  await expect(card.getByText(/2 seats left/i)).toBeVisible({ timeout: 5000 });
  await page.reload();
  const card2 = page.locator('.sf-card', { hasText: title }).first();
  await card2.waitFor({ timeout: 10000 });
  await expect(card2.getByText(/2 seats left/i)).toBeVisible();
});

test('owner marks the last open seat filled → group shows Full', async ({ page }) => {
  const title = 'Backfill fill CCC in Baner';
  await seedUser(page);
  await createGroup(page, title, { sharing: '3', open: '1' });
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.getByRole('button', { name: /Mark a seat filled/i }).click();
  await expect(card.getByText(/^Full$/i)).toBeVisible({ timeout: 5000 });
  // The close control is disabled at zero open seats.
  await expect(card.getByRole('button', { name: /Mark a seat filled/i })).toBeDisabled();
});

test('reopening a seat keeps the group\'s Tenant-verified badge (no re-verification)', async ({ page }) => {
  const title = 'Backfill keeps badge DDD in Baner';
  // Seed a tenant group Ops has already approved (badge earned), then reopen a seat.
  await page.addInitScript(({ m, t }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Backfill Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    localStorage.setItem('puneNestShareGroups', JSON.stringify([
      { id: 'mgBadge1', title: t, locality: 'Baner', policy: 'women', rent: 45000, seatsTotal: 3, seatsOpen: 1, members: [{ name: 'Backfill Host', initials: 'BH', verified: true }], tags: [], note: '', time: 'Just now', createdAt: Date.now(), ownerMobile: m, ownerName: 'Backfill Host', verificationTier: 'tenant', agreementDeclared: true },
    ]));
    localStorage.setItem('puneNestShareReviews', JSON.stringify([
      { id: 'revBadge1', groupId: 'mgBadge1', kind: 'group', host: 'Backfill Host', tier: 'tenant', status: 'approved', createdAt: Date.now(), updatedAt: Date.now() },
    ]));
  }, { m: MOBILE, t: title });
  await page.goto(`${BASE}/share-flat?view=groups`);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  await expect(card.getByText(/Tenant-verified/i)).toBeVisible();
  await card.getByRole('button', { name: /Reopen a seat/i }).click();
  await expect(card.getByText(/2 seats left/i)).toBeVisible({ timeout: 5000 });
  // Badge survives the reopen.
  await expect(card.getByText(/Tenant-verified/i)).toBeVisible();
});

test('legacy group (no seatsOpen) steps from its fallback count by exactly one', async ({ page }) => {
  const title = 'Legacy group EEE in Baner';
  // A group persisted before the backfill feature has no seatsOpen — the stepper
  // must start from the fallback (seatsTotal - members) and move by exactly the delta.
  await page.addInitScript((t) => {
    const m = '9812345678';
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Backfill Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    localStorage.setItem('puneNestShareGroups', JSON.stringify([
      { id: 'mgLegacy1', title: t, locality: 'Baner', policy: 'women', rent: 45000, seatsTotal: 3, members: [{ name: 'Backfill Host', initials: 'BH', verified: true }], tags: [], note: '', time: 'Just now', createdAt: Date.now(), ownerMobile: m, ownerName: 'Backfill Host' },
    ]));
  }, title);
  await page.goto(`${BASE}/share-flat?view=groups`);
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  // Fallback = 3 total - 1 member = 2 seats left.
  await expect(card.getByText(/2 seats left/i)).toBeVisible();
  await card.getByRole('button', { name: /Reopen a seat/i }).click();
  await expect(card.getByText(/3 seats left/i)).toBeVisible({ timeout: 5000 });
  // Capped at seatsTotal — the reopen control disables at the ceiling.
  await expect(card.getByRole('button', { name: /Reopen a seat/i })).toBeDisabled();
});
