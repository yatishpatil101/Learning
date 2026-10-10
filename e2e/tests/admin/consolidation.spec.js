/* Negative assertions are anchored on live-rendered positives so a missing page, mock fallback or
   typo cannot pass as a successful removal. */
import { test, expect } from '../../fixtures/live.js';

async function openAdmin(page, path) {
  await page.goto(path);
}

test('/admin/support serves the Support queue, and the sidebar offers it beside the service desks', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await test.step('/admin/support is its own desk and loads clean', async () => {
    await openAdmin(page, '/admin/support');
    await expect(page).toHaveURL(/\/admin\/support$/);

    /* The tab counts, not the shared heading, prove the route reached a served desk rather than an
       API-disabled notice or a blank route. */
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
    await expect(page.getByTestId('tab-count-all')).toHaveText(/^[\d,]+$/);

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('the sidebar offers the Support queue and the Home Loans desk, and no Services overview', async () => {
    await openAdmin(page, '/admin');

    await expect(page.locator('nav a[href="/admin/home-loans"]').first()).toBeVisible();
    await expect(page.locator('nav a[href="/admin/services"]')).toHaveCount(0);
    await expect(page.locator('nav a[href="/admin/support"]').first()).toBeVisible();
  });
});

test('retired tabs and cards are gone and their replacements are in place: Analytics, Team Activity, Content, Finance, Settings, Dashboard', async ({ page, login, consoleErrors }) => {
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
  await test.step('the dashboard has no Quick actions or Platform health, and its tiles lead to the queues that own the work', async () => {
    await openAdmin(page, '/admin');
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();

    await expect(page.getByText('Quick actions')).toHaveCount(0);
    await expect(page.getByText('Platform health')).toHaveCount(0);

    await expect(page.getByRole('main').locator('a[href="/admin/reports"]').filter({ hasText: 'Open Reports' })).toBeVisible();
    const requests = page.getByRole('main').locator('a').filter({ hasText: 'Open Service Requests' });
    await expect(requests).toHaveAttribute('href', /^\/admin\/(home-loans|rent-agreement|legal|interior|packers|valuation)$/);

    const latest = page.locator('.dz-card').filter({ has: page.getByRole('heading', { name: 'Latest service requests' }) });
    await expect(latest).toBeVisible();
    await expect(latest.getByRole('link', { name: 'View all' })).toHaveCount(0);
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
  await test.step('Team Activity opens on Performance, with the log a tab away and no leaderboard', async () => {
    await openAdmin(page, '/admin/staff-activity');
    await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Performance', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Activity log', exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=log\b/);
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Staff Leaderboard' })).toHaveCount(0);
    await expect(page.getByText("Today's Progress")).toHaveCount(0);
  });
  await test.step('Content is the FAQ desk alone, with no Localities or City Demand tab', async () => {
    await openAdmin(page, '/admin/content');

    /* `Add FAQ` anchors the page; Localities moved to its own page and City Demand's data moved to
       Analytics. */
    await expect(page.getByRole('button', { name: 'Add FAQ' })).toBeVisible();

    await expect(page.getByRole('tab', { name: /Localities/i })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /City Demand/i })).toHaveCount(0);
  });
  await test.step('Finance no longer carries the Deal Pipeline card', async () => {
    await openAdmin(page, '/admin/finance');
    await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();

    await expect(page.getByText('Deal Pipeline')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /View all deals/i })).toHaveCount(0);
  });
  await test.step('Settings has no Audit log tab, and its old deep link lands on the first tab', async () => {
    await openAdmin(page, '/admin/settings?tab=audit');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'General', exact: true })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Audit log', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /View Staff Activity/ })).toHaveCount(0);
  });
});

test('Enquiries shows its tabs and rows, and the Funnel and Visits tabs carry the moved Conversion data', async ({ page, login, consoleErrors }) => {
  test.slow();
  await login.asAdmin();
  await test.step('Enquiries shows its four tabs and the Awaiting owner filter', async () => {
    await openAdmin(page, '/admin/enquiries');
    await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

    /* `Awaiting owner` names work only the owner can unblock; `Open leads` pointed operators at work
       they cannot do. */
    await expect(page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Awaiting owner \d/ })).toBeVisible();

    /* Counts belong to `admin/enquiries.spec.js`; prefix matching catches missing tabs without
       duplicating exact totals. */
    for (const label of ['Enquiries', 'Visits', 'Deals', 'Funnel']) {
      await expect(page.getByRole('tab', { name: new RegExp(`^${label}`) })).toBeVisible();
    }

    /* The pager proves rows rendered; zeroed counts and empty tabs are exactly how a failed list call
       can otherwise look. */
    await expect(page.getByTestId('queue-range').first()).toHaveText(/^1–\d+ of \d+$/);
    await expect(page.getByTestId('queue-row').first(),
      'the desk drew its chrome but no rows',
    ).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step("the Enquiries Funnel tab is where Analytics' Conversion tab went", async () => {
    /* Click the tab so `tab=funnel` is an output; navigating there would only prove Playwright obeyed
       the input URL. */
    await openAdmin(page, '/admin/enquiries');
    await page.getByRole('tab', { name: 'Funnel', exact: true }).click();
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
  await test.step('the Funnel offers a date filter and no deal-type filter that would skew one stage', async () => {
    await openAdmin(page, '/admin/enquiries?tab=funnel');
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: '7d', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Buy', exact: true })).toHaveCount(0);
  });
  await test.step('the Enquiries Visits tab lists scheduled visits', async () => {
    await openAdmin(page, '/admin/enquiries?tab=visits');
    await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

    // A visit row reads "Visit <slot>"; an empty visits API would render the tab and no rows.
    await expect(page.getByRole('tab', { name: /^Visits/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('queue-row').first()).toContainText('Visit ');
  });
});
