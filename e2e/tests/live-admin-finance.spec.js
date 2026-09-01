/**
 * Live coverage for the finance console and the three reads behind it (ledger item 20, D235).
 *
 * ## What only this file can prove
 *
 * `AdminFinanceConsoleTest` already covers the arithmetic against MockMvc inside a rolled-back
 * transaction — MRR normalisation, the settlement mapping, the guard, the ledger's fee-not-rent
 * rule. What it cannot cover is the running server: that the three routes are mapped where the
 * frontend thinks they are, that the admin token opens them for real, and above all **that the
 * screen is showing what the API returned**.
 *
 * That last one is the whole point of the slice, and it needs the shape of assertion D233 was
 * written about:
 *
 * > When two components disagree about a value, no assertion about the value's *shape* can find it.
 * > Only an assertion that fetches both and compares them can.
 *
 * The console was wrong for months while every figure on it looked plausible — ₹1.4 lakh of MRR, a
 * twenty-four month growth curve, a ledger with a healthy mix of statuses. A test asserting "MRR is
 * a rupee figure" would have passed against all of it. So the tests below read the API directly and
 * then read the rendered tile, and require them to be the same number.
 *
 * ## Why the assertions are agreements and invariants, not magnitudes
 *
 * The seed carries three rent payments and **no** boosts. It now also carries exactly one active
 * subscription — the duplicate-guard fixture's Owner Plus, added for a different spec entirely — so
 * MRR is no longer structurally ₹0. That is a strict improvement here rather than a hazard: nothing
 * below asserts a magnitude, and a non-zero book means the "the plan lines sum to `mrr`" invariant
 * is now summing something. Before it, asserting "MRR is ₹0" would have passed whether or not the
 * query worked, which is a green record of nothing. The rent fees remain the deliberate non-zero
 * anchor, and are used as one.
 *
 * This file writes nothing and cleans up nothing, because it has nothing to write: all three routes
 * are reads.
 *
 * ## UI behaviour tests (M15, converted from admin/finance.spec.js)
 *
 * The third `test.describe` block carries the twelve tests that were previously in the mock-backed
 * `admin/finance.spec.js`. They assert browser behaviour — tile rendering, chart redraw, ledger
 * columns, client-side filters, CSV exports, and the transaction detail modal — against the real
 * API rather than the mock provider. The two tests that are justified as mock-only keepers (empty
 * subscription book, structural-zeros payouts panel) remain in `admin/finance.spec.js`.
 *
 * Fixtures: ACTORS.admin (9000000000), ACTORS.owner (9470744469).
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS } from '../fixtures/live.js';
import { trackErrors } from '../helpers/console.js';

/** Whole rupees out of a rendered `₹1,23,456` tile. Indian grouping, so commas are not every three. */
function rupeesFrom(text) {
  const digits = String(text).replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

/** The tile whose label is `label`, as a number. */
async function tileValue(page, label) {
  const card = page.locator('.pn-card').filter({ hasText: label }).first();
  await expect(card).toBeVisible();
  return rupeesFrom(await card.locator('.text-xl.font-extrabold').first().innerText());
}

/**
 * Sign in through `/staff-login` and land on the finance console.
 *
 * Two steps rather than one: `signIn`'s `screen` names a **sign-in form** (`consumer` / `staff`),
 * not a destination, so the console is reached by navigating afterwards.
 */
async function openFinance(page) {
  await signIn(page, ACTORS.admin, { screen: 'staff' });
  await page.goto('/admin/finance');
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
}

/** The eight KPI tiles across the top, in render order. */
const KPIS = [
  'MRR (subscriptions)',
  'Revenue this month',
  'Services revenue',
  'Featured revenue',
  'Revenue (12 mo)',
  'Rent-pay fees',
  'ARPU',
  'ARPPU',
];

/** Column headers of the settlement ledger, in order. */
const COLUMNS = ['ID', 'Date', 'Party', 'Type', 'Platform take', 'Status'];

/** The ledger's empty copy, from `AdminFinance.jsx` (`<Table empty="…">`). */
const EMPTY_TX = 'No transactions match.';

/** Open a themed custom `Select` by aria-label and choose an option. */
async function pickSelectOption(page, ariaLabel, optionText) {
  await page.locator(`[aria-label="${ariaLabel}"]`).click();
  const option = page.locator('.pn-dropdown__option', { hasText: optionText }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator('.pn-dropdown__option')).toHaveCount(0);
}

/** Text of one column across every ledger row. */
async function columnValues(page, nth) {
  return (await page.locator(`tbody tr td:nth-child(${nth})`).allTextContents()).map((t) => t.trim());
}

test.describe('admin finance API', () => {
  test('the overview reports the models the console draws', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const res = await request.get(`${API}/admin/finance`, { headers });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // The fields the port added. Asserted as present-and-numeric, because their *values* are
    // pinned by the backend suite against fixtures this database does not have.
    for (const field of ['mrr', 'monthRevenue', 'users', 'payingUsers', 'gstCollected',
      'pendingSettlement', 'revenue', 'payoutsDue']) {
      expect(typeof body[field], `${field} is a number`).toBe('number');
      expect(body[field], `${field} is not negative`).toBeGreaterThanOrEqual(0);
    }
    expect(Array.isArray(body.plans)).toBe(true);

    /* The structural zeros, still zero and still disclosed. This is the pair that must never drift:
       a figure that starts moving while its flag stays false is a silent claim that the platform
       grew a money path it did not grow. */
    expect(body.payoutsCompleted).toBe(0);
    expect(body.refunds).toBe(0);
    expect(body.payoutsMeasured).toBe(false);
    expect(body.refundsMeasured).toBe(false);
    expect(body.serviceOrdersCounted).toBe(false);

    // Everyone who paid has an account, so ARPU's denominator cannot be the smaller of the two.
    expect(body.users).toBeGreaterThan(0);
    expect(body.users).toBeGreaterThanOrEqual(body.payingUsers);

    // The book sums to the run rate. Two numbers printed on one card that do not add up cost more
    // trust than any single wrong figure.
    const booked = body.plans.reduce((sum, p) => sum + p.monthlyValue, 0);
    expect(booked).toBe(body.mrr);
  });

  test('the series returns every month in the window, ending with this one', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const res = await request.get(`${API}/admin/finance/series?months=6`, { headers });
    expect(res.status()).toBe(200);
    const points = await res.json();

    expect(points).toHaveLength(6);

    const months = points.map((p) => p.month);
    expect(months, 'oldest first').toEqual([...months].sort());

    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    /* Compared to the year-month only. The server cuts the window on the Indian calendar and this
       assertion runs on the host's, so pinning the exact day would make the test fail for five and
       a half hours around every month boundary — which is a real difference, but not this test's. */
    expect(months[months.length - 1].slice(0, 7)).toBe(expected);

    for (const p of points) {
      // The services band is carried and structurally zero — a measurement, not a missing field.
      expect(p.services, `${p.month} services`).toBe(0);
      for (const band of ['rent', 'subscriptions', 'featured']) {
        expect(typeof p[band]).toBe('number');
        expect(p[band]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('the series and the overview agree about this month', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const [overview, series] = await Promise.all([
      request.get(`${API}/admin/finance`, { headers }).then((r) => r.json()),
      request.get(`${API}/admin/finance/series?months=1`, { headers }).then((r) => r.json()),
    ]);

    const banded = series[0].rent + series[0].subscriptions + series[0].featured + series[0].services;
    /* Two independently written queries over the same three sources. Nothing but an assertion that
       fetches both and compares them can catch them drifting apart. */
    expect(banded).toBe(overview.monthRevenue);
  });

  test('the ledger carries the platform take, never the gross rent', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const res = await request.get(`${API}/admin/finance/transactions?kind=rent_fee&size=100`, { headers });
    expect(res.status()).toBe(200);
    const page = await res.json();

    /* The floor. The seed has rent payments; a scan that found none would make every assertion
       below vacuously true, which is the failure this line exists to prevent. */
    expect(page.content.length, 'the seed has rent payments to measure').toBeGreaterThan(0);
    expect(page.totalElements).toBeGreaterThanOrEqual(page.content.length);

    for (const row of page.content) {
      expect(row.kind).toBe('rent_fee');
      expect(['paid', 'pending', 'failed']).toContain(row.status);
      // Never negative: there is no refund path, so a negative amount could only be a fabrication.
      expect(row.amount).toBeGreaterThanOrEqual(0);
      // A name, never a number. `/admin/enquiries` is where a contact detail is revealed, audited.
      expect(row.party).not.toMatch(/(?<!\d)[6-9]\d{9}(?!\d)/);
    }

    /* The fee is a small fraction of a Pune rent. Asserting an upper bound is what distinguishes
       "the query selected platform_fee" from "the query selected amount" — the two differ by two
       orders of magnitude and both are plausible-looking money. */
    const largest = Math.max(...page.content.map((r) => r.amount));
    expect(largest, 'a convenience fee, not a month of rent').toBeLessThan(10_000);
  });

  test('the ledger refuses a vocabulary it cannot match, and accepts the one it speaks', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });

    // `closed` was the mock's word for settled; `refunded` names a state no row can hold.
    for (const bad of ['closed', 'refunded']) {
      const res = await request.get(`${API}/admin/finance/transactions?status=${bad}`, { headers });
      expect(res.status(), `status=${bad} is refused, not answered with an empty page`).toBe(400);
    }
    const badWindow = await request.get(`${API}/admin/finance/series?months=61`, { headers });
    expect(badWindow.status()).toBe(400);

    // The acceptance half — without it, "refuses everything" would pass.
    for (const good of ['paid', 'pending', 'failed']) {
      const res = await request.get(`${API}/admin/finance/transactions?status=${good}`, { headers });
      expect(res.status(), `status=${good} is accepted`).toBe(200);
    }
  });

  test('all three reads are admin-only', async ({ request }) => {
    const headers = await authHeaders(ACTORS.owner, { request });
    for (const route of ['/admin/finance', '/admin/finance/series', '/admin/finance/transactions']) {
      const res = await request.get(`${API}${route}`, { headers });
      expect([401, 403], `${route} is closed to an owner`).toContain(res.status());
    }
  });
});

