// Live coverage for the finance console and the three reads behind it (ledger item 20, ).
import { test, expect } from '@playwright/test';
import { API, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS } from '../fixtures/live.js';
import { trackErrors } from '../helpers/console.js';

// Indian grouping, so commas are not every three.
function rupeesFrom(text) {
  const digits = String(text).replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

async function tileValue(page, label) {
  const card = page.locator('.dz-card').filter({ hasText: label }).first();
  await expect(card).toBeVisible();
  return rupeesFrom(await card.locator('.text-xl.font-extrabold').first().innerText());
}

async function gotoFinance(page) {
  await page.goto('/admin/finance');
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
}

const KPIS = [
  'MRR (subscriptions)',
  'Revenue this month',
  'Services revenue',
  'Revenue (12 mo)',
  'ARPU',
  'ARPPU',
];

const COLUMNS = ['ID', 'Date', 'Party', 'Type', 'Platform take', 'Status'];

// The ledger's empty copy, from `AdminFinance.jsx` (`<Table empty="…">`).
const EMPTY_TX = 'No transactions match.';

async function pickSelectOption(page, ariaLabel, optionText) {
  await page.locator(`[aria-label="${ariaLabel}"]`).click();
  const option = page.locator('.dz-dropdown__option', { hasText: optionText }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator('.dz-dropdown__option')).toHaveCount(0);
}

async function columnValues(page, nth) {
  return (await page.locator(`tbody tr td:nth-child(${nth})`).allTextContents()).map((t) => t.trim());
}

test.describe('admin finance API', () => {
  test('the series and the overview agree about this month, and the overview, series and ledger keep their shape', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const [overview, series] = await Promise.all([
      request.get(`${API}/admin/finance`, { headers }).then((r) => r.json()),
      request.get(`${API}/admin/finance/series?months=1`, { headers }).then((r) => r.json()),
    ]);

    const banded = series[0].subscriptions + series[0].services;
    // Nothing but an assertion that fetches both and compares them can catch them drifting apart.
    expect(banded).toBe(overview.monthRevenue);

    for (const field of ['mrr', 'monthRevenue', 'users', 'payingUsers', 'revenue']) {
      expect(typeof overview[field], `${field} is a number`).toBe('number');
      expect(overview[field], `${field} is not negative`).toBeGreaterThanOrEqual(0);
    }
    for (const gone of ['gstCollected', 'pendingSettlement', 'payoutsDue', 'payoutsCompleted',
      'payoutsMeasured']) {
      expect(overview[gone], `${gone} belonged to the withdrawn rent rail`).toBeUndefined();
    }

    const points = await (await request.get(`${API}/admin/finance/series?months=6`, { headers })).json();
    for (const p of points) {
      expect(typeof p.subscriptions).toBe('number');
      expect(p.subscriptions).toBeGreaterThanOrEqual(0);
      expect(p.featured, `${p.month} carries no featured band`).toBeUndefined();
      expect(p.rent, `${p.month} carries no rent band`).toBeUndefined();
    }

    const res = await request.get(`${API}/admin/finance/transactions?size=100`, { headers });
    expect(res.status()).toBe(200);
    const page = await res.json();

    expect(page.content.length, 'the seed has transactions to measure').toBeGreaterThan(0);
    expect(page.totalElements).toBeGreaterThanOrEqual(page.content.length);
    for (const row of page.content) {
      expect(['paid', 'pending', 'failed']).toContain(row.status);
      expect(row.amount).toBeGreaterThanOrEqual(0);
      expect(row.method, 'no row carries a payment instrument').toBeUndefined();
    }
  });
});

