import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

// Ignore third-party / asset noise that is unrelated to the RBAC feature.
const IGNORE = /favicon|leaflet|unpkg|tile\.openstreetmap|cdn|ERR_INTERNET|net::ERR/i;

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  await page.waitForURL('**/admin');
}

// Scoped-manager quick-login buttons live under "Scoped managers".
async function loginAsManager(page, label) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForURL('**/admin');
}

function navLink(page, name) {
  return page.locator('nav').getByRole('link', { name, exact: true });
}

// ─── Super-admin sees everything ───

test('super-admin sees all admin nav tabs incl. Team & Access', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  for (const tab of ['Dashboard', 'Properties', 'Users', 'Finance', 'Team & Access', 'Settings']) {
    await expect(navLink(page, tab)).toBeVisible({ timeout: 5000 });
  }
  expect(errors).toHaveLength(0);
});

// ─── Scoped manager sees only granted tabs ───

test('Verifications manager sees only granted tabs', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsManager(page, 'Verifications');
  // Granted: base Dashboard + Properties (verify-only sub-scope unlocks the Properties tab)
  for (const tab of ['Dashboard', 'Properties']) {
    await expect(navLink(page, tab)).toBeVisible({ timeout: 5000 });
  }
  // Denied: not in the role bundle, and admin-only control surfaces
  for (const tab of ['Users', 'Finance', 'Enquiries', 'Team & Access', 'Settings']) {
    await expect(navLink(page, tab)).toHaveCount(0);
  }
  expect(errors).toHaveLength(0);
});

test('Requests Desk manager sees enquiries/services + its per-user override', async ({ page }) => {
  await loginAsManager(page, 'Requests Desk');
  // Role bundle: enquiries, services, postOnBehalf; per-user override adds Users.
  for (const tab of ['Dashboard', 'Enquiries', 'Services', 'Post on Behalf', 'Users']) {
    await expect(navLink(page, tab)).toBeVisible({ timeout: 5000 });
  }
  await expect(navLink(page, 'Properties')).toHaveCount(0);
  await expect(navLink(page, 'Team & Access')).toHaveCount(0);
});

// ─── Direct-URL enforcement ───

test('scoped manager is redirected from a denied module URL', async ({ page }) => {
  await loginAsManager(page, 'Verifications');
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForURL('**/admin');
  expect(new URL(page.url()).pathname).toBe('/admin');
});

test('verify-only manager opens Properties limited to the Verification Queue', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsManager(page, 'Verifications');
  await page.goto(`${BASE}/admin/properties`);
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible({ timeout: 5000 });
  // Verify-only scope: only the Verification Queue tab, no full-console tabs.
  await expect(page.getByRole('tab', { name: 'Verification Queue' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'All Listings' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Featured' })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/admin/properties');
  expect(errors).toHaveLength(0);
});

test('scoped manager cannot reach the Team & Access page', async ({ page }) => {
  await loginAsManager(page, 'Content');
  await page.goto(`${BASE}/admin/team`);
  await page.waitForURL('**/admin');
  expect(new URL(page.url()).pathname).toBe('/admin');
});

// ─── Team & Access management UI ───

test('Team & Access page renders seeded members and roles', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/team`);
  await expect(page.getByRole('heading', { name: /Team & Access/i })).toBeVisible({ timeout: 5000 });
  // Seeded internal users
  await expect(page.getByText('Rohan Kulkarni').first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Sneha Patil').first()).toBeVisible({ timeout: 5000 });
  expect(errors).toHaveLength(0);
});

test('cannot demote the last active administrator via the edit form', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/team`);
  const adminRow = page.getByRole('row', { name: /Administrator/ }).first();
  await adminRow.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit member' })).toBeVisible({ timeout: 5000 });
  // Change role Administrator → Manager, then attempt to save.
  await page.getByRole('button', { name: /Administrator — full access/ }).click();
  await page.getByRole('option', { name: /Manager — scoped admin access/ }).click();
  await page.getByRole('button', { name: /Save changes/ }).click();
  // Guard blocks it — error surfaces and the member stays an admin.
  await expect(page.getByText(/last active administrator/i)).toBeVisible({ timeout: 5000 });
});

