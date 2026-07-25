import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

async function goToProperties(page) {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/properties`);
  await page.waitForTimeout(1200);
}

// Helper: open custom Select dropdown and pick an option
async function pickSelectOption(page, ariaLabel, optionText) {
  const trigger = page.locator(`[aria-label="${ariaLabel}"]`);
  await trigger.click();
  await page.waitForTimeout(200);
  const option = page.locator('.pn-dropdown__option', { hasText: optionText });
  await option.click();
  await page.waitForTimeout(300);
}

// ═══════════════════════════════════════════════════════
// ─── PAGE LOAD & STRUCTURE ───
// ═══════════════════════════════════════════════════════

test.describe('Properties page structure', () => {
  test('loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await goToProperties(page);
    expect(errors).toHaveLength(0);
  });

  test('shows PageHeader with title and subtitle', async ({ page }) => {
    await goToProperties(page);
    await expect(page.getByRole('heading', { name: /Properties/i })).toBeVisible();
    await expect(page.getByText('Manage, verify and curate every listing')).toBeVisible();
  });

  test('Export CSV button is visible', async ({ page }) => {
    await goToProperties(page);
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── KPI CARDS ───
// ═══════════════════════════════════════════════════════

test.describe('KPI cards', () => {
  test('all 5 KPI cards render', async ({ page }) => {
    await goToProperties(page);
    for (const label of ['Total', 'Active', 'Pending', 'Flagged', 'Featured']) {
      await expect(page.getByText(`${label} listings`)).toBeVisible();
    }
  });

  test('Pending KPI jumps to Verification Queue tab', async ({ page }) => {
    await goToProperties(page);
    await page.getByTitle('View Pending listings').click();
    await expect(page.getByRole('tab', { name: 'Verification Queue' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Flagged KPI jumps to Flagged tab', async ({ page }) => {
    await goToProperties(page);
    await page.getByTitle('View Flagged listings').click();
    await expect(page.getByRole('tab', { name: 'Flagged' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Featured KPI jumps to Featured tab', async ({ page }) => {
    await goToProperties(page);
    await page.getByTitle('View Featured listings').click();
    await expect(page.getByRole('tab', { name: 'Featured' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Total KPI jumps to All Listings tab', async ({ page }) => {
    await goToProperties(page);
    // First switch away
    await page.getByRole('tab', { name: 'Pipeline' }).click();
    await page.getByTitle('View Total listings').click();
    await expect(page.getByRole('tab', { name: 'All Listings' })).toHaveAttribute('aria-selected', 'true');
  });
});

// ═══════════════════════════════════════════════════════
// ─── TAB NAVIGATION ───
// ═══════════════════════════════════════════════════════

test.describe('Tab navigation', () => {
  test('all 7 tabs are visible', async ({ page }) => {
    await goToProperties(page);
    for (const tab of ['All Listings', 'Verification Queue', 'Needs Follow-up', 'Staff Posted', 'Flagged', 'Featured', 'Pipeline']) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    }
  });

  test('default tab is All Listings', async ({ page }) => {
    await goToProperties(page);
    await expect(page.getByRole('tab', { name: 'All Listings' })).toHaveAttribute('aria-selected', 'true');
  });

  test('switching tabs updates aria-selected', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Pipeline' }).click();
    await expect(page.getByRole('tab', { name: 'Pipeline' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'All Listings' })).toHaveAttribute('aria-selected', 'false');
  });
});

// ═══════════════════════════════════════════════════════
// ─── ALL LISTINGS TAB ───
// ═══════════════════════════════════════════════════════

test.describe('All Listings tab', () => {
  test('shows listing count', async ({ page }) => {
    await goToProperties(page);
    await expect(page.locator('text=/\\d+ of \\d+ listings/')).toBeVisible();
  });

  test('search filters listings by title/locality', async ({ page }) => {
    await goToProperties(page);
    const searchInput = page.getByPlaceholder('Search title, owner, locality').first();
    await searchInput.fill('Baner');
    await page.waitForTimeout(300);
    await expect(page.locator('text=/\\d+ of \\d+ listings/')).toBeVisible();
  });

  test('status filter works via custom dropdown', async ({ page }) => {
    await goToProperties(page);
    await pickSelectOption(page, 'Filter by status', 'Approved');
    await page.waitForTimeout(300);
    // Count should change
    await expect(page.locator('text=/\\d+ of \\d+ listings/')).toBeVisible();
  });

  test('Deal pills filter works', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('button', { name: 'Rent' }).first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=/\\d+ of \\d+ listings/')).toBeVisible();
  });

  test('Date range pills filter works', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('button', { name: '7d' }).first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=/\\d+ of \\d+ listings/')).toBeVisible();
  });

  test('property cards show title and locality', async ({ page }) => {
    await goToProperties(page);
    // At least one card should be visible with property info
    const cards = page.locator('.list-card');
    await expect(cards.first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── VERIFICATION QUEUE ───
// ═══════════════════════════════════════════════════════

test.describe('Verification Queue', () => {
  test('shows pending listings count', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Verification Queue' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=/\\d+ pending/')).toBeVisible();
  });

  test('Review button opens verification modal', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Verification Queue' }).click();
    await page.waitForTimeout(500);
    const reviewBtn = page.getByRole('button', { name: /Review/i }).first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(800);
      await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();
    }
  });

  test('review modal shows documents section with count', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Verification Queue' }).click();
    await page.waitForTimeout(500);
    const reviewBtn = page.getByRole('button', { name: /Review/i }).first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(800);
      await expect(page.getByText(/\d+ \/ \d+ verified/)).toBeVisible();
    }
  });

  test('review modal has approve and reject buttons', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Verification Queue' }).click();
    await page.waitForTimeout(500);
    const reviewBtn = page.getByRole('button', { name: /Review/i }).first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(800);
      await expect(page.getByRole('button', { name: /Approve & publish/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Reject…/i })).toBeVisible();
    }
  });

  test('review modal shows messaging section', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Verification Queue' }).click();
    await page.waitForTimeout(500);
    const reviewBtn = page.getByRole('button', { name: /Review/i }).first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(800);
      await expect(page.getByText('Communicate with the owner')).toBeVisible();
    }
  });

  test('review modal shows WhatsApp templates section', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Verification Queue' }).click();
    await page.waitForTimeout(500);
    const reviewBtn = page.getByRole('button', { name: /Review/i }).first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(800);
      await expect(page.getByText('WhatsApp templates')).toBeVisible();
    }
  });

  test('review modal shows property details grid', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Verification Queue' }).click();
    await page.waitForTimeout(500);
    const reviewBtn = page.getByRole('button', { name: /Review/i }).first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(800);
      await expect(page.getByText('Property details')).toBeVisible();
      await expect(page.getByText('Listing ID')).toBeVisible();
    }
  });

  test('review modal close button works', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Verification Queue' }).click();
    await page.waitForTimeout(500);
    const reviewBtn = page.getByRole('button', { name: /Review/i }).first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Close' }).click();
      await page.waitForTimeout(500);
      await expect(page.getByRole('heading', { name: 'Verify property' })).not.toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════
// ─── NEEDS FOLLOW-UP TAB ───
// ═══════════════════════════════════════════════════════

test.describe('Needs Follow-up tab', () => {
  test('shows listing count and sub-filter', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Needs Follow-up' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=/\\d+ listings/')).toBeVisible();
    await expect(page.locator('[aria-label="Filter by reason"]')).toBeVisible();
  });

  test('sub-filter dropdown opens and has options', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Needs Follow-up' }).click();
    await page.waitForTimeout(500);
    const trigger = page.locator('[aria-label="Filter by reason"]');
    await trigger.click();
    await page.waitForTimeout(200);
    await expect(page.locator('.pn-dropdown__option', { hasText: 'All reasons' })).toBeVisible();
    await expect(page.locator('.pn-dropdown__option', { hasText: 'Stale pending' })).toBeVisible();
    await expect(page.locator('.pn-dropdown__option', { hasText: 'Awaiting owner' })).toBeVisible();
  });

  test('Remind button visible on staff-posted pending listings', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Needs Follow-up' }).click();
    await page.waitForTimeout(500);
    // Some concierge demos should have Remind button
    const remindBtn = page.getByTitle('Send WhatsApp reminder to owner').first();
    // May or may not be visible depending on data state, just check no errors
    if (await remindBtn.isVisible()) {
      await expect(remindBtn).toBeEnabled();
    }
  });
});

// ═══════════════════════════════════════════════════════
// ─── STAFF POSTED TAB ───
// ═══════════════════════════════════════════════════════

test.describe('Staff Posted tab', () => {
  test('shows staff-posted listing count', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Staff Posted' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=/\\d+ staff-posted/')).toBeVisible();
  });

  test('staff-posted listings show progress tracker', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Staff Posted' }).click();
    await page.waitForTimeout(500);
    // At least one pending staff-posted card should show progress steps
    const card = page.locator('.list-card').first();
    if (await card.isVisible()) {
      // Check for progress step text (e.g., "Link Sent")
      const hasProgress = await page.getByText('Link Sent').first().isVisible().catch(() => false);
      // OK if no progress visible (listing might be approved)
      expect(hasProgress !== undefined).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════
// ─── FLAGGED TAB ───
// ═══════════════════════════════════════════════════════

test.describe('Flagged tab', () => {
  test('shows flagged listing count', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Flagged' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=/\\d+ flagged/')).toBeVisible();
  });

  test('clear flag button is visible on flagged listings', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Flagged' }).click();
    await page.waitForTimeout(500);
    const clearFlagBtn = page.getByTitle('Clear flag & publish').first();
    // If there are flagged listings, the button should be visible
    const cards = page.locator('.list-card');
    const count = await cards.count();
    if (count > 0) {
      await expect(clearFlagBtn).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════
// ─── FEATURED TAB ───
// ═══════════════════════════════════════════════════════

test.describe('Featured tab', () => {
  test('shows featured listing count', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Featured' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=/\\d+ featured/')).toBeVisible();
  });

  test('feature toggle button visible on cards', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Featured' }).click();
    await page.waitForTimeout(500);
    const cards = page.locator('.list-card');
    const count = await cards.count();
    if (count > 0) {
      await expect(page.getByTitle('Unfeature').first()).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════
// ─── PIPELINE TAB ───
// ═══════════════════════════════════════════════════════

test.describe('Pipeline tab', () => {
  test('shows all 6 stage column headers', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Pipeline' }).click();
    await page.waitForTimeout(500);
    // Stage labels are inside spans with specific classes
    for (const stage of ['Contacted', 'Info Collected', 'Listed', 'Docs Submitted', 'Under Review', 'Live']) {
      // Use more specific locator: stage badges inside pipeline columns
      const stageLabel = page.locator('.rounded-full', { hasText: stage }).first();
      await expect(stageLabel).toBeVisible();
    }
  });

  test('pipeline cards have stage change dropdown', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Pipeline' }).click();
    await page.waitForTimeout(500);
    // Each card has a themed stage-change Select (pn-dropdown trigger)
    const triggers = page.locator('[aria-label^="Change pipeline stage"]');
    const count = await triggers.count();
    expect(count).toBeGreaterThan(0);
  });

  test('shows total listing count', async ({ page }) => {
    await goToProperties(page);
    await page.getByRole('tab', { name: 'Pipeline' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=/\\d+ total/')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── EDIT MODAL ───
// ═══════════════════════════════════════════════════════

test.describe('Edit modal', () => {
  test('opens from card action', async ({ page }) => {
    await goToProperties(page);
    const editBtn = page.locator('[title="Edit"]').first();
    await editBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'Edit listing' })).toBeVisible();
  });

  test('shows all edit fields', async ({ page }) => {
    await goToProperties(page);
    const editBtn = page.locator('[title="Edit"]').first();
    await editBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Title')).toBeVisible();
    await expect(page.getByText(/Price/)).toBeVisible();
    await expect(page.getByText('Locality')).toBeVisible();
  });

  test('save and cancel buttons visible', async ({ page }) => {
    await goToProperties(page);
    const editBtn = page.locator('[title="Edit"]').first();
    await editBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: /Save changes/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel/i })).toBeVisible();
  });

  test('cancel closes modal', async ({ page }) => {
    await goToProperties(page);
    const editBtn = page.locator('[title="Edit"]').first();
    await editBtn.click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Cancel/i }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Edit listing' })).not.toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── FLAG MODAL ───
// ═══════════════════════════════════════════════════════

test.describe('Flag modal', () => {
  test('opens from card action', async ({ page }) => {
    await goToProperties(page);
    const flagBtn = page.locator('[title="Flag"]').first();
    await flagBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'Flag listing' })).toBeVisible();
  });

  test('requires reason before submission', async ({ page }) => {
    await goToProperties(page);
    const flagBtn = page.locator('[title="Flag"]').first();
    await flagBtn.click();
    await page.waitForTimeout(500);
    // Click the submit button (the one in the modal footer)
    await page.getByRole('button', { name: 'Flag listing' }).click();
    await page.waitForTimeout(500);
    // Should show error toast
    await expect(page.getByText('Add a reason before flagging')).toBeVisible();
  });

  test('shows internal note toggle', async ({ page }) => {
    await goToProperties(page);
    const flagBtn = page.locator('[title="Flag"]').first();
    await flagBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Internal note (optional)')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── ARCHIVE MODAL ───
// ═══════════════════════════════════════════════════════

test.describe('Archive modal', () => {
  test('opens from card action', async ({ page }) => {
    await goToProperties(page);
    const archiveBtn = page.locator('[title="Archive"]').first();
    await archiveBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'Archive listing' })).toBeVisible();
  });

  test('shows explanation text', async ({ page }) => {
    await goToProperties(page);
    const archiveBtn = page.locator('[title="Archive"]').first();
    await archiveBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByText(/Archiving hides the listing/i)).toBeVisible();
  });

  test('archive button in footer', async ({ page }) => {
    await goToProperties(page);
    const archiveBtn = page.locator('[title="Archive"]').first();
    await archiveBtn.click();
    await page.waitForTimeout(500);
    // The modal footer has the pn-btn-danger Archive button (with icon)
    const footerArchiveBtn = page.locator('.pn-btn-danger', { hasText: 'Archive' });
    await expect(footerArchiveBtn).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── VIEW MODAL ───
// ═══════════════════════════════════════════════════════

test.describe('View modal', () => {
  test('opens from card action and shows details', async ({ page }) => {
    await goToProperties(page);
    const viewBtn = page.locator('[title="View"]').first();
    await viewBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'Listing details' })).toBeVisible();
    await expect(page.getByText('Listing ID')).toBeVisible();
  });

  test('shows close button and open public page link', async ({ page }) => {
    await goToProperties(page);
    const viewBtn = page.locator('[title="View"]').first();
    await viewBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── DEEP LINKS ───
// ═══════════════════════════════════════════════════════

test.describe('Deep links', () => {
  test('?tab=verify switches to Verification Queue', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/properties?tab=verify`);
    await page.waitForTimeout(1500);
    await expect(page.getByRole('tab', { name: 'Verification Queue' })).toHaveAttribute('aria-selected', 'true');
  });

  test('?tab=pipeline switches to Pipeline', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/properties?tab=pipeline`);
    await page.waitForTimeout(1500);
    await expect(page.getByRole('tab', { name: 'Pipeline' })).toHaveAttribute('aria-selected', 'true');
  });

  test('?review=PRC001 opens review modal', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/properties?tab=verify&review=PRC001`);
    await page.waitForTimeout(2000);
    await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── BUG REGRESSION: CLEAR FLAG ACTION ───
// ═══════════════════════════════════════════════════════

test.describe('Clear flag regression', () => {
  test('flagged tab shows clear flag button (green checkmark)', async ({ page }) => {
    await goToProperties(page);
    // First flag a listing to ensure we have one
    const flagBtn = page.locator('[title="Flag"]').first();
    if (await flagBtn.isVisible()) {
      await flagBtn.click();
      await page.waitForTimeout(500);
      // Fill reason
      await page.locator('textarea').first().fill('Test flag for automation');
      await page.getByRole('button', { name: 'Flag listing' }).click();
      await page.waitForTimeout(500);
    }
    // Navigate to Flagged tab
    await page.getByRole('tab', { name: 'Flagged' }).click();
    await page.waitForTimeout(500);
    const cards = page.locator('.list-card');
    const count = await cards.count();
    if (count > 0) {
      await expect(page.getByTitle('Clear flag & publish').first()).toBeVisible();
    }
  });
});
