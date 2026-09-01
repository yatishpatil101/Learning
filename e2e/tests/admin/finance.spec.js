/* /admin/finance — KPI tiles, revenue charts, the MRR panels and the settlement ledger.
 *
 * ## What this spec can and cannot prove (D235)
 *
 * The page now reads `services/financeService.js`, so under this config it exercises the **mock**
 * finance provider. That provider is deliberately sparse: the mock store has no subscription and no
 * rent-payment collection, so the only revenue source it can evidence is featured listings, and MRR,
 * rent fees and the plan book are all honestly zero offline.
 *
 * So this file asserts **behaviour** — that tiles render, that filters filter, that the two CSV
 * exports fire, that the detail modal opens — and it deliberately does not assert magnitudes. The
 * claim "these numbers came from a server" is `live-admin-finance.spec.js`'s to make, and only it
 * can make it. Writing a magnitude assertion here would pin the mock's arithmetic, which is exactly
 * the mistake D233 records: a test that asserts the shape of a value something else is the authority
 * on stops being a check and becomes a competing specification.
 *
 * ## Bucket: keep, justified (D251)
 *
 * Re-examined under the "mock gone everywhere it is used" policy rather than inherited, and kept —
 * because every claim left in this file is a claim about the browser. Eight tiles render and each
 * carries a `₹`; both CSV exports fire; the detail modal opens and closes on Escape; the Deal
 * Pipeline card links through to enquiries; the chart redraws when the window changes. Even the
 * three ledger controls are client-side in the strict sense: `AdminFinance`'s `txRows` memo filters
 * rows already in hand and sends nothing to anyone, which is the whole substance of D251.
 *
 * `AdminFinance.jsx` imports no mock module — it is fully on the service seam — so the screen these
 * tests drive is the screen live drives. The provider underneath differs; the component does not.
 *
 * Two assertions are *better* here than live. The empty plan book (`'No active paid plans.'`) needs
 * a finance payload with no subscriptions and the live seed carries one, so only the mock can reach
 * that state at all. The payouts panel's assertion is a regression guard against an invented 65/35
 * split returning, and an absence is cheapest to hold where the data cannot accidentally supply it.
 *
 * Everything here that would be a claim about the server lives in `e2e/tests/live-admin-finance.spec.js`
 * instead: that the tiles equal the API to the rupee, that the ledger on screen is the ledger from
 * the API, that the endpoint accepts `paid|pending|failed` and refuses `closed|refunded`, that all
 * three reads are admin-only, and that the ledger announces its own ceiling. That file is the
 * authority and this one does not duplicate it.
 *
 * ## What changed from the previous version of this file
 *
 * Four assertions were removed because the things they asserted are gone, not because they were
 * failing:
 *
 * - `'Partner payouts (65%)'` and `'Platform commission (35%)'` — the split was invented. There is
 *   no payout ledger and no partner agreement; the rows now read the server's structural zeros.
 * - `'Owner plan'` / `'Seeker plan'` — those two rows were produced by dividing a fabricated MRR by
 *   a price. The panel now lists the real subscription book, which is empty offline.
 * - The `'refunded'` and `'closed'` status filter options — `closed` was the mock's word for
 *   settled and `refunded` names a state no row can hold while the platform has no refund path.
 *
 * The eighth KPI tile (ARPPU) is new: ARPU alone, unqualified, invited the reader to assume it was
 * per *paying* user.
 */
import { test, expect } from '../../fixtures/base.js';

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

async function openFinance(page, login) {
  await login.asAdmin();
  await page.goto('/admin/finance');
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
  /* The whole page is gated on the overview read resolving (`if (!settings || !finance)`), so the
     first tile appearing is the honest "the seam answered" signal — and it is an assertion on the
     data path rather than on a paint. */
  await expect(page.getByText(KPIS[0])).toBeVisible();
}

/** Open a themed custom `Select` by aria-label and choose an option. The component is not a native
 *  `<select>`, so `selectOption` does not apply. */
async function pickSelectOption(page, ariaLabel, optionText) {
  await page.locator(`[aria-label="${ariaLabel}"]`).click();
  const option = page.locator('.pn-dropdown__option', { hasText: optionText }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator('.pn-dropdown__option')).toHaveCount(0);
}

