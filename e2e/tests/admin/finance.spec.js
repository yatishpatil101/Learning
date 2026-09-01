/* /admin/finance — mock-only keeper tests (D251, M15).
 *
 * ## What remains and why
 *
 * Two tests that are *better* under the mock provider than live, because they need a data state the
 * live seed cannot reach:
 *
 * 1. **Empty subscription book** — the live seed carries an active subscription (the duplicate-guard
 *    fixture's Owner Plus), so only the mock can evidence the `'No active paid plans.'` empty state
 *    and prove the old modelled `Owner plan` / `Seeker plan` rows are gone.
 *
 * 2. **Structural-zeros payouts panel** — a regression guard against the invented 65/35 split. An
 *    absence assertion is cheapest where the data cannot accidentally supply the absent value.
 *
 * Everything else — tile rendering, CSV exports, chart redraws, ledger columns and filters, the
 * detail modal — was converted to `live-admin-finance.spec.js` (M15) and exercises the same
 * component against the real API instead of the mock provider.
 *
 * ## Verdict: HONOURED (2 tests)
 *
 * Both tests assert data states the live seed cannot reach. The live database carries an active
 * subscription, so the empty subscription book is unreachable; and the structural-zeros panel's
 * absence assertion is cheapest where the data cannot accidentally supply the absent value. Live
 * coverage proves the component renders what the API sends; it cannot prove what the component
 * does when the API sends nothing.
 */
import { test, expect } from '../../fixtures/base.js';

/** The eight KPI tiles across the top, in render order — only the first is used as a load signal. */
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

async function openFinance(page, login) {
  await login.asAdmin();
  await page.goto('/admin/finance');
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
  await expect(page.getByText(KPIS[0])).toBeVisible();
}

// ─── MRR and net-position panels (mock-only keepers) ───

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

