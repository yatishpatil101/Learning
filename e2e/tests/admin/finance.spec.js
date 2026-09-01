/* /admin/finance — KPI tiles, revenue charts, the MRR panels and the transactions ledger.
 *
 * ## What changed and why
 *
 * Mechanically: the shared `login` fixture replaces a private `loginAsAdmin`, relative paths
 * replace a hardcoded `http://localhost:5173` (which ignored `BASE_URL`), and **twenty-seven**
 * `waitForTimeout` calls are gone. Every one of them was standing in for an assertion that the
 * thing being waited for had appeared — which is both faster and the assertion the test wanted.
 *
 * Substantively, this file had a specific and repeated defect: **conditional assertions**.
 *
 * - Both transaction-modal tests were wrapped in `if (count > 0)`. A page that rendered no rows —
 *   a broken ledger, the exact regression worth catching — skipped the entire body and passed.
 * - The three filter tests each computed `hasRows` and then asserted *either* that rows matched
 *   *or* that the empty state was showing. That disjunction is a tautology: one of the two is
 *   always true. A filter that ignored its input passed; a filter that dropped every row passed.
 *
 * The fixture is deterministic seed data, so there is no reason to hedge. Rows exist, and a filter
 * is now asserted the only way that means anything: **every surviving row matches it**, and the
 * count does not grow.
 *
 * Two CSV buttons were clicked with a trailing comment saying "no JS errors after click" and
 * nothing checking that. Both now wait for the download.
 *
 * ## Why this is not a live spec
 *
 * `AdminFinance.jsx` imports from `lib/mockApi.js` and reads nothing from the API. Running this
 * under `playwright.live.config.js` would execute the same localStorage-backed page under a name
 * claiming otherwise. Recorded in tasks/todo.md; the blocker is the page, not the spec.
 */
import { test, expect } from '../../fixtures/base.js';

/** The seven KPI tiles across the top, in render order. */
const KPIS = [
  'MRR (subscriptions)',
  'Revenue this month',
  'Services revenue',
  'Featured revenue',
  'Revenue (12 mo)',
  'Rent-pay fees',
  'ARPU',
];

/** Column headers of the transactions ledger, in order. */
const COLUMNS = ['ID', 'Date', 'Party', 'Type', 'Amount', 'Status'];

/** The ledger's empty copy, from `AdminFinance.jsx:381` (`<Table empty="…">`). */
const EMPTY_TX = 'No transactions match.';

async function openFinance(page, login) {
  await login.asAdmin();
  await page.goto('/admin/finance');
  // The KPI row only renders once settings resolve, so waiting on the first tile is the honest
  // "page is ready" signal — and replaces the `waitForTimeout(500)` that used to precede everything.
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
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

test('finance shows all seven KPI tiles with INR values and MoM deltas', async ({ page, login }) => {
  await openFinance(page, login);
  for (const label of KPIS) {
    await expect(page.getByText(label)).toBeVisible();
  }
  const values = page.locator('.pn-card .text-xl.font-extrabold');
  const count = await values.count();
  expect(count).toBeGreaterThanOrEqual(KPIS.length);
  for (let i = 0; i < count; i++) {
    // Every tile on this page is money, so every tile carries the symbol. A tile that lost its
    // formatter and printed a bare number is the regression this catches.
    await expect(values.nth(i)).toContainText('\u20B9');
  }
  await expect(page.getByText(/MoM/).first()).toBeVisible();
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
  // The chart survives the range change and the selector shows the new range. The original only
  // checked the console was quiet, which a selector that ignored the click also satisfies.
  await expect(page.locator('[aria-label="Revenue window"]')).toContainText('6 months');
  await expect(page.getByText('Revenue by month')).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

// ─── MRR and net-position panels ───

test('MRR panels show plan rows, totals and the growth chart', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.getByText('MRR growth')).toBeVisible();
  await expect(page.getByText('Owner plan')).toBeVisible();
  await expect(page.getByText('Seeker plan')).toBeVisible();
  await expect(page.getByText('MRR total')).toBeVisible();
});

test('net position and payout split are shown', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.getByText('Gross revenue')).toBeVisible();
  await expect(page.getByText('Net retained')).toBeVisible();
  await expect(page.getByText('Payouts & outstanding')).toBeVisible();
  // The two halves are asserted together because they are a split: 65 + 35. A page showing one
  // without the other is telling half a story.
  await expect(page.getByText('Partner payouts (65%)')).toBeVisible();
  await expect(page.getByText('Platform commission (35%)')).toBeVisible();
});

// ─── Transactions ledger ───

test('transactions ledger renders rows with the expected columns', async ({ page, login }) => {
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

test('searching by party keeps only matching rows', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const before = await columnValues(page, 3);
  const term = before[0].split(' ')[0];
  expect(term.length).toBeGreaterThan(0);

  await page.getByPlaceholder('Search party or type…').fill(term);

  // The real contract, and what the original disjunction could not express: the result is a subset,
  // it is not empty (the term came from a row that exists), and every survivor matches.
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
  // The other half of the pair the original collapsed into a tautology: the empty state is asserted
  // where it is actually expected, not as an alternative to the filter working.
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

test('filtering by status keeps only rows of that status', async ({ page, login }) => {
  await openFinance(page, login);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const before = await columnValues(page, 6);
  const status = before.find(Boolean);
  expect(status).toBeTruthy();

  await pickSelectOption(page, 'Filter by status', status);

  const after = await columnValues(page, 6);
  expect(after.length).toBeGreaterThan(0);
  expect(after.length).toBeLessThanOrEqual(before.length);
  for (const value of after) {
    expect(value.toLowerCase()).toContain(status.toLowerCase());
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
  // No `if (count > 0)`. The fixture has transactions; a ledger with no rows is a failure, and the
  // original wrapper turned that failure into a silent pass.
  const rows = page.locator('tbody tr button');
  expect(await rows.count()).toBeGreaterThan(0);

  await page.evaluate(() => { document.querySelector('tbody tr button')?.click(); });

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/Transaction ·/)).toBeVisible();
  for (const label of [...COLUMNS, 'Method']) {
    await expect(dialog.getByText(label)).toBeVisible();
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