/** Text of one column across every ledger row. Used to assert what a filter left behind. */
async function columnValues(page, nth) {
  return (await page.locator(`tbody tr td:nth-child(${nth})`).allTextContents()).map((t) => t.trim());
}

// ─── Page load, KPIs and header actions ───

test('finance page loads without JS errors', async ({ page, login, consoleErrors }) => {
  await openFinance(page, login);
  // Anchored by openFinance: an empty error list proves nothing if the page never rendered.
  expect(consoleErrors).toHaveLength(0);
});

test('finance shows all eight KPI tiles with INR values', async ({ page, login }) => {
  await openFinance(page, login);
  for (const label of KPIS) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  const values = page.locator('.pn-card .text-xl.font-extrabold');
  const count = await values.count();
  /* Assert the count, not a list of names. A stale count is stale in the direction that cannot
     fail: "all the tiles I listed are present" stays green while a ninth tile goes untested. */
  expect(count).toBe(KPIS.length);
  for (let i = 0; i < count; i++) {
    // Every tile on this page is money, so every tile carries the symbol. A tile that lost its
    // formatter and printed a bare number is the regression this catches.
    await expect(values.nth(i)).toContainText('\u20B9');
  }
});

test('finance header exports a revenue CSV', async ({ page, login }) => {
  await openFinance(page, login);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Revenue CSV/i }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
});

test('Deal Pipeline card links through to enquiries', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.getByText('Deal Pipeline')).toBeVisible();
  await expect(page.getByRole('link', { name: /View all deals/i })).toHaveAttribute('href', /enquiries/);
});

// ─── Charts ───

test('revenue charts render and the window selector redraws them cleanly', async ({ page, login, consoleErrors }) => {
  await openFinance(page, login);
  await expect(page.getByText('Revenue by month')).toBeVisible();
  await expect(page.getByText('Revenue mix (this month)')).toBeVisible();

  await pickSelectOption(page, 'Revenue window', '6 months');
  await expect(page.locator('[aria-label="Revenue window"]')).toContainText('6 months');
  await expect(page.getByText('Revenue by month')).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

// ─── MRR and net-position panels ───

test('the subscription book is listed rather than modelled', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.getByText('MRR growth')).toBeVisible();
  await expect(page.getByText('MRR total')).toBeVisible();

  /* Offline there are no subscription records, so the panel must say so rather than invent a
     subscriber count — which is precisely what the two rows this replaces used to do. Asserting
     the empty state *and* the absence of the old modelled rows, because the presence of the empty
     copy alone would also pass against a panel that rendered both. */
  await expect(page.getByText('No active paid plans.')).toBeVisible();
  await expect(page.getByText('Owner plan', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Seeker plan', { exact: true })).toHaveCount(0);
});

test('the payouts panel reports structural zeros instead of an invented split', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.getByText('Gross revenue')).toBeVisible();
  await expect(page.getByText('Net retained')).toBeVisible();
  await expect(page.getByText('Payouts & outstanding')).toBeVisible();
  await expect(page.getByText('Rent held for landlords')).toBeVisible();

  /* The negative half, and the reason this test exists: the 65/35 split was a fabrication over a
     fabrication. Asserting its absence is what stops it being reintroduced as a "nice to have". */
  await expect(page.getByText(/Partner payouts \(65%\)/)).toHaveCount(0);
  await expect(page.getByText(/Platform commission \(35%\)/)).toHaveCount(0);

  // And the positive anchor: the rows that replaced it are marked as unmeasured, not printed bare.
  await expect(page.getByText('Partner payouts made')).toBeVisible();
  await expect(page.getByText(/Not measured/i).first()).toBeVisible();
});

// ─── Settlement ledger ───

test('ledger renders rows with the expected columns', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.getByText('Recent transactions')).toBeVisible();
  for (const header of COLUMNS) {
    await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
  }
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  // Every row carries a status pill; the ledger is useless without one.
  await expect(page.locator('tbody .rounded-full').first()).toBeVisible();
});

