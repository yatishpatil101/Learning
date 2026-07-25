import { test, expect } from '@playwright/test';

/* Share-a-Flat alerts (saved searches) — the share-flat analog of the listings
   alert feature. The "create an alert" card (ShareAlertCard) is the single entry
   point: it appears whenever the list is empty OR the seeker has narrowed with 2+
   filters (mirroring how the listings page surfaces its alert card as the search
   tightens). Submitting it creates a per-mobile, dashboard-manageable alert that
   works even signed-out, keyed by the entered number. All three intents —
   Flatmates, Rooms, Groups — are covered via the alert's `tab` field. */

const BASE = 'http://localhost:5173';
const MOBILE = '9876500123';

async function seedUser(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Seeker', mobile: m, role: 'buyer', loginAt: Date.now(),
    }));
  }, mobile);
}

const savedSearches = (page, mobile = MOBILE) =>
  page.evaluate((m) => JSON.parse(localStorage.getItem('pnSavedSearches:' + m) || '[]'), mobile);

/* Force an empty result set so the ShareAlertCard renders: a gibberish smart-search
   query matches no post on any tab. */
async function forceEmpty(page) {
  const input = page.locator('input[placeholder*="girl in baner"]');
  await input.fill('zzqqxxnomatch');
  await input.press('Enter');
}

test('empty-state card creates a share-flat alert keyed to the entered mobile', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/share-flat?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await forceEmpty(page);

  // The alert card appears in the empty state; mobile is prefilled from the user.
  const createBtn = page.getByRole('button', { name: /Create alert/i });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  await expect(page.getByText(/You’re first in line/i)).toBeVisible();

  const saved = await savedSearches(page);
  expect(saved.length).toBe(1);
  expect(saved[0].kind).toBe('shareflat');
  expect(saved[0].tab).toBe('rooms');
});

test('selecting 2 filters reveals the alert card while results remain, and captures the filters', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/share-flat?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  // Baseline: with no filters active and results present, the alert card is hidden.
  await expect(page.getByRole('button', { name: /Create alert/i })).toHaveCount(0);

  // Narrow with two filters that still leave at least one match (Rahul is a
  // non-smoking man), so we exercise the "2+ filters, results present" path.
  await page.getByRole('button', { name: 'Men', exact: true }).click();
  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();
  await page.waitForTimeout(300);

  expect(await page.locator('.sf-card').count()).toBeGreaterThan(0);
  const createBtn = page.getByRole('button', { name: /Create alert/i });
  await expect(createBtn).toBeVisible();

  await createBtn.click();
  await expect(page.getByText(/You’re first in line/i)).toBeVisible();

  const saved = await savedSearches(page);
  expect(saved.length).toBe(1);
  expect(saved[0].kind).toBe('shareflat');
  expect(saved[0].tab).toBe('flatmates');
  expect(saved[0].gender).toBe('male');
  expect(saved[0].habits).toContain('Non-smoker');
  expect(saved[0].label).toMatch(/Flatmates/);
});

test('dashboard Alerts panel shows the share alert with an intent badge, then toggles and deletes it', async ({ page }) => {
  await seedUser(page);
  // Pre-seed one share-flat alert under the user's mobile.
  await page.addInitScript((m) => {
    localStorage.setItem('pnSavedSearches:' + m, JSON.stringify([{
      id: 'ss-test-1', kind: 'shareflat', tab: 'rooms', locality: 'Baner', budget: 15000,
      gender: 'female', verifiedOnly: true, habits: ['Non-smoker'], alerts: true,
      channel: 'whatsapp', at: Date.now(), newCount: 0, mobile: m,
      label: 'Rooms · Baner · ≤ ₹15,000 · Women · Verified',
    }]));
  }, MOBILE);

  await page.goto(`${BASE}/dashboard#alerts`);

  // Intent badge + label render.
  await expect(page.getByText('Rooms · Baner · ≤ ₹15,000 · Women · Verified')).toBeVisible();

  // Toggle alerts off.
  const toggle = page.getByRole('switch').first();
  await toggle.click();
  await page.waitForTimeout(200);
  let saved = await savedSearches(page);
  expect(saved[0].alerts).toBe(false);

  // Delete it.
  await page.getByRole('button', { name: /Delete alert/i }).first().click();
  await page.waitForTimeout(200);
  saved = await savedSearches(page);
  expect(saved.length).toBe(0);
});
