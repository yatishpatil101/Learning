// `/admin/analytics` — the page itself, against the live API.
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

// The seeded admin, as used by the other live admin specs.
const admin = () => authHeaders('9000000000');

// Named once so the "all six" test cannot drift.
const TABS = ['Traffic', 'Engagement', 'Funnel', 'Supply Gap', 'Pricing', 'SLA'];

// Deep links are the page contract, not a shortcut around the UI.
async function openAnalytics(page, tab) {
  await page.goto(tab ? `/admin/analytics?tab=${tab}` : '/admin/analytics');
  await expect(page.getByRole('heading', { name: /Analytics/i })).toBeVisible();
}

test('analytics opens on Traffic with all six tabs, no Conversion or Anonymous surfers tab, its chart cards and a CSV export, and logs no console errors', async ({ page, login, consoleErrors }) => {
  test.slow();
  await login.asAdmin();
  await test.step('analytics page loads without errors', async () => {
    await openAnalytics(page);
    // The heading above is the anchor: an empty error list means nothing if the page never rendered.
    await expect(page.getByRole('tab', { name: 'Traffic' })).toBeVisible();
    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('analytics opens on Traffic and offers all six tabs', async () => {
    await openAnalytics(page);
    await expect(page.getByRole('tab', { name: 'Traffic' })).toHaveAttribute('aria-selected', 'true');
    for (const label of TABS) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible();
    }
  });
  await test.step('analytics does not show a Conversion tab', async () => {
    await openAnalytics(page);
    // Conversion lives on the Enquiries funnel (`admin/consolidation.spec.js` asserts it).
    await expect(page.getByRole('tab', { name: 'Traffic' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Conversion' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Anonymous surfers' })).toHaveCount(0);
  });
  await test.step('Traffic tab: chart cards and range selector', async () => {
    await openAnalytics(page);
    await expect(page.getByText('Sessions & page views')).toBeVisible();
    await expect(page.getByText('Traffic sources')).toBeVisible();
    await expect(page.getByText('Device split')).toBeVisible();
    // `session_id` is per-tab, so a return visit is underivable from what is collected.
    await expect(page.getByText('Anonymous vs signed-in')).toBeVisible();
    await expect(page.getByLabel('Report window')).toBeVisible();
  });
  await test.step('Traffic tab: the anonymous-audience tiles and exit cards sit below the charts', async () => {
    await openAnalytics(page);
    for (const label of ['Anonymous share', 'Anonymous sessions', 'Signups in period']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Session \u2192 Signup rate', { exact: true })).toBeVisible();
    await expect(page.getByText('Where visitors leave')).toBeVisible();
    await expect(page.getByText('Pages visited by anonymous users')).toBeVisible();
  });
  await test.step('Traffic tab: export produces a CSV', async () => {
    await openAnalytics(page);
    // Armed before the click so an export that quietly produced no file fails.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export traffic CSV/i }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
  });
});

test('the tab is carried in the URL, retired deep links fall back to Traffic, and switching tabs keeps the days selector', async ({ page, login }) => {
  test.slow();
  await login.asAdmin();
  await test.step('clicking a tab updates the URL search param', async () => {
    await openAnalytics(page);
    await page.getByRole('tab', { name: 'Engagement' }).click();
    await expect(page).toHaveURL(/tab=engagement/);
  });
  await test.step('a deep link to the retired Geography tab falls back to Traffic', async () => {
    await openAnalytics(page, 'geography');
    await expect(page.getByRole('tab', { name: 'Geography' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Traffic' })).toHaveAttribute('aria-selected', 'true');
  });
  await test.step('a deep link to the retired Seasonal tab falls back to Traffic', async () => {
    // Seasonal was a real tab with a real URL, so bookmarks and pasted links to it exist.
    await openAnalytics(page, 'seasonal');
    await expect(page.getByRole('tab', { name: 'Seasonal' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Traffic' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Sessions & page views')).toBeVisible();
  });
  await test.step('a deep link to the retired Anonymous surfers tab falls back to Traffic', async () => {
    await openAnalytics(page, 'surfers');
    await expect(page.getByRole('tab', { name: 'Anonymous surfers' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Traffic' })).toHaveAttribute('aria-selected', 'true');
  });
  await test.step('one header window drives every windowed tab and survives tab switches', async () => {
    await openAnalytics(page);
    await page.getByLabel('Report window').click();
    await page.getByRole('option', { name: 'Last 30 days' }).click();
    await expect(page.getByLabel('Report window')).toContainText('30 days');

    await page.getByRole('tab', { name: 'Funnel' }).click();
    await expect(page.getByLabel('Report window')).toContainText('30 days');
    await expect(page.getByText('Stages by week')).toBeVisible();

    await page.getByRole('tab', { name: 'Supply Gap' }).click();
    await expect(page.getByLabel('Report window')).toContainText('30 days');
    await expect(page.getByText('Property views (30d)')).toBeVisible();

    await page.getByRole('tab', { name: 'SLA' }).click();
    await expect(page.getByText('Listings reviewed (30d)')).toBeVisible();

    // Pricing is a live snapshot, so offering a window there would be a control that does nothing.
    await page.getByRole('tab', { name: 'Pricing' }).click();
    await expect(page.getByLabel('Report window')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Traffic' }).click();
    await expect(page.getByLabel('Report window')).toContainText('30 days');
  });
});

test('every tab renders its own charts, KPI tiles and tables', async ({ page, login }) => {
  test.slow();
  await login.asAdmin();
  await test.step('Engagement tab renders its charts', async () => {
    await openAnalytics(page, 'engagement');
    await expect(page.getByText('Avg. session duration')).toBeVisible();
    await expect(page.getByText('Bounce rate')).toBeVisible();
    await expect(page.getByText('Top pages by views')).toBeVisible();
  });
  await test.step('Supply Gap tab renders KPI cards and the table', async () => {
    await openAnalytics(page, 'supply-gap');
    await expect(page.getByText('Under-served', { exact: true })).toBeVisible();
    await expect(page.getByText('Well-served', { exact: true })).toBeVisible();
    await expect(page.getByText('Supply vs Demand by Locality')).toBeVisible();
    await expect(page.getByText('All Localities')).toBeVisible();
  });
  await test.step('Pricing tab renders KPI tiles and the locality table', async () => {
    await openAnalytics(page, 'pricing');
    await expect(page.getByText('Localities priced')).toBeVisible();
    await expect(page.getByText('Locality Pricing Breakdown')).toBeVisible();
  });
  await test.step('SLA tab renders the review KPI row, the four measured tracks and the targets', async () => {
        await openAnalytics(page, 'sla');
    await expect(page.getByText('Listings reviewed')).toBeVisible();
    await expect(page.getByText('Avg time to review')).toBeVisible();
    await expect(page.getByText('Longest Waiting Listings')).toBeVisible();
    // `GET /admin/analytics/sla` derives all three from `audit_log`, so a heading claims served data.
    await expect(page.getByRole('heading', { name: 'Ticket Pickup' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Service Delivery' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Concierge Pipeline' })).toBeVisible();
    await expect(page.getByText('SLA Targets')).toBeVisible();
  });
});

test('City Expansion Requests counts the asks the server holds, not the ones this browser made', async ({ page, login, request }) => {
  await login.asAdmin();
  // The panel's whole history is why the count is asserted rather than the heading.
  const city = 'Kolkata';
  const asks = 3;
  for (let i = 0; i < asks; i += 1) {
    const res = await request.post(`${API}/cities/waitlist`, {
      data: { city, mobile: `9${String(Date.now()).slice(-8)}${i}` },
    });
    // Checked per ask: three silent 4xx would leave the panel empty and the failure would then be
    // reported against the screen, which is the wrong place to look.
    expect(res.status()).toBe(201);
  }

  await openAnalytics(page, 'supply-gap');
  await expect(page.getByRole('heading', { name: 'City Expansion Requests' })).toBeVisible();

  // Row scope avoids depending on Kolkata outranking waitlist rows created by other specs.
  const row = page.locator('div').filter({ has: page.getByText(city, { exact: true }) }).last();
  await expect(row).toContainText(String(asks));
  await expect(row).toContainText(/last \d{1,2} \w{3,4} \d{4}/);

  // The endpoint must aggregate to counts so waitlist mobiles never reach this page.
  await expect(page.locator('body')).not.toContainText(/\b9\d{9}\b/);
});

test('a failed read of the expansion requests says so, instead of saying nobody asked', async ({ page, login }) => {
  await login.asAdmin();
  // Null-until-loaded matters because `[]` hides the loading branch this test covers.
  await page.route('**/admin/cities/waitlist', (route) => route.fulfill({ status: 500, body: '{}' }));

  await openAnalytics(page, 'supply-gap');
  await expect(page.getByRole('heading', { name: 'City Expansion Requests' })).toBeVisible();

  await expect(page.getByText(/Couldn't load city requests/i)).toBeVisible();
  await expect(page.getByText(/No city requests yet/i)).toHaveCount(0);

  // And the failed state is recoverable without a reload.
  await page.unroute('**/admin/cities/waitlist');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText(/Couldn't load city requests/i)).toHaveCount(0);
});

test('a failed supply-gap read says so instead of zeroing every locality KPI', async ({ page, login }) => {
  await login.asAdmin();
  await page.route('**/admin/supply-gap*', (route) => route.fulfill({ status: 500, body: '{}' }));

  await openAnalytics(page, 'supply-gap');
  await expect(page.getByRole('alert').filter({ hasText: /supply-gap report did not answer/i })).toBeVisible();
  await expect(page.getByText('Under-served', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/No demand alerts yet/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'City Expansion Requests' })).toBeVisible();
});

test('Funnel tab totals each stage over the window the API reports', async ({ page, login, request }) => {
  await login.asAdmin();
  const res = await request.get(`${API}/admin/analytics/funnel?days=30`, { headers: await admin() });
  expect(res.ok()).toBeTruthy();
  const { weeks } = await res.json();
  expect(weeks.length).toBeGreaterThan(0);

  await openAnalytics(page, 'funnel');
  await page.getByLabel('Report window').click();
  await page.getByRole('option', { name: 'Last 30 days' }).click();
  await expect(page.getByText('Stages by week')).toBeVisible();

  for (const stage of ['posted', 'approved', 'contacts', 'visits', 'deals']) {
    const total = weeks.reduce((sum, w) => sum + w[stage], 0);
    await expect(page.getByTestId(`funnel-${stage}`).locator('div').first()).toHaveText(total.toLocaleString('en-IN'));
  }
  await expect(page.getByText(/Biggest drop|Not enough activity/)).toBeVisible();
});

test('a failed funnel read says so instead of showing zero stages', async ({ page, login }) => {
  await login.asAdmin();
  await page.route('**/admin/analytics/funnel*', (route) => route.fulfill({ status: 500, body: '{}' }));

  await openAnalytics(page, 'funnel');
  await expect(page.getByRole('alert').filter({ hasText: /funnel report did not answer/i })).toBeVisible();
  await expect(page.getByTestId('funnel-posted')).toHaveCount(0);
});

test('unmeasured values read as unmeasured and no tab presents generated numbers', async ({ page, login, request }) => {
  test.slow();
  await login.asAdmin();
  await test.step('SLA tab reports an unmeasured turnaround as unrecorded, not as zero', async () => {
    // Missing turnaround renders as "not recorded"; `0h` would claim instant review.
    const res = await request.get(`${API}/admin/analytics/sla`, { headers: await admin() });
    expect(res.ok()).toBeTruthy();
    const { avgHoursToReview } = await res.json();

    await openAnalytics(page, 'sla');
    expect(
      avgHoursToReview,
      'the e2e seed records no review decisions, so this is expected to be null; if it is a number '
        + 'the assertion below is the wrong one and the test needs rewriting, not relaxing',
    ).toBeNull();

    // Scope to this card because unrelated panels can legitimately render `0h`.
    const reviewTile = page.locator('div.rounded-xl').filter({ hasText: 'Avg time to review' });
    await expect(reviewTile).toHaveCount(1);
    await expect(reviewTile).toContainText('not recorded');
    // The specific wrong answer this guards against. A `|| 0` creeping back into `hours()` — whose
    // own comment promises "Never `0h`" — reads as a real measurement of a review that was never timed.
    await expect(reviewTile).not.toContainText('0h');
  });
  await test.step('nothing anywhere on the SLA tab claims a zero-hour turnaround', async () => {
    await openAnalytics(page, 'sla');
    await expect(page.getByRole('heading', { name: 'Concierge Pipeline' })).toBeVisible();
    await expect(page.getByText(/(^|[^\d.])0h\b/)).toHaveCount(0);
  });
  await test.step('Pricing tab shows a dash, not the market rate, where nothing was measured', async () => {
    await openAnalytics(page, 'pricing');
    const table = page.locator('table').filter({ has: page.getByText('Asking ₹/sqft') });
    await expect(table).toBeVisible();

    // Localities with too few approved flats must not borrow curated market rates.
    await expect(page.getByText(/\d+ of \d+ localities have too few flats to price/)).toBeVisible();

    const dashRow = table.locator('tbody tr').filter({ hasText: '—' }).first();
    await expect(dashRow).toBeVisible();
    // Asking is the dash; market is a rupee figure on the same row. Both halves matter: the first
    // proves nothing was invented, the second proves the dash is not simply an empty table.
    await expect(dashRow.locator('td').nth(2)).toHaveText('—');
    await expect(dashRow.locator('td').nth(1)).toContainText('₹');
  });
  await test.step('no analytics tab presents generated numbers', async () => {
    for (const tab of ['traffic', 'engagement', 'funnel', 'supply-gap', 'pricing', 'sla']) {
      await openAnalytics(page, tab);
      await expect(page.locator('[role="tabpanel"], main').first()).toBeVisible();
      await expect(page.getByText('Illustrative data.')).toHaveCount(0);
      await expect(page.getByText('Sample', { exact: true })).toHaveCount(0);
    }
  });
});
