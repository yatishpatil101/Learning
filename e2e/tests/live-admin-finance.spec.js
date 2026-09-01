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
 * The seed carries three rent payments, **no** subscriptions and **no** boosts. Asserting "MRR is
 * ₹0" would therefore pass whether or not the query works, which is a green record of nothing. The
 * rent fees are the one non-zero anchor, and they are used as one.
 *
 * This file writes nothing and cleans up nothing, because it has nothing to write: all three routes
 * are reads.
 *
 * Fixtures: ACTORS.admin (9000000000), ACTORS.owner (9470744469).
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS } from '../fixtures/live.js';

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

