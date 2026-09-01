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
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

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

  /* Three tabs, three tables, three different records behind them — requester, visitor,
     counterparty. A masking fix written against `users.mobile` would pass the enquiries tab and
     leak on the deals one, where the number may have been typed by an owner closing off-platform
     and belong to nobody with an account here. */
  for (const tab of ['enquiries', 'visits', 'deals']) {
    await openBoard(page, tab);

    /* The vacuity guard, and it is not hypothetical: `toHaveCount(0)` on a raw number is satisfied
       by a table that rendered nothing at all, so on its own this loop cannot tell "masked" from
       "empty" — and an empty board is the *more* likely failure, since it is what a broken list
       call produces. The tab label carries the server's own count, so it says how many rows this
       table should be holding; where that is non-zero, a masked number has to be on screen before
       the absence of an unmasked one means anything. */
    const label = await page.getByRole('button', { name: new RegExp(`^${tab[0].toUpperCase()}${tab.slice(1)} \\(\\d+\\)`) }).innerText();
    const rows = Number(label.match(/\((\d+)\)/)[1]);

    if (rows > 0) {
      /* Where the number reaches a human differs by tab, and the guard has to follow it rather
         than assume. `dealCols` in `AdminEnquiries.jsx` is Listing / Type / Value / Closed /
         Status and **no contact column at all** — so on the deals tab the sweep below is true of
         a page that never had a number to leak, which is the exact vacuity this guard exists to
         catch. The deal's number is rendered in the row's own detail modal, so that is where the
         claim has to be made. (This tab's masking was previously asserted only over the table,
         and would have passed unchanged if the modal had started printing raw numbers.) */
      if (tab === 'deals') {
        await page.locator('table tbody tr').first().locator('[title="View"]').click();
        const detail = page.getByRole('dialog', { name: /^Deal · / });
        await expect(detail).toBeVisible();
        await expect(detail.getByText(MASKED),
          'the deal detail shows a contact that is neither masked nor absent',
        ).toBeVisible();
      } else {
        await expect(page.getByText(MASKED).first(),
          `the ${tab} tab reports ${rows} rows but shows no masked number, so the absence of a raw one proves nothing`,
        ).toBeVisible();
      }
    }

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

  /* The operator is told the reveal was logged, ported from `admin/enquiries.spec.js` when that
     test was retired. It matters on its own terms rather than as chrome: revealing a contact is a
     recorded act against the person who asked, and a desk that performs it silently lets staff
     unmask numbers without ever being shown that a trail exists. The audit row is asserted below;
     this is the half the person clicking actually sees. */
  await expect(page.getByRole('alert')).toContainText('recorded');

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

/**
 * The "Awaiting owner" tile, against the server's own count of the same thing.
 *
 * This tile used to be labelled "Open leads" and counted `status === 'new' || status === 'open'` —
 * two words out of the *browser store's* vocabulary. The live server emits `pending | approved |
 * declined` and has never emitted either of them, so the tile rendered `0` on every live build while
 * unanswered requests sat on the board underneath it. Nobody double-checks a zero: it reads as
 * "nothing to do here" rather than as a fault, which is why this went unnoticed and why it is worth
 * a test of its own.
 *
 * The expected figure is read from the API rather than written down, so a reseed moves both sides
 * together. That makes the test worthless on its own — `0 === 0` would pass against exactly the bug
 * it exists to catch — so the count is asserted non-zero *first*. That assertion is the whole test:
 * it is what makes the comparison capable of failing.
 */
test('the awaiting-owner tile counts what the server calls pending', async ({ page, login }) => {
  const headers = await authHeaders(ACTORS.admin);
  const res = await fetch(`${API}/admin/enquiries?status=pending&size=200`, { headers });
  expect(res.status, 'GET /admin/enquiries?status=pending').toBe(200);
  const pending = (await res.json()).totalElements;

  /* Without this the test is vacuous. If the seed ever stops carrying an unanswered request, the
     tile and the server would agree on zero and the old bug would pass here unnoticed. */
  expect(pending, 'the seed must carry at least one pending request for this test to mean anything')
    .toBeGreaterThan(0);

  await login.asAdmin();
  await openBoard(page);

  const tile = page.locator('.pn-card').filter({ hasText: 'Awaiting owner' }).first();
  await expect(tile).toBeVisible();
  await expect(tile.locator('.text-2xl')).toHaveText(String(pending));
});

/**
 * "Responded" — the one write on a board that is otherwise read-only, and the one that had nothing
 * behind it.
 *
 * The mock twin asserted the toast and stopped there. A toast is the client congratulating itself:
 * `noteResponded` catches its own failure and only *then* renders a different string, so the happy
 * path proves the call did not throw and nothing more. Whether a row exists afterwards, and whether
 * anyone can find it, were both unasserted.
 *
 * They needed asserting, because this is the one call site in the console that addresses a listing
 * by **uuid**. Every other note call — the review modal, the flag and archive modals, the card
 * actions — passes the seam id, which `propertyMapper` sets to `p.slug || p.id`, so it is a slug for
 * any listing that has one. `AdminEnquiries` passes `r.propertyId` straight off the enquiry DTO.
 * Until `NoteEntityKey`, that meant this button wrote into a history the listing's own case file
 * never read: the moderator who opened the listing to see what had already been done saw an empty
 * panel and rang the owner a second time. No error, no empty-state hint, and a green toast.
 *
 * So the assertion deliberately **crosses the two ids**: the button writes under the uuid, and the
 * note is then demanded back under the *slug*, which is what the console holds. Reading it back the
 * way it was written would restate the write and pass against the bug.
 *
 * It stops at the API rather than going on to open the case file, because `live-notes.spec.js`
 * already proves a note reaches the rendered communication log, and that log is read with exactly
 * the slug asked for here — `listNotes('listing', listing.id)` in `PropertyReviewModal`. Repeating
 * the render would be a second test of the timeline and a first test of nothing.
 */
test('a lead marked responded is on the case file the moderator opens', async ({ page, login }) => {
  const headers = await authHeaders(ACTORS.admin);

  /* `pending` is the only status that offers the button — `AWAITING_STATUSES` also lists `new` and
     `open`, but those are the browser store's words and the server has never emitted them. */
  const res = await fetch(`${API}/admin/enquiries?status=pending&size=1`, { headers });
  expect(res.status, 'GET /admin/enquiries?status=pending').toBe(200);
  const lead = (await res.json()).content?.[0];
  expect(lead, 'the seed must carry an unanswered request for this button to exist').toBeTruthy();

  /* The listing the board is pointing at, fetched the way the *console* sees it. `slug` is the id
     every other note call site would use, and the whole point of the test is that it differs from
     the `propertyId` the board is about to write under. */
  const cat = await fetch(`${API}/admin/properties?size=200`, { headers });
  expect(cat.status).toBe(200);
  const listing = ((await cat.json()).content ?? []).find((p) => p.id === lead.propertyId);
  expect(listing, 'the enquiry must point at a listing on the admin catalogue').toBeTruthy();
  expect(listing.slug, 'the seeded listing must carry a slug, or the two ids are the same string and this test asserts nothing')
    .toBeTruthy();
  expect(listing.slug).not.toBe(lead.propertyId);

  const expected = `Responded to enquiry from ${lead.requesterName}.`;

  const readBySlug = async () => {
    const r = await fetch(`${API}/admin/notes/property/${listing.slug}`, { headers });
    expect(r.status, `GET /admin/notes/property/${listing.slug}`).toBe(200);
    return (await r.json()).map((n) => n.text);
  };

  /* The before-count is the vacuity guard. Another spec may have filed a note on this listing, and
     without this the final `toContain` could be satisfied by a row that was already there. */
  expect(await readBySlug(), 'a previous run left this note behind — the DB was not reset')
    .not.toContain(expected);

  await login.asAdmin();
  await openBoard(page);

  /* Scoped to the row this test read out of the API rather than `.first()`, so the note it goes
     looking for afterwards is the note this click produced. The count guard is what makes the
     scoping meaningful: two leads from the same person on the same listing would make the row
     ambiguous and the assertion below accidental. */
  const row = page.locator('table tbody tr').filter({ hasText: lead.requesterName });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Responded' }).click();
  await expect(page.getByRole('alert')).toContainText('Note added to the listing');

  // Written under the uuid; demanded back under the slug. This is the assertion that crosses.
  expect(await readBySlug(), 'the note the board filed is not on the id the console reads')
    .toContain(expected);
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

/* Migrated from `admin/enquiries.spec.js` on 2026-08-25, where it was the one test in that file
   with no live counterpart at all: this file covered only the signed-out case above.
 *
 * The two are not the same claim. A signed-out visitor has no session for the router to inspect,
 * so bouncing them is the default path and would still happen if the role check itself were
 * deleted. A buyer arrives *authenticated* — the guard has to read the role and decide, which is
 * the branch that can actually be got wrong, and the one that matters, since a buyer is a real
 * account holder who can type the URL. Asserting the heading's absence as well as the redirect is
 * what separates "sent to staff-login" from "sent to staff-login after the board rendered behind
 * it", which leaves the numbers on screen for as long as the navigation takes. */
test('a signed-in buyer cannot open the admin enquiries desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/enquiries');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toHaveCount(0);
  await expect(page.getByText(MASKED)).toHaveCount(0);
});
