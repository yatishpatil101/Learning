/* Data states of /admin/finance that the live seed cannot reach. `refundsMeasured` and
 * `serviceOrdersCounted` are server properties (`draazy.finance.*`), not settings the API writes, and
 * the seed always carries an active subscription, so each state is staged by patching the finance
 * responses the console reads. The component is real; only the payload is chosen. */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, signIn } from '../../helpers/liveAuth.js';

const OVERVIEW = /\/api\/admin\/finance(\?.*)?$/;
const SERIES = /\/api\/admin\/finance\/series(\?.*)?$/;
const LEDGER = /\/api\/admin\/finance\/transactions(\?.*)?$/;

const REFUNDS_NOTE = 'Refunds: the platform has no refund path, so no refund can be recorded here.';
const SERVICES_NOTE = 'Revenue excludes the services marketplace: a service order records a quote, not money received.';
const SERVICES_QUOTED = 'Quoted value, not money received, so it is left out of revenue.';

async function patchOverview(page, getPatch) {
  const seen = { hits: 0 };
  await page.route(OVERVIEW, async (route) => {
    if (route.request().resourceType() === 'document') return route.fallback();
    seen.hits += 1;
    const res = await route.fetch();
    const body = await res.json();
    const merged = { ...body, ...getPatch() };
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    return route.fulfill({ response: res, json: merged });
  });
  return seen;
}

async function stageJson(page, pattern, json) {
  const seen = { hits: 0 };
  await page.route(pattern, async (route) => {
    if (route.request().resourceType() === 'document') return route.fallback();
    seen.hits += 1;
    return route.fulfill({ json });
  });
  return seen;
}

async function openFinance(page) {
  await page.goto('/admin/finance');
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
  await expect(page.getByText('MRR (subscriptions)')).toBeVisible();
}

const tile = (page, label) => page.locator('.dz-card').filter({ hasText: label }).first().locator('.text-xl.font-extrabold');
const flowRow = (page, label) => page.locator('div.border-b').filter({ has: page.getByText(label, { exact: true }) });

async function statusOptions(page) {
  await page.locator('[aria-label="Filter by status"]').click();
  const options = page.locator('.dz-dropdown__option');
  await expect(options.first()).toBeVisible();
  const labels = (await options.allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);
  return labels;
}