test.describe('the finance console renders what the API returned', () => {
  /**
   * The assertion the whole slice exists for.
   *
   * The old screen's figures were internally consistent and entirely invented, so only fetching
   * both sides and comparing them can tell the two situations apart.
   */
  test('the MRR and rent-fee tiles equal the API, to the rupee', async ({ page, request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const [overview, series] = await Promise.all([
      request.get(`${API}/admin/finance`, { headers }).then((r) => r.json()),
      request.get(`${API}/admin/finance/series?months=24`, { headers }).then((r) => r.json()),
    ]);
    const thisMonth = series[series.length - 1];

    await openFinance(page);

    expect(await tileValue(page, 'MRR (subscriptions)')).toBe(overview.mrr);
    expect(await tileValue(page, 'Revenue this month')).toBe(overview.monthRevenue);
    expect(await tileValue(page, 'Rent-pay fees')).toBe(thisMonth.rent);
    expect(await tileValue(page, 'Featured revenue')).toBe(thisMonth.featured);
    // Zero and disclosed, on the screen as on the wire.
    expect(await tileValue(page, 'Services revenue')).toBe(0);
  });

  test('the ledger on screen is the ledger from the API', async ({ page, request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const ledger = await request
      .get(`${API}/admin/finance/transactions?size=100`, { headers })
      .then((r) => r.json());
    expect(ledger.content.length, 'the floor').toBeGreaterThan(0);

    await openFinance(page);
    await expect(page.getByText('Recent transactions')).toBeVisible();

    const first = ledger.content[0];
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    // The newest row the API returned is the first row the table draws — the ordering is the
    // server's, and a console that re-sorted locally would quietly disagree with its own pager.
    await expect(table.locator('tbody tr').first()).toContainText(first.party);
  });

  /**
   * The ceiling, and the fact that it is now audible (D251).
   *
   * The console asks for one page of 100 rows and then runs its search, both dropdowns, its pager
   * and its CSV export over that page as though it were the ledger. That is exactly right while the
   * ledger is shorter than the ceiling and quietly wrong the moment it is not — "Failed" comes to
   * mean "failed, among the most recent hundred" without ever saying so.
   *
   * The seed is four rows deep, so this failure cannot be reached by adding data; it has to be
   * staged. The intercept changes exactly one number — `totalElements`, the field that reports how
   * many rows exist beyond the ones attached. The rows themselves are still the server's, so the
   * screen renders real data and only the count is a fiction.
   *
   * Both halves are deliberate. "No warning was logged" passes against a console that never loaded,
   * so the quiet half asserts the table drew first; and without the loud half, deleting
   * `warnIfTruncated` outright would leave the quiet half green forever.
   */
  test('a ledger longer than the page it fetched says so out loud', async ({ page }) => {
    const TRUNCATION = /^\[finance\] \d+ transactions exist but only \d+ were fetched/;
    const warnings = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });

    // Quiet half, on the seed as it stands: fewer rows than the ceiling, so there is nothing to say.
    await openFinance(page);
    await expect(page.getByText('Recent transactions')).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    expect(
      warnings.filter((w) => TRUNCATION.test(w)),
      'a ledger that fits inside the ceiling is silent',
    ).toEqual([]);

    // Loud half: the same rows, reported as the first few of many.
    await page.route('**/admin/finance/transactions*', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({
        response: res,
        json: { ...body, totalElements: (body.content?.length ?? 0) + 250 },
      });
    });

    warnings.length = 0;
    await page.goto('/admin/finance');
    await expect(page.getByRole('table')).toBeVisible();
    await expect
      .poll(() => warnings.filter((w) => TRUNCATION.test(w)).length, {
        message: 'the ceiling is announced once the ledger is longer than it',
      })
      .toBeGreaterThan(0);
  });

  test('the disclosures the server sets are the disclosures the screen shows', async ({ page, request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const overview = await request.get(`${API}/admin/finance`, { headers }).then((r) => r.json());

    await openFinance(page);
    const panel = page.locator('[data-testid="finance-disclosures"]');

    /* Driven off the payload rather than hardcoded to "three disclosures are showing". If the
       deployment flips `punenest.finance.payouts-measured`, this test follows it instead of
       failing — which is what makes it a test of the wiring rather than of the config. */
    await expect(panel).toBeVisible();
    for (const [flag, phrase] of [
      [overview.payoutsMeasured, /no payout has ever been executed/i],
      [overview.refundsMeasured, /no refund path/i],
      [overview.serviceOrdersCounted, /excludes the services marketplace/i],
    ]) {
      if (flag) await expect(panel).not.toContainText(phrase);
      else await expect(panel).toContainText(phrase);
    }
  });
});

