// @ts-check
import { test, expect } from '@playwright/test';

/*
 * What is left of this file, and why.
 *
 * ## The consumer half moved to the live suite
 *
 * This file used to open `/home-loans`, submit the form, and read the routing key back out of
 * `puneNestDB_v5` to prove the enquiry was filed against `team=loans` and not folded into legal.
 * That assertion now lives in `consumer/services/live-loans-team.spec.js`, where it drives the same
 * form against the real backend and reads the loans and legal desks over HTTP.
 *
 * It was worth moving rather than keeping. The store this file read is written by the browser, so
 * the old test proved the page told itself the truth — the version of the bug that matters, where
 * `team="loans"` (`HomeLoans.jsx:49`) is dropped and the enquiry never reaches the desk anybody
 * staffs, was invisible to it. The live twin is mutation-proven against exactly that edit.
 *
 * ## Why the admin half is still here
 *
 * The `/admin/services` console is **live-only**: `ticket` has no mock provider by deliberate
 * decision (D184, and `AdminServices.jsx:281`), because the mock store knows three ticket statuses
 * where the server knows five. The queue, the team label, Start, and the assignee directory are
 * asserted in `live-admin-services.spec.js`, which is the only place any of it is true.
 *
 * What survives below is the one claim that is *about the mock build* and so cannot move: that in a
 * build without the API the desk says so, rather than rendering an empty queue. An empty queue
 * reads as "nobody has asked for anything", which is the failure `AdminServices.jsx:280` names in
 * its own comment.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

async function login(page, user) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
  }, user);
}

test('the admin services desk says it needs the API rather than rendering an empty queue', async ({ page }) => {
  await login(page, { name: 'Ops Admin', mobile: '9800000001', email: '', role: 'admin', teams: ['loans'], joinedAt: Date.now() });
  await page.goto(`${BASE}/admin/services`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/served by the API, which is not enabled/i)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('input[placeholder="Search id, customer, detail…"]')).toHaveCount(0);
});

/*
 * The second claim that is about the mock build and so cannot move to the live suite.
 *
 * `ServiceLanding` carried a `!isHttpDomain('ticket')` arm that wrote the lead into
 * `puneNestDB_v5.tickets` — a browser-local row on a desk that, by the test above, does not exist
 * in this build. It ran on live deployments too, which is the half `live-service-landing-ticket`
 * now covers; this is the other half, and it is the one no live spec can see, because on a live
 * build the deleted branch was never taken.
 *
 * Asserted as a delta with a marker rather than a count. The seed ships tickets on several desks
 * and more arrive while the page is still booting, so `tickets.length` is a race — but `customer`
 * is copied verbatim off the session by the deleted writer, so a name nobody else uses is a
 * signature only this submit could have left. The confirmation heading is the positive anchor: a
 * submit that silently did not run would satisfy the absence for free.
 */
test('a quote submitted without the API leaves no lead in this browser', async ({ page }) => {
  const PROBE = `Mock Lead Probe ${Date.now()}`;
  await login(page, { name: PROBE, mobile: '9800000002', email: '', role: 'user', joinedAt: Date.now() });
  await page.goto(`${BASE}/home-loans`, { waitUntil: 'domcontentloaded' });

  // The field is not a native `<select>` — `NativeSelect` keeps the `<option>` API but renders the
  // themed `pn-dropdown`, and its label is not wired to it, so the `data-err` wrapper is the hook.
  await page.locator('[data-err="loanType"] .pn-dropdown__trigger').click();
  await page.getByRole('option', { name: 'Home Purchase Loan' }).click();
  await page.getByRole('button', { name: 'Get Loan Offers' }).click();

  await expect(page.getByRole('heading', { name: 'Request received!' })).toBeVisible({ timeout: 10000 });

  const mine = await page.evaluate((probe) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    return (db.tickets || []).filter((t) => t.customer === probe).length;
  }, PROBE);
  expect(mine, 'the lead was filed in this browser, where no desk in this build can read it').toBe(0);
});
