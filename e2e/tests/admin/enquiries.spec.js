import { test, expect } from '../../fixtures/base.js';

// Admin Enquiries & Deals Funnel — /admin/enquiries
// Guarded by RoleRoute roles=['admin'] + ModuleRoute moduleKey="enquiries".
// Source: frontend/src/pages/admin/AdminEnquiries.jsx (+ enquiries/FunnelView.jsx).
// Seeded data: 60 enquiries (13 "new"), 23 visits, 16 deals.
//
// Bucket: keep, justified (D252).
//
// Every claim below is about the browser: which tabs render, that a `<Select>` narrows an
// already-fetched array, that a URL parameter survives a tab click, that the contact column is
// masked before anyone asks. None of it is a claim about server state — the board is read-only, so
// there is nothing here that could be written to a database and read back to check.
//
// The two facts that *are* the server's have their own file, `live-enquiries.spec.js`: that the
// masking is the API's rather than the client's, and that the awaiting-owner tile counts the word
// the server actually emits. That second one is there because it was wrong here for as long as this
// file existed and this file could never have caught it — the mock store hands back the vocabulary
// the client gave it, so `new` and `open` are always present in mock mode and the tile always has
// something to count.

test('admin loads the Enquiries & Deals desk with tabs, KPIs and table', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

  // Tabs are buttons carrying a live count (Funnel has no count).
  await expect(page.getByRole('button', { name: /^Enquiries \(\d/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Visits \(\d/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Deals \(\d/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Funnel', exact: true })).toBeVisible();

  // KPI tiles.
  await expect(page.getByText('Awaiting owner')).toBeVisible();
  await expect(page.getByText('Site visits')).toBeVisible();
  await expect(page.getByText('Deal GMV')).toBeVisible();

  // Paginated table renders the enquiries feed.
  await expect(page.getByText(/Showing 1–\d+ of \d+ records/)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('Funnel tab renders the conversion funnel and syncs the URL', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  await page.getByRole('button', { name: 'Funnel', exact: true }).click();
  await expect(page).toHaveURL(/tab=funnel/);

  await expect(page.getByRole('heading', { name: 'Conversion Funnel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform-wide Conversion Rates' })).toBeVisible();
  await expect(page.getByText('Total Enquiries')).toBeVisible();
  await expect(page.getByText('Revenue per Enquiry')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('deep-linking ?tab=deals opens the Deals tab with deal columns', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries?tab=deals');

  // Deal-specific column headers (Value / Closed) are unique to the deals table.
  await expect(page.getByRole('columnheader', { name: 'Value', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Closed', exact: true })).toBeVisible();
  await expect(page.getByText(/Showing 1–\d+ of \d+ records/)).toBeVisible();
});

test('status filter narrows the enquiries table', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  /* The counts are read off the screen rather than written down here. They used to be `60 shown`
     and `13 shown`, which are `db.json` magnitudes — so the test failed whenever anyone added a
     seed row, and the repair was always to edit the literal, which taught nobody anything. The
     behaviour worth pinning is that the filter *narrows*: fewer rows after than before, at least
     one left, and nothing outside the chosen status leaking through. All three survive a reseed. */
  const shown = page.getByText(/\d+ shown/);
  const count = async () => Number((await shown.innerText()).match(/\d+/)[0]);

  await expect(shown).toBeVisible();
  const before = await count();
  expect(before).toBeGreaterThan(0);

  // Open the custom status dropdown and pick "New".
  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'New', exact: true }).click();

  await expect(shown).not.toHaveText(`${before} shown`);
  const after = await count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
  // No responded/closed rows leak through the "new" filter.
  await expect(page.getByText('responded', { exact: true })).toHaveCount(0);
});

test('marking an enquiry responded writes a note on the listing', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  // Narrow to actionable "new" leads so a Responded control is present.
  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'New', exact: true }).click();

  await page.getByRole('button', { name: 'Responded' }).first().click();

  /* This used to read "Marked as responded", and that toast was a small lie in mock mode: the
     button flipped `status` in the browser store through `mutateDb` and nothing left the tab. On a
     live build it did something else entirely, so the two modes disagreed about what the same
     control meant. The status write is gone \u2014 `contact_requests.status` is the *owner's* consent
     decision, not an ops field \u2014 and both modes now do the one thing there is to do: leave a note
     on the listing, through `addNote`, which has a real provider on either side. */
  await expect(page.getByRole('alert')).toContainText('Note added to the listing');
});

// D25 — the board masks contact numbers under both providers. The mock provider does its own
// masking rather than serving the store's raw numbers, so this pair of tests exercises the same
// screen behaviour the live desk has, and a regression that unmasked the list would fail here
// rather than only in the (much rarer) live run.
test('the enquiries board shows masked mobile numbers', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  // At least one masked number is on screen, and no ten-digit number is.
  await expect(page.getByText(/^\d{2}X{5}\d{3}$/).first()).toBeVisible();
  await expect(page.getByText(/^[6-9]\d{9}$/)).toHaveCount(0);
});

test('revealing a contact replaces the mask on that row only', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  const masked = page.getByText(/^\d{2}X{5}\d{3}$/);
  await expect(masked.first()).toBeVisible();
  const maskedBefore = await masked.count();
  expect(maskedBefore).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Reveal contact' }).first().click();

  await expect(page.getByRole('alert')).toContainText('recorded');
  await expect(page.getByText(/^[6-9]\d{9}$/)).toHaveCount(1);
  await expect(page.getByText(/^\d{2}X{5}\d{3}$/)).toHaveCount(maskedBefore - 1);
});

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/enquiries');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toHaveCount(0);
});

test('a buyer cannot open the admin enquiries desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/enquiries');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toHaveCount(0);
});
