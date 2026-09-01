// @ts-check
import { test, expect } from '../../fixtures/base.js';

/**
 * The concierge wizard's client-side half: navigation, validation and the arithmetic it does while
 * an operator is still typing.
 *
 * Everything this file used to claim about *what the submit button produced* now lives against the
 * real server, and had to, because the mock could not have been wrong about any of it. The provider
 * stored the object the wizard handed it, so "the listing was saved as pending, posted by staff,
 * and appears under the Staff Posted tab" was the wizard's own create body, read back and compared
 * with itself. The moved claims and where they went:
 *
 * - `completes full wizard — listing saved as pending with staff tracking` → deleted. The title
 *   promised a save; the body only asserted the success heading. `live-post-on-behalf.spec.js`
 *   walks the same six steps and then reads the listing back off `/me/listings`.
 * - `posted listing appears in Properties → Verification Queue with staff badge` and
 *   `Properties → Staff Posted tab shows staff-posted listings with edit` →
 *   `the Staff Posted tab holds what the desk typed, and not what an owner sent in` and
 *   `a concierge listing is drawn with the hand-back pipeline an owner submission never gets`, in
 *   `live-properties-console.spec.js`. Live, `postedByStaff` is a uuid the server derives from the
 *   caller's token, so whether the tab finds anything is a real question there. The old version
 *   also asserted a "Posted By column with staff name" via `getByText('Administrator').first()` —
 *   there is no such column, and the match was the signed-in name in the admin topbar.
 * - `staff activity page — redesigned with KPIs, filters, and link` → deleted. Fully covered by
 *   `live-staff-activity.spec.js`. The reason recorded here used to be that its premise — that
 *   posting a listing writes an activity row — "was `logStaffActivity` writing to `localStorage`,
 *   **which no server does**". That last clause is wrong, and wrong in the direction that matters:
 *   `Routes.STAFF_ACTIVITY` is `/admin/staff-activity`, with a service, a repository, a filter and
 *   a summary behind it, so a concierge post *does* surface as staff activity on a live build. What
 *   no server does is the **mechanism**. `StaffActivityService` is emphatic about it — "there is no
 *   writing here and there never will be. Staff activity is not a thing the platform records on
 *   purpose; it is what `audit_log` already contains, read from the other end" — because the mock's
 *   design made "was this action recorded?" a question about whether somebody remembered to add a
 *   call at that site, so the feed's completeness measured the attentiveness of the last person to
 *   edit the page. Deriving it from the audit trail every write already appends to makes
 *   completeness structural instead. The deleted test could not have seen that difference: it
 *   asserted a row it had itself caused to be written.
 * - `staff activity page — disabled module shows fallback` →
 *   `a disabled module explains itself instead of rendering nothing`, in
 *   `live-staff-activity.spec.js`. `adminFlags` is a block of the shared settings *document*; the
 *   mock reached it by editing a local copy, which tested the component's branch and not the switch.
 *
 * What is left is the part that is genuinely client-side and worth keeping cheap: the two routes in,
 * the step-1 guard, and the two live calculators — Indian comma grouping with its `moneyWords`
 * caption, and the deposit multiplier. None of them touch a store.
 */

test.describe('Admin Post on Behalf', () => {
  test.beforeEach(async ({ login }) => {
    await login.asAdmin();
  });

  test('navigates to post-on-behalf from sidebar', async ({ page }) => {
    // Scoped to the sidebar, because two links reach this page: this one and the dashboard's
    // quick-action card ("Post on behalf"). Unscoped, the locator is a race — it matches one
    // element while the dashboard is still rendering and two once it has, so the test passed on a
    // quiet machine and failed with a strict-mode violation under parallel load. Scoping also makes
    // it test what its name claims; `.first()` would have silenced the error while leaving the test
    // free to click the card instead.
    await page.locator('aside').getByRole('link', { name: /Post on Behalf/i }).click();
    await page.waitForURL('**/admin/post-on-behalf');
    await expect(page.getByText('Post on Behalf of Owner')).toBeVisible();
  });

  test('navigates from dashboard quick action', async ({ page }) => {
    await page.locator('main').getByRole('link', { name: /Post on behalf/i }).first().click();
    await page.waitForURL('**/admin/post-on-behalf');
    await expect(page.getByText('Post on Behalf of Owner')).toBeVisible();
  });

  test('validates step 1 - owner details', async ({ page }) => {
    await page.goto('/admin/post-on-behalf');
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(page.getByPlaceholder('Full name of the property owner')).toBeVisible();
  });

  test('price field shows Indian comma formatting and moneyWords', async ({ page }) => {
    await page.goto('/admin/post-on-behalf');

    // Fill step 1
    await page.getByPlaceholder('Full name of the property owner').fill('Test Owner');
    await page.getByPlaceholder('9876543210').fill('9876543210');
    await page.getByRole('button', { name: /Next/i }).click();

    // Fill step 2
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('950');
    await page.getByRole('button', { name: /Next/i }).click();

    // Fill step 3
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 4: Type 2500000 in the price field
    const priceInput = page.locator('input[inputmode="numeric"]').first();
    await priceInput.fill('2500000');
    await expect(priceInput).toHaveValue('25,00,000');
    await expect(page.getByText('≈ ₹ 25 Lakh')).toBeVisible();
  });

  test('deposit month buttons calculate correctly', async ({ page }) => {
    await page.goto('/admin/post-on-behalf');

    // Navigate to step 4
    await page.getByPlaceholder('Full name of the property owner').fill('Test Owner');
    await page.getByPlaceholder('9876543210').fill('9876543210');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('950');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    // Enter rent of 25000
    const priceInput = page.locator('input[inputmode="numeric"]').first();
    await priceInput.fill('25000');

    // Click "2 months rent" button
    await page.getByRole('button', { name: '2 months rent' }).click();

    // Deposit should show 50,000 (25000 × 2)
    const depositInput = page.locator('input[inputmode="numeric"]').nth(1);
    await expect(depositInput).toHaveValue('50,000');
  });
});
