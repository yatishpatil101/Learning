/* Negative assertions are anchored on live-rendered positives so a missing page, mock fallback or
   typo cannot pass as a successful removal. */
import { test, expect } from '../../fixtures/live.js';

async function openAdmin(page, path) {
  await page.goto(path);
}

test('/admin/support serves the Support queue, and the sidebar offers it beside Services overview', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await test.step('/admin/support is its own desk and loads clean', async () => {
    await openAdmin(page, '/admin/support');
    await expect(page).toHaveURL(/\/admin\/support$/);

    /* The table, not the shared heading, proves the route reached a served desk rather than an
       API-disabled notice or a blank route. */
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('table')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('the sidebar offers both the Support queue and the Services overview', async () => {
    await openAdmin(page, '/admin');

    await expect(page.locator('nav a[href="/admin/services"]').first()).toBeVisible();
    await expect(page.locator('nav a[href="/admin/support"]').first()).toBeVisible();
  });
});

test('retired tabs and cards are gone and their replacements are in place: Analytics, Staff Activity, Content, Finance, Settings audit, Dashboard', async ({ page, login, consoleErrors }) => {
  test.slow();
  await login.asAdmin();
  await test.step('the admin dashboard loads without errors', async () => {
    await openAdmin(page, '/admin');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    /* This card sits behind the dashboard's Promise.all gate, so the error sweep covers fetches
       rather than only first paint. */
    await expect(page.getByRole('heading', { name: 'Pending verification' })).toBeVisible();
    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('Analytics no longer shows a Revenue tab', async () => {
    await openAdmin(page, '/admin/analytics');

    /* `Traffic` proves the tab strip rendered; both tab and button forms are checked so role changes
       cannot make the negative vacuous. */
    await expect(page.getByRole('heading', { name: /Analytics/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Traffic' })).toBeVisible();

    await expect(page.getByRole('tab', { name: /Revenue/i })).toHaveCount(0);
    await expect(page.locator('button:has-text("Revenue")')).toHaveCount(0);
  });
  await test.step("Staff Activity drops Today's Progress and cross-links the audit log", async () => {
    await openAdmin(page, '/admin/staff-activity');
    await expect(page.getByRole('heading', { name: 'Staff Activity', exact: true })).toBeVisible();

    /* The feed is the API anchor, and the cross-link is the replacement for the removed progress
       panel, so both must move together. */
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /View Audit Log/ })).toBeVisible();
    await expect(page.getByText("Today's Progress")).toHaveCount(0);
  });
  await test.step('Content has no Localities tab and no City Demand tab', async () => {
    await openAdmin(page, '/admin/content');

    /* `Banners` anchors the strip; Localities moved to its own page and City Demand's data moved to
       Analytics. */
    await expect(page.getByRole('button', { name: 'Banners', exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: /Localities/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /City Demand/i })).toHaveCount(0);
  });
  await test.step('Finance carries the Deal Pipeline card, and it points at Enquiries', async () => {
    await openAdmin(page, '/admin/finance');
    await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();

    await expect(page.getByText('Deal Pipeline')).toBeVisible();

    /* The destination matters because the accessible name alone cannot distinguish a bad link. */
    const link = page.getByRole('link', { name: /View all deals/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/admin/enquiries');
  });
  await test.step('the Settings audit log cross-links Staff Activity', async () => {
    /* Deep-linking uses the supported tab entry point; asserting the tab still catches a lost audit
       tab instead of silently falling back to General. */
    await openAdmin(page, '/admin/settings?tab=audit');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Audit log', exact: true })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /View Staff Activity/ })).toBeVisible();
  });
});

test('Enquiries shows its KPI tiles and tabs, and the Funnel and Visits tabs carry the moved Conversion data', async ({ page, login, consoleErrors }) => {
  test.slow();
  await login.asAdmin();
  await test.step('Enquiries shows its four KPI tiles and its four tabs', async () => {
    await openAdmin(page, '/admin/enquiries');
    await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

    /* Scope to `main` so the sidebar's Enquiries link cannot pass for a missing KPI strip. */
    const main = page.getByRole('main');
    /* `Awaiting owner` names work only the owner can unblock; `Open leads` pointed operators at work
       they cannot do. */
    for (const label of ['Enquiries', 'Awaiting owner', 'Site visits', 'Deal GMV']) {
      await expect(main.getByText(label, { exact: true })).toBeVisible();
    }

    /* Counts belong to `admin/live-enquiries.spec.js`; prefix matching catches missing tabs without
       duplicating exact totals. */
    for (const label of ['Enquiries', 'Visits', 'Deals', 'Funnel']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
    }

    /* The footer proves rows rendered; zeroed tiles and empty tabs are exactly how a failed list call
       can otherwise look. */
    await expect(page.getByText(/Showing 1–\d+ of \d+ records/),
      'the desk drew its chrome but no rows',
    ).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step("the Enquiries Funnel tab is where Analytics' Conversion tab went", async () => {
    /* Click the tab so `tab=funnel` is an output; navigating there would only prove Playwright obeyed
       the input URL. */
    await openAdmin(page, '/admin/enquiries');
    await page.getByRole('button', { name: 'Funnel', exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=funnel\b/);

    await expect(page.getByRole('heading', { name: 'Conversion Funnel' })).toBeVisible();
    await expect(page.getByText('Platform-wide Conversion Rates')).toBeVisible();

    /* Endpoint metrics prove the funnel drew numbers, not only headings. */
    await expect(page.getByText('Total Enquiries')).toBeVisible();
    await expect(page.getByText('Revenue per Enquiry')).toBeVisible();

    /* The locality table is data-gated, so it proves the list call answered rather than only the
       funnel component mounting. */
    await expect(page.getByText('Breakdown by Locality')).toBeVisible();
  });
  await test.step('Funnel deal pills leave enquiry and visit totals intact', async () => {
     await openAdmin(page, '/admin/enquiries?tab=funnel');
     const main = page.getByRole('main');
     const totalEnquiries = main.getByText('Total Enquiries', { exact: true }).locator('..').locator(':scope > div').first();
     const siteVisits = main.getByText('Site Visits', { exact: true }).locator('..').locator(':scope > div').first();
     const beforeEnquiries = await totalEnquiries.textContent();
     const beforeVisits = await siteVisits.textContent();
     expect(beforeEnquiries, 'the seeded funnel contains enquiries').not.toBe('0');
     expect(beforeVisits, 'the seeded funnel contains visits').not.toBe('0');

     /* Only deals carry deal intent; the pill may change closed-deal figures but not enquiry or visit
         totals with no category to compare. */
     await main.getByRole('button', { name: 'Buy', exact: true }).click();
     await expect(totalEnquiries).toHaveText(beforeEnquiries);
     await expect(siteVisits).toHaveText(beforeVisits);
  });
  await test.step('the Enquiries Visits tab lists scheduled visits', async () => {
    await openAdmin(page, '/admin/enquiries?tab=visits');
    await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

    /* Scope to the table because mobile cards duplicate row text; the row assertion catches an empty
       visits API that would still render static headers. */
    const table = page.getByRole('table');
    await expect(table.getByText('Visit date')).toBeVisible();
    await expect(table.locator('tbody tr').first()).toBeVisible();
  });
});