test.describe('finance console UI behaviour', () => {
  test('the finance console renders what the API returned: tiles, disclosures, ledger, filters, search, exports, charts and the transaction drawer', async ({ page, request }) => {
    test.slow();
    await signIn(page, ACTORS.admin, { screen: 'staff' });
    await test.step('finance page loads without JS errors', async () => {
      const errors = trackErrors(page);
      await gotoFinance(page);
      await expect(page.getByText(KPIS[0])).toBeVisible();
      expect(errors).toHaveLength(0);
    });
    await test.step('the MRR and revenue tiles equal the API, to the rupee', async () => {
      const headers = await authHeaders(ACTORS.admin, { request });
      const overview = await request.get(`${API}/admin/finance`, { headers }).then((r) => r.json());

      // Compared to the API because invented finance figures can be internally consistent.
      // Quiet half, on the seed as it stands: fewer rows than the ceiling, so there is nothing to say.
      await gotoFinance(page);

      expect(await tileValue(page, 'MRR (subscriptions)')).toBe(overview.mrr);
      expect(await tileValue(page, 'Revenue this month')).toBe(overview.monthRevenue);
      expect(await tileValue(page, 'Services revenue')).toBe(0);
    });
    await test.step('finance shows all eight KPI tiles with INR values', async () => {
      await gotoFinance(page);
      await expect(page.getByText(KPIS[0])).toBeVisible();

      for (const label of KPIS) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }
      const values = page.locator('.dz-card .text-xl.font-extrabold');
      const count = await values.count();
      expect(count).toBe(KPIS.length);
      for (let i = 0; i < count; i++) {
        await expect(values.nth(i)).toContainText('\u20B9');
      }
    });
    await test.step('the disclosures the server sets are the disclosures the screen shows', async () => {
      const headers = await authHeaders(ACTORS.admin, { request });
      const overview = await request.get(`${API}/admin/finance`, { headers }).then((r) => r.json());

      await gotoFinance(page);
      const panel = page.locator('[data-testid="finance-disclosures"]');

      // Driven off the payload rather than hardcoded to "three disclosures are showing".
      await expect(panel).toBeVisible();
      for (const [flag, phrase] of [
        [overview.refundsMeasured, /no refund path/i],
        [overview.serviceOrdersCounted, /excludes the services marketplace/i],
      ]) {
        if (flag) await expect(panel).not.toContainText(phrase);
        else await expect(panel).toContainText(phrase);
      }

      // This sentence would imply an unused payout path rather than no payout path.
      await expect(panel).not.toContainText(/payout/i);
    });
    await test.step('ledger renders rows with the expected columns', async () => {
      await gotoFinance(page);
      await expect(page.getByText('Recent transactions')).toBeVisible();
      for (const header of COLUMNS) {
        await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
      }
      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeGreaterThan(0);
      await expect(page.locator('tbody .rounded-full').first()).toBeVisible();
    });
    await test.step('the ledger on screen is the ledger from the API', async () => {
      const headers = await authHeaders(ACTORS.admin, { request });
      const ledger = await request
        .get(`${API}/admin/finance/transactions?size=100`, { headers })
        .then((r) => r.json());
      expect(ledger.content.length, 'the floor').toBeGreaterThan(0);

      await gotoFinance(page);
      await expect(page.getByText('Recent transactions')).toBeVisible();

      const first = ledger.content[0];
      const table = page.getByRole('table');
      await expect(table).toBeVisible();
      // The newest row the API returned is the first row the table draws — the ordering is the
      // server's, and a console that re-sorted locally would quietly disagree with its own pager.
      await expect(table.locator('tbody tr').first()).toContainText(first.party);
    });
    await test.step('the ledger offers only the settlement vocabulary a row can hold', async () => {
      await gotoFinance(page);
      await expect(page.locator('tbody tr').first()).toBeVisible();

      await page.locator('[aria-label="Filter by status"]').click();
      const options = page.locator('.dz-dropdown__option');
      await expect(options.first()).toBeVisible();
      const labels = (await options.allTextContents()).map((s) => s.trim());

      // Do not advertise transaction states the platform cannot produce.
      expect(labels).toEqual(['All statuses', 'Paid', 'Pending', 'Failed']);
    });
    await test.step('searching by party keeps only matching rows', async () => {
      await gotoFinance(page);
      await expect(page.locator('tbody tr').first()).toBeVisible();
      const before = await columnValues(page, 3);
      const term = before[0].split(' ')[0];
      expect(term.length).toBeGreaterThan(0);

      await page.getByPlaceholder('Search party…').fill(term);

      await expect(page.getByText(EMPTY_TX)).toHaveCount(0);
      const after = await columnValues(page, 3);
      expect(after.length).toBeGreaterThan(0);
      expect(after.length).toBeLessThanOrEqual(before.length);
      for (const party of after) {
        expect(party.toLowerCase()).toContain(term.toLowerCase());
      }
    });
    await test.step('an unmatchable search shows the empty state', async () => {
      await gotoFinance(page);
      await expect(page.locator('tbody tr').first()).toBeVisible();
      await page.getByPlaceholder('Search party…').fill('zzzz-no-such-party-zzzz');

      const table = page.getByRole('table');
      await expect(table.getByText(EMPTY_TX)).toBeVisible();
      await expect(table.locator('tbody tr td:nth-child(2)')).toHaveCount(0);
    });
    await test.step('filtering by type keeps only rows of that type', async () => {
      await gotoFinance(page);
      await expect(page.locator('tbody tr').first()).toBeVisible();
      const before = await columnValues(page, 4);
      const type = before.find(Boolean);
      expect(type).toBeTruthy();

      await pickSelectOption(page, 'Filter by type', type);

      const after = await columnValues(page, 4);
      expect(after.length).toBeGreaterThan(0);
      expect(after.length).toBeLessThanOrEqual(before.length);
      for (const value of after) {
        expect(value.toLowerCase()).toContain(type.toLowerCase());
      }
    });
    await test.step('the ledger filters are sent to the server', async () => {
      await gotoFinance(page);
      await expect(page.locator('tbody tr').first()).toBeVisible();
      const filtered = page.waitForRequest((r) => /\/admin\/finance\/transactions\?.*status=failed/.test(r.url()));
      await pickSelectOption(page, 'Filter by status', 'Failed');
      await filtered;
    });
    await test.step('finance header exports a revenue CSV', async () => {
      await gotoFinance(page);
      await expect(page.getByText(KPIS[0])).toBeVisible();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: /Revenue CSV/i }).click();
      expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
    });
    await test.step('the ledger exports a CSV', async () => {
      await gotoFinance(page);
      await expect(page.getByText('Recent transactions')).toBeVisible();
      const download = page.waitForEvent('download');
      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].filter((b) => /CSV/i.test(b.textContent));
        buttons[buttons.length - 1]?.click();
      });
      expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
    });
    await test.step('revenue charts render and the window selector redraws them cleanly', async () => {
      const errors = trackErrors(page);
      await gotoFinance(page);
      await expect(page.getByText(KPIS[0])).toBeVisible();
      await expect(page.getByText('Revenue by month')).toBeVisible();
      await expect(page.getByText('Revenue mix (this month)')).toBeVisible();
      const chart = page.locator('.dz-card', { has: page.getByText('Revenue by month') }).locator('canvas');
      await expect(chart).toBeVisible();
      const before = await chart.evaluate((canvas) => canvas.toDataURL());

      await pickSelectOption(page, 'Revenue window', '6 months');
      await expect(page.locator('[aria-label="Revenue window"]')).toContainText('6 months');
      await expect.poll(() => chart.evaluate((canvas) => canvas.toDataURL())).not.toBe(before);
      expect(errors).toHaveLength(0);
    });
    await test.step('opening a transaction shows every field and closes on Escape', async () => {
      await gotoFinance(page);
      await expect(page.getByText('Recent transactions')).toBeVisible();
      const rows = page.locator('tbody tr button');
      expect(await rows.count()).toBeGreaterThan(0);

      await page.evaluate(() => { document.querySelector('tbody tr button')?.click(); });

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByText(/Transaction ·/)).toBeVisible();
      for (const label of COLUMNS) {
        await expect(dialog.getByText(label, { exact: true })).toBeVisible();
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
    await test.step('a ledger longer than one page says so on screen', async () => {
      await gotoFinance(page);
      await expect(page.getByRole('table')).toBeVisible();
      await expect(page.getByTestId('ledger-window')).toHaveCount(0);

      // Loud half: the same rows, reported as the first few of many.
      await page.route('**/admin/finance/transactions*', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({
          response: res,
          json: { ...body, totalElements: (body.content?.length ?? 0) + 250 },
        });
      });
      await page.goto('/admin/finance');
      await expect(page.getByTestId('ledger-window')).toContainText(/of \d+ matching transactions/);
    });
  });

});
