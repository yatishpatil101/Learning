/* Demand board against the live API: lists carry masked contacts, and opening a row's detail returns the full number
 * and is recorded against whoever opened it. */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const RAW = /^[6-9]\d{9}$/;
const MASKED = /^[6-9]\dX{5}\d{3}$/;

async function openBoard(page, tab) {
  await page.goto(tab ? `/admin/enquiries?tab=${tab}` : '/admin/enquiries');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();
  // The row landing is the signal that the list call answered; the heading renders before it.
  await expect(page.getByTestId('queue-row').first()).toBeVisible();
}

test('every tab lists masked contacts, and the detail modal opens the full number', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openBoard(page);

  // Asserting the number rather than "more than zero" fails a board that silently returned an empty page.
  await expect(page.getByTestId('tab-count-enquiries')).toHaveText('8');

  const DIALOG = { enquiries: /^Enquiry /, visits: /^Site visit /, deals: /^Deal / };
  for (const tab of ['enquiries', 'visits', 'deals']) {
    await openBoard(page, tab);
    const rows = Number(await page.getByTestId(`tab-count-${tab}`).innerText());
    if (rows === 0) continue;

    await expect(page.getByText(RAW), `the ${tab} list must not carry a full mobile`).toHaveCount(0);
    if (tab !== 'deals') {
      await expect(page.getByTestId('queue-row').first().getByText(MASKED), `the ${tab} list shows a masked mobile`).toBeVisible();
    }

    await page.getByTestId('queue-row').first().locator('[title="View"]').click();
    const detail = page.getByRole('dialog', { name: DIALOG[tab] });
    await expect(detail).toBeVisible();
    await expect(detail.getByText(RAW)).toBeVisible();
    await page.keyboard.press('Escape');
  }

  expect(consoleErrors).toHaveLength(0);
});
test('opening an enquiry shows its contact and records who opened it', async ({ page, login }) => {
  await login.asAdmin();
  await openBoard(page);

  const opened = page.waitForResponse((r) => /\/admin\/enquiries\/[^/?]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET');
  await page.getByTestId('queue-row').first().locator('[title="View"]').click();
  expect((await opened).status()).toBe(200);
  const detail = page.getByRole('dialog', { name: /^Enquiry / });
  await expect(detail.getByText(RAW)).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Reveal contact' })).toHaveCount(0);

  // The server writes the audit row before it answers. Searched by action, not actor.
  await page.goto('/admin/staff-activity?tab=log');
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search staff activity' }).fill('enquiry.contact.reveal');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
});

/* The tile counted two words out of the *browser store's* vocabulary, which the live server never emits, so
 * it rendered `0` — and nobody double-checks a zero. Hence the non-zero assertion before the comparison. */
test('the awaiting-owner chip counts what the server calls pending', async ({ page, login }) => {
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

  await expect(page.getByRole('group', { name: 'Status' }).getByRole('button', { name: `Awaiting owner ${pending}`, exact: true })).toBeVisible();
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
  const row = page.getByTestId('queue-row').filter({ hasText: lead.requesterName });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Responded' }).click();
  await expect(page.getByRole('alert')).toContainText('Note added to the listing');

  // Written under the uuid; demanded back under the slug. This is the assertion that crosses.
  expect(await readBySlug(), 'the note the board filed is not on the id the console reads')
    .toContain(expected);
});

/* No test here for "a staffer sees the board but not the reveal button": the admin shell excludes
 * staff, so a staffer never reaches this page. That split is asserted in `EnquiryBoardEndpointsTest`. */
