/* The demand board and its audited reveal, against the live API. What is here has no mock ancestor because
 * every claim is a *negative* guarantee — "the number is not on this page" — which dies by accident.
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

  /* Three tabs, three different records behind them — requester, visitor, counterparty. A masking fix written
     against `users.mobile` would pass the enquiries tab and leak on the deals one. */
  for (const tab of ['enquiries', 'visits', 'deals']) {
    await openBoard(page, tab);

    /* The vacuity guard: `toHaveCount(0)` on a raw number is also satisfied by a table that rendered nothing,
       which is what a broken list call produces. The tab label carries the server's own row count. */
    const label = await page.getByRole('button', { name: new RegExp(`^${tab[0].toUpperCase()}${tab.slice(1)} \\(\\d+\\)`) }).innerText();
    const rows = Number(label.match(/\((\d+)\)/)[1]);

    if (rows > 0) {
      /* Where the number reaches a human differs by tab. The deals table has no contact column at all, so a
         sweep over it is vacuous — that number is rendered in the row's own detail modal. */
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

  /* Revealing a contact is a recorded act against the person who asked, so a desk that performs it silently
     lets staff unmask numbers without ever being shown that a trail exists. */
  await expect(page.getByRole('alert')).toContainText('recorded');

  // One row changed, and only one. A reveal that refetched the list with a `reveal` flag would
  // unmask all of them and still show a plausible-looking screen.
  await expect(page.getByText(RAW)).toHaveCount(1);
  await expect(masked).toHaveCount(before - 1);

  /* The server writes the audit row before it answers, so by the time the number is on screen the record
     exists. Searched by action, not actor, so this does not depend on which admin the fixture is. */
  await page.goto('/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Staff Activity', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search staff activity' }).fill('enquiry.contact.reveal');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
});

/* The tile counted two words out of the *browser store's* vocabulary, which the live server never emits, so
 * it rendered `0` — and nobody double-checks a zero. Hence the non-zero assertion before the comparison. */
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

  const tile = page.locator('.dz-card').filter({ hasText: 'Awaiting owner' }).first();
  await expect(tile).toBeVisible();
  await expect(tile.locator('.text-2xl')).toHaveText(String(pending));
});

/* The one note call site that addresses a listing by **uuid**; every other passes the slug, so a note filed
 * here is invisible on the case file. The assertion crosses the ids: written by uuid, demanded back by slug. */
test('a lead marked responded is on the case file the moderator opens', async ({ page, login }) => {
  const headers = await authHeaders(ACTORS.admin);

  /* `pending` is the only status that offers the button — `AWAITING_STATUSES` also lists `new` and
     `open`, but those are the browser store's words and the server has never emitted them. */
  const res = await fetch(`${API}/admin/enquiries?status=pending&size=1`, { headers });
  expect(res.status, 'GET /admin/enquiries?status=pending').toBe(200);
  const lead = (await res.json()).content?.[0];
  expect(lead, 'the seed must carry an unanswered request for this button to exist').toBeTruthy();

  /* Fetched the way the *console* sees it: `slug` is the id every other note call site uses, and the whole
     point of the test is that it differs from the `propertyId` the board writes under. */
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

  /* Scoped to the row read out of the API rather than `.first()`, so the note found afterwards is the one this
     click produced. The count guard rules out two leads from the same person on the same listing. */
  const row = page.locator('table tbody tr').filter({ hasText: lead.requesterName });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Responded' }).click();
  await expect(page.getByRole('alert')).toContainText('Note added to the listing');

  // Written under the uuid; demanded back under the slug. This is the assertion that crosses.
  expect(await readBySlug(), 'the note the board filed is not on the id the console reads')
    .toContain(expected);
});

/* No test here for "a staffer sees the board but not the reveal button": `RoleRoute roles={['admin']}` wraps
 * the shell, so a staffer never reaches this page. That split is asserted in `EnquiryBoardEndpointsTest`. */
test('a signed-out visitor gets no board and no numbers', async ({ page }) => {
  await page.goto('/admin/enquiries');

  await page.waitForURL('**/staff-login**');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toHaveCount(0);
  await expect(page.getByText(MASKED)).toHaveCount(0);
});

/* Not the same claim as the signed-out case above: a buyer arrives *authenticated*, so the guard has to read
 * the role and decide — the branch that can be got wrong, and one a real account holder can reach. */
test('a signed-in buyer cannot open the admin enquiries desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/enquiries');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toHaveCount(0);
  await expect(page.getByText(MASKED)).toHaveCount(0);
});
