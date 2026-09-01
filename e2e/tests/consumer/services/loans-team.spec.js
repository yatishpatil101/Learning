// @ts-check
import { test, expect } from '@playwright/test';

/*
 * Home Loans routes to its own "Loans" team — not "Property & Legal".
 * Proves the dedicated finance vertical is created with team=loans and is labelled
 * as a loans request, from the consumer side, in the store the mock build writes.
 *
 * Tech-debt D29 recorded this as failing under its pre-reorg path
 * `e2e/tests/services-loans-team.spec.js`. That path was deleted by the same
 * commit that wrote the note (57c3b68), which is also the commit that removed a
 * byte-identical duplicate of this test — the two copies ran concurrently in one
 * suite. The surviving copy passes; the two robustness fixes below remove the
 * only load-bearing fragility that survived the move. No assertion was relaxed.
 *
 * ## Why the admin half of this test is gone
 *
 * It used to continue into `/admin/services`, search for the ticket, press Start,
 * and read the assign dropdown. That console is now **live-only**: `ticket` has no
 * mock provider by deliberate decision (D184, and `AdminServices.jsx:281`), because
 * the mock store knows three ticket statuses where the server knows five. In a mock
 * build the page renders a notice saying so, so the search box the test typed into
 * does not exist and never will.
 *
 * The assertions were not dropped — they moved to where they can run.
 * `live-admin-services.spec.js` covers the queue, the team label, Start, and the
 * assignee directory against the API, which is the only place any of it is true.
 * What stays here is the half this build can still answer: that a home-loan request
 * is created against the `loans` team rather than being folded into legal.
 *
 * Keeping the admin half as a permanently-red test would have been worse than
 * useless. A suite with a standing failure trains everyone reading it to skip that
 * line, which is how the next real regression gets skipped too.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const BUYER = { name: 'Yatish Test', mobile: '9888888888', email: '', role: 'buyer', joinedAt: Date.now() };

async function login(page, user) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
  }, user);
}

test('a home loan request is created against the dedicated Loans team, not legal', async ({ page }) => {
  await login(page, BUYER);
  // `domcontentloaded`, not `networkidle`: against the Vite dev server the module
  // graph is compiled on demand, so under parallel workers the network never goes
  // quiet for 500ms and the navigation times out for reasons unrelated to loans.
  // Everything after this point auto-waits or polls, so nothing races.
  await page.goto(`${BASE}/home-loans`, { waitUntil: 'domcontentloaded' });

  await page.locator('.pn-dropdown__trigger').first().click();
  await page.getByRole('option', { name: 'Home Purchase Loan' }).click();
  await page.locator('input[type="text"][inputmode="numeric"]').first().fill('5000000');
  const mob = page.locator('#root [data-err="mobile"] input[type="tel"]');
  if (!(await mob.inputValue())) await mob.fill(BUYER.mobile);
  await page.getByRole('button', { name: /Get Loan Offers|Submit|Request/i }).first().click();

  await expect.poll(async () => page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    return (db.tickets || []).length;
  }), { timeout: 10000 }).toBeGreaterThan(0);
  // `tickets` is unshifted on create, so index 0 is the request just submitted.
  const ticket = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    return db.tickets[0];
  });
  // The whole point of the vertical: `loans`, and specifically not `legal`.
  expect(ticket.team).toBe('loans');
  expect(ticket.team).not.toBe('legal');
  expect(ticket.service).toBe('Home Purchase Loan');
});

/*
 * And the console says so rather than showing an empty desk.
 *
 * This is the assertion that keeps the deletion above honest. Without it, "the
 * admin half moved to the live suite" is a claim with nothing checking that the
 * mock build behaves defensibly in the meantime — and an empty queue reads as
 * "nobody has asked for anything", which is the failure `AdminServices.jsx:280`
 * names in its own comment.
 */
test('the admin services desk says it needs the API rather than rendering an empty queue', async ({ page }) => {
  await login(page, { name: 'Ops Admin', mobile: '9800000001', email: '', role: 'admin', teams: ['loans'], joinedAt: Date.now() });
  await page.goto(`${BASE}/admin/services`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/served by the API, which is not enabled/i)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('input[placeholder="Search id, customer, detail…"]')).toHaveCount(0);
});
