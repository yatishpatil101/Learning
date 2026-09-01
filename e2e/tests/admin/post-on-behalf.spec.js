// @ts-check
import { test, expect } from '../../fixtures/base.js';
import { appReady } from '../../helpers/app.js';

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

  test('completes full wizard — listing saved as pending with staff tracking', async ({ page }) => {
    await page.goto('/admin/post-on-behalf');

    // Step 1
    await page.getByPlaceholder('Full name of the property owner').fill('Rajesh Kumar');
    await page.getByPlaceholder('9876543210').fill('9876543210');
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 2
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('950');
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 3
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByPlaceholder('e.g. Blue Ridge Township').fill('Blue Ridge SEZ');
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 4
    const priceInput = page.locator('input[inputmode="numeric"]').first();
    await priceInput.fill('28000');
    await expect(priceInput).toHaveValue('28,000');
    await page.getByRole('button', { name: '2 months rent' }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 5
    await page.getByRole('button', { name: /Add Photo/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 6 — verify "Send to Owner" (not "Publish Listing")
    await expect(page.getByText('Rajesh Kumar')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send to Owner/i })).toBeVisible();

    // Submit
    await page.getByRole('button', { name: /Send to Owner/i }).click();

    // Success — listing is pending
    await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('verification queue')).toBeVisible();
  });

  test('posted listing appears in Properties → Verification Queue with staff badge', async ({ page }) => {
    await page.goto('/admin/post-on-behalf');

    // Quick fill the wizard
    await page.getByPlaceholder('Full name of the property owner').fill('Badge Test Owner');
    await page.getByPlaceholder('9876543210').fill('9123456789');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('800');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Wakad/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    const priceInput = page.locator('input[inputmode="numeric"]').first();
    await priceInput.fill('20000');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByRole('button', { name: /Send to Owner/i }).click();
    await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 5000 });

    // Navigate to Properties page
    await page.getByRole('button', { name: /View All Properties/i }).click();
    await page.waitForURL('**/admin/properties');

    // Click on Verification Queue tab
    await page.getByRole('tab', { name: /Verification Queue/i }).click();

    // Search for the specific listing to find it even if paginated
    await page.getByPlaceholder('Search title, owner, locality…').fill('Badge Test Owner');
    await expect(page.getByText('Badge Test Owner').first()).toBeVisible({ timeout: 5000 });
  });

  test('staff activity page — redesigned with KPIs, filters, and link', async ({ page }) => {
    // First post a listing to generate activity
    await page.goto('/admin/post-on-behalf');
    await page.getByPlaceholder('Full name of the property owner').fill('Activity Test');
    await page.getByPlaceholder('9876543210').fill('9111222333');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByRole('button', { name: /For Sale/i }).click();
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /3 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('1500');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Kothrud/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    const priceInput = page.locator('input[inputmode="numeric"]').first();
    await priceInput.fill('15000000');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Send to Owner/i }).click();
    await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 5000 });

    // Navigate to Staff Activity page
    await page.goto('/admin/staff-activity');
    await expect(page.getByText('Staff Activity')).toBeVisible();

    // KPI cards (visible when staffActivity.kpis flag is on — default: on).
    //
    // Two counted facts and then the two busiest kinds of record in the window. The page used to
    // carry hardcoded "Listings posted" and "Services handled" tiles, which named both whether or
    // not either had happened; this spec asserted those literals and went stale the day they went.
    // Testids for the two fixed tiles, because their labels are prose; the entity tiles are matched
    // by their pattern rather than by name, since which two appear depends on the activity there is.
    await expect(page.getByText('Total activities')).toBeVisible();
    await expect(page.getByTestId('kpi-total')).toBeVisible();
    await expect(page.getByTestId('kpi-staff')).toBeVisible();
    await expect(page.getByText('Active staff')).toBeVisible();
    await expect(page.getByText(/ actions$/).first()).toBeVisible();

    // Leaderboard
    await expect(page.getByText('Staff Leaderboard')).toBeVisible();
    await expect(page.getByText('Administrator').nth(1)).toBeVisible();

    // Search filter. Found by its aria-label rather than its placeholder: the placeholder is copy
    // ("Search staff, action or record…") and has already been rewritten once under this assertion.
    //
    // Asserted by what it *excludes*, not by finding a row. This used to type the owner's name and
    // look for it in the table, which worked only because the Record column printed a prose
    // sentence the browser wrote at the moment of the action — "Posted X for Activity Test". That
    // sentence is gone on purpose: what identifies a record is its id, and a caption assembled by
    // the reader is not evidence. So the name is no longer anywhere on the page to find, and the
    // filter is now shown to work by narrowing to nothing on a string that cannot match.
    const rows = page.getByRole('table').locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    await page.getByLabel('Search staff activity').fill('zzz-no-such-activity');
    // Scoped to the table because `Table` renders a desktop table *and* a mobile card list, both
    // carrying the empty message; the card one is display-hidden at this viewport, so an unscoped
    // `.first()` resolves to the hidden copy and never becomes visible.
    await expect(page.getByRole('table').getByText('No staff activity in this window.')).toBeVisible();
    await page.getByLabel('Search staff activity').fill('');
    await expect(rows.first()).toBeVisible();

    // Date range pills exist
    await expect(page.getByRole('button', { name: '7d' })).toBeVisible();

    // Link to Properties page exists
    await expect(page.getByRole('link', { name: /Staff Posted Tab/i })).toBeVisible();
  });

  test('staff activity page — disabled module shows fallback', async ({ page }) => {
    // Disable staffActivity.enabled via the mock DB settings
    await page.goto('/admin/staff-activity');
    await appReady(page);
    await page.evaluate(() => {
      // Read-modify-write: `{}` is not a safe fallback here, it is written straight back and
      // wipes every listing and setting for the rest of the file.
      const raw = localStorage.getItem('puneNestDB_v5');
      if (!raw) throw new Error('mock store missing after appReady()');
      const db = JSON.parse(raw);
      if (!db.settings) db.settings = {};
      if (!db.settings.adminFlags) db.settings.adminFlags = {};
      if (!db.settings.adminFlags.staffActivity) db.settings.adminFlags.staffActivity = {};
      db.settings.adminFlags.staffActivity.enabled = false;
      localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    });
    await page.reload();
    await expect(page.getByText('Staff Activity module is disabled.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Enable in Settings/i })).toBeVisible();

    // Re-enable for other tests
    await page.evaluate(() => {
      // Read-modify-write — an empty fallback would both throw on the deep write below and,
      // worse, be a live hazard if the shape ever changed. Fail loudly instead.
      const raw = localStorage.getItem('puneNestDB_v5');
      if (!raw) throw new Error('mock store missing');
      const db = JSON.parse(raw);
      db.settings.adminFlags.staffActivity.enabled = true;
      localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    });
  });

  test('Properties → Staff Posted tab shows staff-posted listings with edit', async ({ page }) => {
    // Post a listing first
    await page.goto('/admin/post-on-behalf');
    await page.getByPlaceholder('Full name of the property owner').fill('StaffTab Owner');
    await page.getByPlaceholder('9876543210').fill('9222333444');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('900');
    await page.getByRole('button', { name: /Next/i }).click();

    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Hinjawadi/i }).first().click();
    await page.getByRole('button', { name: /Next/i }).click();

    const priceInput = page.locator('input[inputmode="numeric"]').first();
    await priceInput.fill('22000');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Send to Owner/i }).click();
    await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 5000 });

    // Go to Properties page
    await page.goto('/admin/properties');

    // Click Staff Posted tab
    await page.getByRole('tab', { name: /Staff Posted/i }).click();

    // Should show the listing
    await expect(page.getByText('StaffTab Owner')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Hinjawadi').first()).toBeVisible({ timeout: 3000 });

    // Should show "Posted By" column with staff name
    await expect(page.getByText('Administrator').first()).toBeVisible();

    // Should have Edit button (pencil icon)
    const editBtn = page.locator('button[title="Edit"]').first();
    await expect(editBtn).toBeVisible();
  });
});
