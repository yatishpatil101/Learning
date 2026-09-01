import { test, expect } from '@playwright/test';
import { approveFlatmates, postAsGroup, switchToTeamUp } from '../../../helpers/app.js';
import { trackErrors } from '../../../helpers/console.js';

/* Group lifecycle parity with flatmate requests / rooms. Regression cover for the
   three confirmed bugs:
     A — a created group must survive a reload (it lived only in component state).
     B — a created group must be manageable in dashboard My Listings.
     C — the owner must NOT be offered to "Join / Request" their own group. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9811122233';
const TITLE = 'QA group parity ZZZ in Baner';

async function seedUser(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Group Owner', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, mobile);
}

async function createGroup(page) {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postAsGroup(page);
  await page.getByPlaceholder(/2 girls/i).fill(TITLE);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('40000');
  await page.getByPlaceholder(/Your name/i).fill('Group Owner');
  await page.getByRole('button', { name: /Create group/i }).click();
  // Held for review (D72); the lifecycle below is what this file protects.
  await approveFlatmates(page, 'groups');
  await switchToTeamUp(page);
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 5000 });
}

test('A: a created group survives a reload', async ({ page }) => {
  const errors = trackErrors(page);
  await seedUser(page);
  await createGroup(page);
  await page.reload();
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await switchToTeamUp(page);
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 5000 });
  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('C: the owner sees "Your group" + Delete, not a join/request action', async ({ page }) => {
  await seedUser(page);
  await createGroup(page);
  const card = page.locator('.sf-card', { hasText: TITLE }).first();
  await expect(card.getByText(/Your group/i)).toBeVisible();
  await expect(card.getByRole('button', { name: /Delete your group/i })).toBeVisible();
  await expect(card.getByRole('button', { name: /Join group|Request to join/i })).toHaveCount(0);
});

test('C2: deleting the group from its card removes it (and stays gone on reload)', async ({ page }) => {
  await seedUser(page);
  await createGroup(page);
  page.on('dialog', (d) => d.accept());
  const card = page.locator('.sf-card', { hasText: TITLE }).first();
  await card.getByRole('button', { name: /Delete your group/i }).click();
  await expect(page.getByText(TITLE)).toHaveCount(0, { timeout: 5000 });
  await page.reload();
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  /* Hop to Team up before asserting absence. A reload lands on Move in now, where
     this group was never listed — so without the hop the assertion passes whether
     the delete worked or not, which is worse than failing. */
  await switchToTeamUp(page);
  await expect(page.getByText(TITLE)).toHaveCount(0);
});

test('B: a created group appears in dashboard My Listings and is deletable there', async ({ page }) => {
  await seedUser(page);
  await createGroup(page);
  await page.goto(`${BASE}/dashboard#listings`);
  // The group surfaces with its title and the "Flatmate group" type badge.
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/Flatmate group/i).first()).toBeVisible();

  // Deleting it from the dashboard removes it from storage.
  page.on('dialog', (d) => d.accept());
  const row = page.locator('div.rounded-xl', { hasText: TITLE }).last();
  await row.getByRole('button', { name: /^Delete$/i }).first().click();
  await expect(page.getByText(TITLE)).toHaveCount(0, { timeout: 5000 });
});

test('non-owner still sees a join/request action on a seed group', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  // Seed groups have no owner → the join/request CTA is present for everyone.
  await expect(page.getByRole('button', { name: /Join group|Request to join/i }).first()).toBeVisible();
});