// ─── UI behaviour (converted from mock admin/finance.spec.js, M15) ───

test.describe('finance console UI behaviour', () => {
  test('finance page loads without JS errors', async ({ page }) => {
    const errors = trackErrors(page);
    await openFinance(page);
    await expect(page.getByText(KPIS[0])).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('finance shows all eight KPI tiles with INR values', async ({ page }) => {
    await openFinance(page);
    await expect(page.getByText(KPIS[0])).toBeVisible();

    for (const label of KPIS) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    const values = page.locator('.pn-card .text-xl.font-extrabold');
    const count = await values.count();
    expect(count).toBe(KPIS.length);
    for (let i = 0; i < count; i++) {
      await expect(values.nth(i)).toContainText('\u20B9');
    }
  });

  test('finance header exports a revenue CSV', async ({ page }) => {
    await openFinance(page);
    await expect(page.getByText(KPIS[0])).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Revenue CSV/i }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
  });

  test('Deal Pipeline card links through to enquiries', async ({ page }) => {
    await openFinance(page);
    await expect(page.getByText('Deal Pipeline')).toBeVisible();
    await expect(page.getByRole('link', { name: /View all deals/i })).toHaveAttribute('href', /enquiries/);
  });

  test('revenue charts render and the window selector redraws them cleanly', async ({ page }) => {
    const errors = trackErrors(page);
    await openFinance(page);
    await expect(page.getByText(KPIS[0])).toBeVisible();
    await expect(page.getByText('Revenue by month')).toBeVisible();
    await expect(page.getByText('Revenue mix (this month)')).toBeVisible();
    const chart = page.locator('.pn-card', { has: page.getByText('Revenue by month') }).locator('canvas');
    await expect(chart).toBeVisible();
    const before = await chart.evaluate((canvas) => canvas.toDataURL());

    await pickSelectOption(page, 'Revenue window', '6 months');
    await expect(page.locator('[aria-label="Revenue window"]')).toContainText('6 months');
    await expect.poll(() => chart.evaluate((canvas) => canvas.toDataURL())).not.toBe(before);
    expect(errors).toHaveLength(0);
  });

  // ─── Settlement ledger ───

  test('ledger renders rows with the expected columns', async ({ page }) => {
    await openFinance(page);
    await expect(page.getByText('Recent transactions')).toBeVisible();
    for (const header of COLUMNS) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
    }
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.locator('tbody .rounded-full').first()).toBeVisible();
  });

  test('the ledger offers only the settlement vocabulary a row can hold', async ({ page }) => {
    await openFinance(page);
    await expect(page.locator('tbody tr').first()).toBeVisible();

    await page.locator('[aria-label="Filter by status"]').click();
    const options = page.locator('.pn-dropdown__option');
    await expect(options.first()).toBeVisible();
    const labels = (await options.allTextContents()).map((s) => s.trim());

    /* `refunded` would advertise a state no row can hold while the platform has no refund path, and
       `closed` was the mock's own word. The live API refuses both with 400, pinned by the API tests
       above. */
    expect(labels).toEqual(['All statuses', 'Paid', 'Pending', 'Failed']);
  });

  test('searching by party keeps only matching rows', async ({ page }) => {
    await openFinance(page);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const before = await columnValues(page, 3);
    const term = before[0].split(' ')[0];
    expect(term.length).toBeGreaterThan(0);

    await page.getByPlaceholder('Search party or type…').fill(term);

    await expect(page.getByText(EMPTY_TX)).toHaveCount(0);
    const after = await columnValues(page, 3);
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThanOrEqual(before.length);
    for (const party of after) {
      expect(party.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  test('an unmatchable search shows the empty state', async ({ page }) => {
    await openFinance(page);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByPlaceholder('Search party or type…').fill('zzzz-no-such-party-zzzz');

    const table = page.getByRole('table');
    await expect(table.getByText(EMPTY_TX)).toBeVisible();
    await expect(table.locator('tbody tr td:nth-child(2)')).toHaveCount(0);
  });

  test('filtering by type keeps only rows of that type', async ({ page }) => {
    await openFinance(page);
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

  test('the ledger exports a CSV', async ({ page }) => {
    await openFinance(page);
    await expect(page.getByText('Recent transactions')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')].filter((b) => /CSV/i.test(b.textContent));
      buttons[buttons.length - 1]?.click();
    });
    expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
  });

  // ─── Transaction detail modal ───

  test('opening a transaction shows every field and closes on Escape', async ({ page }) => {
    await openFinance(page);
    await expect(page.getByText('Recent transactions')).toBeVisible();
    const rows = page.locator('tbody tr button');
    expect(await rows.count()).toBeGreaterThan(0);

    await page.evaluate(() => { document.querySelector('tbody tr button')?.click(); });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/Transaction ·/)).toBeVisible();
    for (const label of [...COLUMNS, 'Method']) {
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