async function expectInventedRowsGone(page) {
  await expect(page.getByText(/Partner payouts/)).toHaveCount(0);
  await expect(page.getByText(/Platform commission/)).toHaveCount(0);
  await expect(page.getByText('Payouts & outstanding')).toHaveCount(0);
  await expect(page.getByText('Rent held for landlords')).toHaveCount(0);
  await expect(page.getByText('Owner plan', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Seeker plan', { exact: true })).toHaveCount(0);
  expect(await statusOptions(page)).toEqual(['All statuses', 'Paid', 'Pending', 'Failed']);
}

test.describe('finance console: empty subscription book', () => {
  test('an empty book reads as zero, says no plans are active, and shows none of the invented rows', async ({ page }) => {
    test.slow();
    await signIn(page, ACTORS.admin, { screen: 'staff' });
    const overview = await patchOverview(page, () => ({
      mrr: 0, monthRevenue: 0, refunds: 0, payingUsers: 0, plans: [],
    }));
    const series = await stageJson(page, SERIES, []);
    const ledger = await stageJson(page, LEDGER, {
      content: [], totalElements: 0, totalPages: 0, number: 0, size: 100,
    });

    await openFinance(page);
    await expect(page.getByText('No active paid plans.')).toBeVisible();
    await expect(page.locator('div.border-t').filter({ hasText: 'MRR total' })).toContainText('₹0');
    for (const label of ['MRR (subscriptions)', 'Revenue this month', 'Services revenue', 'Revenue (12 mo)', 'ARPU', 'ARPPU']) {
      await expect(tile(page, label), label).toHaveText('₹0');
    }
    await expect(page.getByText('Across the 0 who paid this month.')).toBeVisible();
    await expect(page.getByRole('table').getByText('No transactions match.')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/NaN|Infinity/);

    await expectInventedRowsGone(page);

    expect(overview.hits).toBeGreaterThan(0);
    expect(series.hits).toBeGreaterThan(0);
    expect(ledger.hits).toBeGreaterThan(0);
  });

  test('on the seeded book the invented split, modelled plans and refund-shaped statuses are also absent', async ({ page }) => {
    await signIn(page, ACTORS.admin, { screen: 'staff' });
    await openFinance(page);
    await expect(page.getByText('MRR total')).toBeVisible();
    await expectInventedRowsGone(page);
  });
});

test.describe('finance console: structural-zero disclosure', () => {
  test('by default the services and refund gaps are disclosed and the marked rows keep their figures', async ({ page, request }) => {
    test.slow();
    const flags = await request.get(`${API}/admin/finance`, { headers: await authHeaders(ACTORS.admin, { request }) })
      .then((r) => r.json());
    expect(flags.refundsMeasured, 'server default').toBe(false);
    expect(flags.serviceOrdersCounted, 'server default').toBe(false);
    expect(flags.payoutsCompleted, 'the payouts rail is gone, so there is nothing to disclose').toBeUndefined();

    await signIn(page, ACTORS.admin, { screen: 'staff' });
    const overview = await patchOverview(page, () => ({ monthRevenue: 4200, refunds: 0 }));
    await stageJson(page, SERIES, [{ month: '2026-09-01', subscriptions: 3300, services: 900 }]);

    await openFinance(page);
    const banner = page.getByTestId('finance-disclosures');
    await expect(banner).toContainText('Not every figure below is measured');
    await expect(banner).toContainText(REFUNDS_NOTE);
    await expect(banner).toContainText(SERVICES_NOTE);
    await expect(page.getByText(REFUNDS_NOTE)).toHaveCount(2);
    await expect(page.getByText(SERVICES_NOTE)).toHaveCount(2);
    await expect(page.getByText(SERVICES_QUOTED)).toHaveCount(2);

    const gross = flowRow(page, 'Gross revenue');
    await expect(gross).toContainText('₹4,200');
    await expect(gross).toContainText('Not measured');
    const refunds = flowRow(page, 'Refunds');
    await expect(refunds).toContainText('₹0');
    await expect(refunds).toContainText('Not measured');
    await expect(flowRow(page, 'Net retained')).toContainText('₹4,200');
    await expect(tile(page, 'Services revenue')).toHaveText('₹900');
    await expect(tile(page, 'Revenue this month')).toHaveText('₹4,200');
    expect(overview.hits).toBeGreaterThan(0);
  });

  test('each flag controls only its own disclosure, and a missing flag reads as not measured', async ({ page }) => {
    test.slow();
    await signIn(page, ACTORS.admin, { screen: 'staff' });
    let patch = {};
    const overview = await patchOverview(page, () => patch);

    const cases = [
      { name: 'both flags on', patch: { refundsMeasured: true, serviceOrdersCounted: true }, refunds: false, services: false },
      { name: 'only refunds measured', patch: { refundsMeasured: true, serviceOrdersCounted: false }, refunds: false, services: true },
      { name: 'only service orders counted', patch: { refundsMeasured: false, serviceOrdersCounted: true }, refunds: true, services: false },
      { name: 'refunds flag absent, services on', patch: { refundsMeasured: undefined, serviceOrdersCounted: true }, refunds: true, services: false },
      { name: 'services flag absent, refunds on', patch: { refundsMeasured: true, serviceOrdersCounted: undefined }, refunds: false, services: true },
      { name: 'both flags absent', patch: { refundsMeasured: undefined, serviceOrdersCounted: undefined }, refunds: true, services: true },
    ];

    for (const c of cases) {
      await test.step(c.name, async () => {
        patch = { ...c.patch, monthRevenue: 4200, refunds: 0 };
        const before = overview.hits;
        await openFinance(page);
        expect(overview.hits, 'the patched overview was served').toBeGreaterThan(before);

        const banner = page.getByTestId('finance-disclosures');
        if (c.refunds || c.services) await expect(banner).toBeVisible();
        else await expect(banner).toHaveCount(0);

        await expect(page.getByText(REFUNDS_NOTE)).toHaveCount(c.refunds ? 2 : 0);
        await expect(page.getByText(SERVICES_NOTE)).toHaveCount(c.services ? 2 : 0);
        await expect(page.getByText(SERVICES_QUOTED)).toHaveCount(c.services ? 2 : 0);
        await expect(flowRow(page, 'Refunds').getByText('Not measured')).toHaveCount(c.refunds ? 1 : 0);
        await expect(flowRow(page, 'Gross revenue').getByText('Not measured')).toHaveCount(c.services ? 1 : 0);

        await expect(flowRow(page, 'Gross revenue')).toContainText('₹4,200');
        await expect(flowRow(page, 'Refunds')).toContainText('₹0');
        await expect(flowRow(page, 'Net retained')).toContainText('₹4,200');
      });
    }
  });
});
