/* The demand board and its audited reveal, against the live API (D25).
 *
 * The mock `admin/enquiries.spec.js` still runs and still covers the shell — tabs, KPI tiles, the
 * funnel, the status filter, the redirect for a signed-out visitor. Repeating those here against a
 * database costs a minute of suite time to re-assert facts about React Router.
 *
 * What is here has no mock ancestor, because it is the thing this slice added: a board that shows
 * nobody's phone number, a reveal that is a separate request on a stricter role, and an audit trail
 * that names the row. Each of those is a *negative* guarantee — "the number is not on this page" —
 * and negative guarantees are the ones that survive a refactor by accident and die by accident too.
 *
 * Read-only, so no cleanup: the one thing these tests write is an `audit_log` row, which is
 * append-only by design and is exactly what the third test goes looking for.
 */
import { test, expect } from '../../fixtures/live.js';

/** `98XXXXX210` — the shape `MobileMask` emits. */
const MASKED = /^\d{2}X{5}\d{3}$/;
/** A real Indian mobile. If one of these is on the board, something has gone wrong. */
const RAW = /^[6-9]\d{9}$/;

async function openBoard(page, tab) {
  await page.goto(tab ? `/admin/enquiries?tab=${tab}` : '/admin/enquiries');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();
  // The row landing is the signal that the list call answered; the heading renders before it.
  await expect(page.locator('table tbody tr').first()).toBeVisible();
}

test('the board lists live enquiries and shows no readable mobile number', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openBoard(page);

  // The seed carries eight contact requests. Asserting the number rather than "more than zero"
  // means a board that silently returned an empty page would fail here instead of passing quietly.
  await expect(page.getByRole('button', { name: /^Enquiries \(8\)/ })).toBeVisible();

  await expect(page.getByText(MASKED).first()).toBeVisible();
  await expect(page.getByText(RAW)).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('every tab masks its own contact column', async ({ page, login }) => {
  await login.asAdmin();

  /* Three tables, three different tables behind them, three different columns holding the number —
     requester, visitor, counterparty. A masking fix written against `users.mobile` would pass the
     enquiries tab and leak on the deals one, where the number may have been typed by an owner
     closing off-platform and belong to nobody with an account here. */
  for (const tab of ['enquiries', 'visits', 'deals']) {
    await openBoard(page, tab);
    await expect(page.getByText(RAW)).toHaveCount(0);
  }
});

test('revealing a contact unmasks that one row and records who asked', async ({ page, login }) => {
  await login.asAdmin();
  await openBoard(page);

  const masked = page.getByText(MASKED);
  await expect(masked.first()).toBeVisible();
  const before = await masked.count();
  expect(before).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Reveal contact' }).first().click();

  // One row changed, and only one. A reveal that refetched the list with a `reveal` flag would
  // unmask all of them and still show a plausible-looking screen.
  await expect(page.getByText(RAW)).toHaveCount(1);
  await expect(masked).toHaveCount(before - 1);

  /* The other half of the bargain. The server writes the audit row before it answers, so by the
     time the number is on screen the record exists — and the staff-activity desk reads the same
     table. Searching by action rather than by actor keeps this from depending on which admin the
     login fixture happens to be. */
  await page.goto('/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Staff Activity', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search staff activity' }).fill('enquiry.contact.reveal');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
});

/* There is deliberately no test here for "a staffer sees the board but not the reveal button".
 *
 * The admin console is admin-only at the router — `RoleRoute roles={['admin']}` wraps the whole
 * shell — so a staffer never reaches this page to be refused anything on it. That makes the
 * staff/admin split an API-level fact, and it is asserted where it is true, in
 * `EnquiryBoardEndpointsTest`: a staffer gets 200 on `GET /admin/enquiries` and 403 on
 * `GET /admin/enquiries/{id}`. Asserting it through a console they cannot open would be a test that
 * passes because of the router and appears to be about permissions. */
test('a signed-out visitor gets no board and no numbers', async ({ page }) => {
  await page.goto('/admin/enquiries');

  await page.waitForURL('**/staff-login**');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toHaveCount(0);
  await expect(page.getByText(MASKED)).toHaveCount(0);
});
