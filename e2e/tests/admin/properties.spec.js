// @ts-check
import { test, expect } from '../../fixtures/base.js';

/*
 * The properties console's three mock keepers.
 *
 * The live suite owns every query, tab, KPI, pipeline transition, and moderation write. These
 * three survive because each proves an interaction shape that no server response can make true:
 * refusing an empty local form, the archive explanation before a destructive action, and the
 * detail dialog's local affordances. The seeded catalogue is intentional here — it supplies a
 * card to open, not an authority about a persisted result.
 *
 * All other claims that used to sit here moved or were deleted as duplicate coverage in
 * `live-properties-console.spec.js`. In particular, Active now starts at Pipeline before it clicks
 * the tile, and the live pipeline suite owns the six columns, the stage menu, and the server-backed
 * flag flow.
 *
 * ## Verdict: HONOURED (3 tests)
 *
 * Each test asserts a client-side interaction shape — form validation refusal, destructive-action
 * explanation, dialog affordances — that no server response can make true or false. The seeded
 * catalogue supplies a card to open, not an authority about a persisted result.
 */
async function openProperties(page, login) {
  await login.asAdmin();
  await page.goto('/admin/properties');
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
  await expect(page.locator('.list-card').first()).toBeVisible();
}

test.describe('Properties dialog shape (mock keeper)', () => {
  test('the flag modal refuses to submit without a reason', async ({ page, login }) => {
    await openProperties(page, login);
    await page.locator('[title="Flag"]').first().click();
    await expect(page.getByRole('heading', { name: 'Flag listing' })).toBeVisible();
    await expect(page.getByText('Internal note (optional)')).toBeVisible();

    await page.getByRole('button', { name: 'Flag listing', exact: true }).click();
    await expect(page.getByText('Add a reason before flagging')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Flag listing' })).toBeVisible();
  });

  test('the archive modal explains what archiving does', async ({ page, login }) => {
    await openProperties(page, login);
    await page.locator('[title="Archive"]').first().click();
    const modal = page.getByRole('dialog', { name: 'Archive listing' });
    await expect(modal.getByRole('heading', { name: 'Archive listing' })).toBeVisible();
    await expect(modal.getByText(/Archiving hides the listing/i)).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  });

  test('the view modal shows the listing detail', async ({ page, login }) => {
    await openProperties(page, login);
    await page.locator('[title="View"]').first().click();
    await expect(page.getByRole('heading', { name: 'Listing details' })).toBeVisible();
    await expect(page.getByText('Listing ID')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  });
});
