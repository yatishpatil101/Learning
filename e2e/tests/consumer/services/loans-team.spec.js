import { expect, test, STAFF } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

const PAGE = '/home-loans';

const LOAN_TYPE = 'Home Purchase Loan';

async function pickOption(page, field, label) {
  await page.locator(`[data-err="${field}"] .dz-dropdown__trigger`).click();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function deskQueue(team, mobile) {
  const res = await fetch(`${API}/tickets?team=${team}&size=100`, { headers: await authHeaders(mobile) });
  expect(res.status, `the ${team} desk is readable by its own staff`).toBe(200);
  const body = await res.json();
  return body?.content || [];
}

const idsOf = (rows) => new Set(rows.map((r) => r.id));

test.describe('home loans routing, live', () => {
  test('a home-loan enquiry is filed against the Loans desk, and never reaches legal', async ({ page }) => {
    const loansDesk = await apiLogin(STAFF.loans);
    const legalDesk = await apiLogin(STAFF.legal);
    expect(loansDesk.accessToken).toBeTruthy();
    expect(legalDesk.accessToken).toBeTruthy();

    const loansBefore = idsOf(await deskQueue('loans', STAFF.loans));
    const legalBefore = idsOf(await deskQueue('legal', STAFF.legal));

    const customer = await signedInAsNew(page);
    expect(customer, 'a fresh account was registered for this submit').toBeTruthy();
    await page.goto(PAGE);

    await pickOption(page, 'loanType', LOAN_TYPE);
    await page.locator('[data-err="amount"] input').fill('5000000');
    await page.locator('input[data-err="name"]').fill('Loans Routing Probe');

    const filed = page.waitForResponse(
      (r) => r.url().includes('/api/tickets') && r.request().method() === 'POST',
      { timeout: 15000 },
    );

    await page.getByRole('button', { name: 'Get Loan Offers' }).click();

    const response = await filed;
    expect(response.status(), 'the server accepted the enquiry').toBeLessThan(300);

    await expect(page.getByRole('heading', { name: 'Request received!' })).toBeVisible({ timeout: 15000 });

    const arrivedOnLoans = (await deskQueue('loans', STAFF.loans)).filter((t) => !loansBefore.has(t.id));
    expect(arrivedOnLoans, 'the enquiry reached the loans desk').toHaveLength(1);
    expect(arrivedOnLoans[0].team).toBe('loans');

    expect(arrivedOnLoans[0].subject).toBe(LOAN_TYPE);

    const arrivedOnLegal = (await deskQueue('legal', STAFF.legal)).filter((t) => !legalBefore.has(t.id));
    expect(arrivedOnLegal, 'the finance vertical is not folded back into Property & Legal').toHaveLength(0);
  });
});