test('the ledger offers only the settlement vocabulary a row can hold', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.locator('tbody tr').first()).toBeVisible();

  await page.locator('[aria-label="Filter by status"]').click();
  const options = page.locator('.pn-dropdown__option');
  await expect(options.first()).toBeVisible();
  const labels = (await options.allTextContents()).map((s) => s.trim());

  /* `refunded` would advertise a state no row can hold while the platform has no refund path, and
     `closed` was the mock's own word.

     Corrected (D251), along with this test's title. The comment used to continue "Both would answer
     400 on the live API, so a console that still offered them would be shipping a filter that cannot
     succeed", and the endpoint does answer 400 — `live-admin-finance.spec.js` pins exactly that. But
     this control never reaches the endpoint: the selection feeds a `rows.filter` in `AdminFinance`'s
     `txRows` memo and is never sent to anyone. A bogus option would therefore not have failed at
     all; it would have drawn a confidently empty ledger, which is why the right three values still
     matter and why the reason is that they are the only three a row holds. */
  expect(labels).toEqual(['All statuses', 'Paid', 'Pending', 'Failed']);
});

test('searching by party keeps only matching rows', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const before = await columnValues(page, 3);
  const term = before[0].split(' ')[0];
  expect(term.length).toBeGreaterThan(0);

  await page.getByPlaceholder('Search party or type…').fill(term);

  // The result is a subset, it is not empty (the term came from a row that exists), and every
  // survivor matches. A filter that ignored its input, or dropped every row, fails all three.
  await expect(page.getByText(EMPTY_TX)).toHaveCount(0);
  const after = await columnValues(page, 3);
  expect(after.length).toBeGreaterThan(0);
  expect(after.length).toBeLessThanOrEqual(before.length);
  for (const party of after) {
    expect(party.toLowerCase()).toContain(term.toLowerCase());
  }
});

test('an unmatchable search shows the empty state', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByPlaceholder('Search party or type…').fill('zzzz-no-such-party-zzzz');

  /* `Table` renders the same data twice — a desktop <table> and a mobile card list — so the empty
     copy exists in two places at once and an unscoped `getByText` is a strict-mode violation rather
     than an assertion. Scoping to the table also makes the row count meaningful: the empty state is
     itself a <tr> (one cell, colspan=7), so `tbody tr` is 1 here and never 0. What actually
     distinguishes empty from populated is the absence of a data row, and a data row is one with
     more than a single cell. */
  const table = page.getByRole('table');
  await expect(table.getByText(EMPTY_TX)).toBeVisible();
  await expect(table.locator('tbody tr td:nth-child(2)')).toHaveCount(0);
});

test('filtering by type keeps only rows of that type', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const before = await columnValues(page, 4);
  // Take the filter value from the data rather than hardcoding one, so the test does not need
  // updating when the seed's transaction mix changes.
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

test('the ledger exports a CSV', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.getByText('Recent transactions')).toBeVisible();
  const download = page.waitForEvent('download');
  // The ledger's own export is the last CSV button on a long page; a JS click avoids the sticky
  // header intercepting a scrolled-into-view click.
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter((b) => /CSV/i.test(b.textContent));
    buttons[buttons.length - 1]?.click();
  });
  expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
});

// ─── Transaction detail modal ───

test('opening a transaction shows every field and closes on Escape', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.getByText('Recent transactions')).toBeVisible();
  // No `if (count > 0)`. The fixture has transactions; a ledger with no rows is a failure, and a
  // conditional wrapper would turn that failure into a silent pass.
  const rows = page.locator('tbody tr button');
  expect(await rows.count()).toBeGreaterThan(0);

  await page.evaluate(() => { document.querySelector('tbody tr button')?.click(); });

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/Transaction ·/)).toBeVisible();
  /* `exact`, and it is load-bearing. Playwright's substring matching is case-insensitive, so a
     loose `getByText('ID')` also matches the *value* "paid" — which it did the moment the status
     vocabulary changed from the mock's `closed` to the server's `paid`, turning this assertion into
     a strict-mode violation. The labels are the `<dt>` texts and nothing else, so pin them whole. */
  for (const label of [...COLUMNS, 'Method']) {
    await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

