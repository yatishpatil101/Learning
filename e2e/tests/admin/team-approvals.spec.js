import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  await page.waitForURL('**/admin');
}

async function openTeam(page) {
  await page.goto(`${BASE}/admin/team`);
  await expect(page.getByRole('heading', { name: 'Team & Access' })).toBeVisible();
}

/* D205 — the admin console now talks to the team API through the services seam, and the mock behind
   that seam enforces the server's refusals instead of quietly accepting everything.
   These specs pin the three behaviours that changed shape, not the plumbing. */

test('pending approvals is a tab on Team & Access and states the maker-checker rule', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await openTeam(page);

  await page.getByRole('tab', { name: /Pending approvals/i }).click();
  // The rule has to be legible on the screen that enforces it, not just in the refusal.
  await expect(page.getByText(/second administrator approves it/i)).toBeVisible();
  /* The seed has a single administrator, so nothing can ever be waiting for a second signature —
     the bootstrap escape auto-approves. The empty state is the honest answer, not a bug.
     Scoped to the table because this screen renders the same sentence twice, once in the table and
     once in the mobile card list, and only one of the two is on screen at a given width. */
  await expect(page.getByRole('cell', { name: /Nothing is waiting for a second signature/i })).toBeVisible();

  expect(errors).toHaveLength(0);
});

test('a back-office account cannot be created as Manager', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await openTeam(page);

  await page.getByRole('button', { name: /Add member/i }).click();
  /* Ops staff is the default precisely because Manager cannot be created; switching to it warns
     before the save rather than after, which is the failure mode this item exists to remove.
     The role picker is the project's own `Select` — a `button[aria-haspopup=listbox]` over
     `button[role=option]`s — so it is opened and clicked, not `selectOption`ed. */
  await page.getByRole('button', { name: /Ops staff/i }).click();
  await page.getByRole('option', { name: /^Manager/i }).click();
  await expect(page.getByText(/not an account type the platform recognises/i)).toBeVisible();

  expect(errors).toHaveLength(0);
});

test('team members can be suspended but not hard-deleted', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await openTeam(page);

  const row = page.getByRole('row', { name: /Rohan Kulkarni/ }).first();
  await expect(row.getByRole('button', { name: /^Suspend$/ })).toBeVisible();
  // There is no DELETE /users/{id} anywhere in the contract; archive is the removal.
  await expect(row.getByRole('button', { name: /^Remove$/ })).toHaveCount(0);

  expect(errors).toHaveLength(0);
});
