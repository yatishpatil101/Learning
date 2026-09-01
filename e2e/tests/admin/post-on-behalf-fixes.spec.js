// @ts-check
import { test, expect } from '../../fixtures/base.js';

/*
   What is left here is the wizard's own behaviour, and only that.

   Three tests used to live below this line and have moved to `live-post-on-behalf.spec.js`,
   because each of them ended in a read or a write of `puneNestDB_v5` -- and against the mock
   provider that store holds the object the wizard handed it, verbatim. "The amenities were saved"
   and "the deposit was not" were therefore assertions that the wizard agreed with itself, made
   about a request body the live API is never sent. The duplicate-owner warning was worse: it
   seeded a pending listing into the mock store, which the live provider does not read, so the
   warning it proved was one that could not fire against the real server.

   The five that remain touch no store at all. They are conditional rendering, field cascades,
   a browser-local draft and a label association -- all of it settled before any request is made,
   and none of it cheaper or more honest to assert through the API. This is the shape a mock spec
   should have after a conversion: not a smaller copy of the live one, but the part of the screen
   that never had a server in it.
*/

async function fillOwner(page, name = 'Fix Owner', mobile = '9876543210') {
  await page.getByPlaceholder('Full name of the property owner').fill(name);
  await page.getByPlaceholder('9876543210').fill(mobile);
  await page.getByRole('button', { name: /Next/i }).click();
}

test.describe('Post on Behalf — fixes & enhancements', () => {
  test.beforeEach(async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/post-on-behalf');
    await page.evaluate(() => localStorage.removeItem('pn_pob_draft_v1'));
    await page.reload();
  });

  test('deal toggle is at the top and drives pricing labels', async ({ page }) => {
    // Persistent segmented control visible on step 1
    const group = page.getByRole('group', { name: /Listing deal type/i });
    await expect(group).toBeVisible();
    await group.getByRole('button', { name: /For Sale/i }).click();
    await expect(group.getByRole('button', { name: /For Sale/i })).toHaveAttribute('aria-pressed', 'true');

    // Walk to pricing — label should read "Expected Price" for sale
    await fillOwner(page);
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('900');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(page.getByText('Expected Price')).toBeVisible();
    // Security Deposit field must NOT show for sale
    await expect(page.getByText('Security Deposit')).toHaveCount(0);
  });

  test('BUG A fixed — switching type to Commercial clears stale BHK in Review', async ({ page }) => {
    await fillOwner(page, 'Cascade Owner');
    // Pick Flat + 3 BHK
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /3 BHK/i }).click();
    // Switch to Commercial (trigger now shows the chosen type label)
    await page.getByText('Flat / Apartment').click();
    await page.getByRole('option', { name: /Commercial/i }).click();
    await page.getByText('Select commercial type').click();
    await page.getByRole('option', { name: /Office Space/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('1200');
    await page.getByRole('button', { name: /Next/i }).click();
    // Location
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    // Pricing
    await page.locator('input[inputmode="numeric"]').first().fill('9000000');
    await page.getByRole('button', { name: /Next/i }).click();
    // Photos -> Review
    await page.getByRole('button', { name: /Next/i }).click();
    // Review must NOT contain "BHK"
    const config = page.getByText('Config', { exact: true });
    await expect(config).toHaveCount(0);
    await expect(page.getByText(/3 BHK/)).toHaveCount(0);
    await expect(page.getByText('1200 sq.ft')).toBeVisible();
  });

  test('BUG C fixed — land type hides floor/facing/furnishing and relabels area', async ({ page }) => {
    await fillOwner(page, 'Land Owner');
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Open Plot/i }).click();
    // Area label becomes Plot Area; physical fields hidden
    await expect(page.getByText('Plot Area (sq.ft) *')).toBeVisible();
    await expect(page.getByText('Furnishing')).toHaveCount(0);
    await expect(page.getByText('Facing')).toHaveCount(0);
    await expect(page.getByText('Amenities')).toHaveCount(0);
  });

  test('draft autosave — refresh mid-wizard offers Resume', async ({ page }) => {
    await page.getByPlaceholder('Full name of the property owner').fill('Draft Owner');
    await page.getByPlaceholder('9876543210').fill('9876500000');
    // Wait for the autosave to actually land rather than sleeping and hoping. A `waitForTimeout`
    // here would pass on a fast machine even if autosave were removed entirely — the reload below
    // would simply find no draft and the test would fail for a confusing reason, or pass because
    // an older draft was still sitting in storage.
    await expect.poll(async () =>
      await page.evaluate(() => localStorage.getItem('pn_pob_draft_v1') !== null)).toBe(true);
    await page.reload();
    await expect(page.getByText(/unsaved draft/i)).toBeVisible();
    await page.getByRole('button', { name: /^Resume$/ }).click();
    await expect(page.getByPlaceholder('Full name of the property owner')).toHaveValue('Draft Owner');
  });

  test('labels are associated with inputs (clicking label focuses field)', async ({ page }) => {
    await page.getByText('Owner Name *').click();
    await expect(page.locator('#pob-ownerName')).toBeFocused();
  });
});

