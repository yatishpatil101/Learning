import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';

/* The owner's Scheduled Visits tab — confirm, reschedule, cancel — against real HTTP.
 *
 * ## What the mock version was actually asserting
 *
 * `scheduled-visits.spec.js` wrote `draazyPropVisitReqs:U-TEST-OWNER` into localStorage: a JSON
 * array of two rows it had authored itself, each already carrying `visitorName: 'Asha Kulkarni'`
 * and `visitorMobile: '9811111111'` in the clear. Every assertion below the surface was therefore
 * a round-trip through a browser store the test controlled. Two consequences worth naming, because
 * the live twin has to close both:
 *
 *  1. **The privacy test could not fail.** The mock row carried the visitor's raw ten digits
 *     unconditionally, so "the owner can WhatsApp the visitor" was a statement about a string the
 *     fixture had written, not about who the server is willing to tell. The contact gate was not
 *     in the picture at all — as the mock spec's own comment conceded, "the protection lives
 *     entirely in VisitsTab suppressing the handoff for a non-owner viewer".
 *
 *  2. **"Persists across a full reload" proved localStorage.** The reload re-hydrated the same
 *     key the test had seeded and the mock provider had rewritten. No server was asked whether
 *     the visit was confirmed.
 *
 * Live, both reads are caller-scoped by the token (`GET /visits` = visits I booked,
 * `GET /me/visit-requests` = visits on my listings) and the visitor's mobile is contact-gated by
 * `VisitService#visitorMobileVisibility`: masked to the owner while the visit is merely
 * `scheduled`, revealed once they have `confirmed` it. So the handoff test below is a genuine gate
 * test — it asserts the button is absent at a status where the row is otherwise fully rendered,
 * then present after one click, with the real digits in the href.
 *
 * ## Why the fixture mints two buyers
 *
 * The server answers 409 to a second live visit by the same caller on the same property, which is
 * correct and which the count assertions here have to work around: "confirming takes one row out
 * of Awaiting confirmation" needs two rows, and two rows on one listing means two accounts. Slots
 * are three and five days out — far enough that `VisitsTab` renders an absolute date rather than
 * the "Today"/"Tomorrow" tag, and `upcoming` sorts by slot ascending, so "the first row" is always
 * the earlier visitor.
 *
 * Nothing is borrowed from the seed. A shared listing would make every count assertion a function
 * of how many times the suite had run.
 */

/* ── fixture plumbing ─────────────────────────────────────────────────────────────────────── */

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/* A named throwaway account. Registration leaves `name` unset and the visit row falls back to the
   literal "Visitor", so an unnamed buyer would let "the owner sees the visitor by name" pass
   against a constant the provider supplies. */
async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

/* An ISO instant `days` out, at a fixed local time. Local, not UTC-arithmetic: the row is rendered
   in the browser's zone, so a slot built in UTC could land on the previous day in the assertion. */
function slotDaysAhead(days, hour = 11, minute = 30) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/* Owner + approved listing + one booked visit per named visitor.
 *
 * The wire vocabulary, not the client's: `propertyType` rather than `type`, `bhk` as a number,
 * `furnishing: 'semi-furnished'` rather than the client's `semi`. */
async function scene(visitorNames) {
  const owner = await actor('Zztest Visit Owner');
  const res = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest scheduled-visits ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    bhk: 2,
    price: 25000,
    area: 920,
    areaUnit: 'sqft',
    furnishing: 'semi-furnished',
    city: 'Pune',
    locality: 'Baner',
    address: 'D110 Visit Test Residency, A-701',
  });
  expect(res.status, `creating the fixture listing (${JSON.stringify(res.body)})`).toBe(201);
  const listingId = res.body.id;
  expect(listingId, 'the server issued an id').toBeTruthy();

  const admin = await authHeaders(ACTORS.admin);
  const appr = await api('PATCH', `/properties/${listingId}/status`, admin, { status: 'approved' });
  expect(appr.status, 'approving the fixture listing').toBe(200);

  const visitors = [];
  for (const [i, name] of visitorNames.entries()) {
    const visitor = await actor(name);
    // Slots 3 and 5 days out, ascending in the order the names were given, so `upcoming`
    // (sorted by slot) puts them on screen in that same order.
    const slot = slotDaysAhead(3 + i * 2);
    const booked = await api('POST', '/visits', visitor.headers, {
      propertyId: listingId,
      slot,
      mode: 'in-person',
    });
    expect(booked.status, `booking a visit for ${name} (${JSON.stringify(booked.body)})`).toBe(201);
    visitors.push({ ...visitor, visitId: booked.body.id, slot });
  }

  return { owner, listingId, visitors };
}

/* The owner's own read of their visit rows, straight off the wire. Used to check the server's
   answer where the DOM cannot: whether a slot moved, and what the contact gate is willing to say. */
async function visitRowsOnMine(owner) {
  const res = await api('GET', '/me/visit-requests?size=100', owner.headers);
  expect(res.status, 'reading visits on my listings').toBe(200);
  return res.body.content;
}

/* Status badges in the visit list, counted.
 *
 * `exact`, and worth the helper. `getByText` is a case-insensitive *substring* match by default,
 * and this tab says "Confirmed" in three other places: the calendar legend ("Confirmed / visited"),
 * the calendar subtitle ("Every scheduled, confirmed and past visit at a glance") and the toast the
 * click itself raises ("Visit confirmed"). A loose locator counts all of them, so it answers 4
 * where one visit is confirmed — and, because the toast fades, answers 3 a moment later. The
 * number it returns has nothing to do with how many visits are in that state. */
const badges = (page, label) => page.getByText(label, { exact: true });

/* ── the specs ────────────────────────────────────────────────────────────────────────────── */

test.describe('Scheduled visits (live)', () => {
  test('owner sees an actionable Upcoming list and can confirm a visit', async ({ page }) => {
    const { owner } = await scene(['Asha Kulkarni', 'Rohit More']);
    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#visits', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible();
    // Both bookings arrived on the owner's surface, awaiting them. Stated as an exact count, not
    // "at least one": the confirm assertion below is a decrement, and a decrement from an unknown
    // starting point would pass against a list that had quietly lost a row.
    await expect(badges(page, 'Awaiting confirmation')).toHaveCount(2);

    await page.getByRole('button', { name: /^Confirm$/ }).first().click();

    // One row moved, the other did not. The count is re-read from the server after the write
    // (useDashboardData#mutateVisit refreshes on success), so this is the server's answer.
    await expect(badges(page, 'Confirmed')).toHaveCount(1);
    await expect(badges(page, 'Awaiting confirmation')).toHaveCount(1);
  });

  test('the reschedule dialog opens, and dismissing it leaves the slot untouched', async ({ page }) => {
    const { owner, visitors } = await scene(['Asha Kulkarni']);
    const [asha] = visitors;
    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#visits', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible();

    await page.getByRole('button', { name: /^Reschedule$/ }).first().click();
    const dialog = page.getByRole('dialog');
    // Assert the dialog itself opened before asserting anything scoped to it: every check below
    // is a `dialog.…` locator, and a dialog that never opened would answer "not there" to all of
    // them without the spec noticing.
    await expect(dialog).toBeVisible();
    const dateInput = dialog.getByRole('button', { name: 'New visit date' });
    await expect(dateInput).toBeVisible();

    await dialog.getByRole('button', { name: /^Cancel$/ }).click();
    await expect(dateInput).toHaveCount(0);

    // Dismissing the picker must not have written anything. The mock could only check the DOM,
    // which shows the old slot whether or not a PATCH went out; the wire is the only place the
    // difference is visible.
    const [row] = await visitRowsOnMine(owner);
    expect(row.id, 'the row read back is the one that was booked').toBe(asha.visitId);
    expect(new Date(row.slot).getTime(), 'slot unchanged by opening and dismissing the dialog')
      .toBe(new Date(asha.slot).getTime());
    expect(row.status, 'status unchanged by opening and dismissing the dialog').toBe('scheduled');
  });

  test('cancelling a visit drops it from Upcoming and is cancelled on the server', async ({ page }) => {
    const { owner, visitors } = await scene(['Asha Kulkarni', 'Rohit More']);
    const [asha] = visitors;
    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#visits', { waitUntil: 'networkidle' });
    await expect(badges(page, 'Awaiting confirmation')).toHaveCount(2);

    // The first row is Asha's — `upcoming` sorts by slot ascending and hers is the earlier one.
    await page.getByRole('button', { name: /^Cancel$/ }).first().click();
    await expect(badges(page, 'Awaiting confirmation')).toHaveCount(1);

    // …and it is the right one that went. A cancelled visit leaves Upcoming entirely, so the DOM
    // alone cannot say which row was cancelled versus merely re-rendered.
    const rows = await visitRowsOnMine(owner);
    const ashaRow = rows.find((r) => r.id === asha.visitId);
    expect(ashaRow.status, 'the cancelled row is the one whose button was clicked').toBe('cancelled');
    expect(rows.filter((r) => r.status === 'scheduled'), 'the other booking is untouched').toHaveLength(1);
  });

  test('completing a reschedule moves the slot and resets the visit to scheduled (D87)', async ({ page }) => {
    const { owner, visitors } = await scene(['Asha Kulkarni', 'Rohit More']);
    const [asha] = visitors;
    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#visits', { waitUntil: 'networkidle' });
    await expect(badges(page, 'Awaiting confirmation')).toHaveCount(2);

    // Confirm first, so the reschedule has a status to reset. D87: moving a slot returns the visit
    // to `scheduled`, because the other party agreed to a time and that time no longer exists.
    await page.getByRole('button', { name: /^Confirm$/ }).first().click();
    await expect(badges(page, 'Confirmed')).toHaveCount(1);

    await page.getByRole('button', { name: /^Reschedule$/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Nine days out: clear of both seeded slots, and far enough that the row renders an absolute
    // date rather than the "Today"/"Tomorrow" tag the assertion could not match.
    const target = new Date();
    target.setDate(target.getDate() + 9);
    const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    await pickDate(page, '[aria-label="New visit date"]', iso);
    await dialog.getByRole('button', { name: 'Save new slot' }).click();
    await expect(page.getByText('Visit rescheduled')).toBeVisible();

    // The row shows the moved date. `weekday, day, month` in the runner's locale, so match either
    // word order.
    const mon = target.toLocaleDateString('en-US', { month: 'short' });
    const dateRe = new RegExp(`${mon} ${target.getDate()}\\b|\\b${target.getDate()} ${mon}`);
    await expect(page.getByText(dateRe).first()).toBeVisible();

    // Confirming took one row out of Awaiting confirmation (2 → 1); the reschedule put it back,
    // so both are awaiting again and nothing is Confirmed.
    await expect(badges(page, 'Awaiting confirmation')).toHaveCount(2);
    await expect(badges(page, 'Confirmed')).toHaveCount(0);

    // And the server agrees, which is the half D87 is actually about — the status reset happens
    // in `VisitService`, not in the component that re-rendered.
    const rows = await visitRowsOnMine(owner);
    const moved = rows.find((r) => r.id === asha.visitId);
    expect(moved.status, 'the server reset the moved visit to scheduled').toBe('scheduled');
    expect(new Date(moved.slot).getDate(), 'the server stored the new day').toBe(target.getDate());
  });

  test('a confirmed visit persists across a full reload', async ({ page }) => {
    const { owner, visitors } = await scene(['Asha Kulkarni']);
    const [asha] = visitors;
    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#visits', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible();

    await page.getByRole('button', { name: /^Confirm$/ }).first().click();
    await expect(badges(page, 'Confirmed')).toHaveCount(1);

    /* The point of this test, and the reason it survives the port. `mutateVisit` patches the row
       optimistically, so the badge above flips before the server has answered — on the mock that
       optimism was the whole story and the reload only re-read the browser store that the mock
       provider had written. Live, the reload discards every byte of client state and the badge can
       only come back from `GET /me/visit-requests`. */
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible();
    await expect(badges(page, 'Confirmed')).toHaveCount(1);

    const [row] = await visitRowsOnMine(owner);
    expect(row.id).toBe(asha.visitId);
    expect(row.status, 'the confirmation was written, not just rendered').toBe('confirmed');
  });

  test('the Requests tab carries no Visit-requests sub-tab (deduped)', async ({ page }) => {
    const { owner } = await scene(['Asha Kulkarni']);
    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#leads', { waitUntil: 'networkidle' });

    // The positive anchor: a sibling tab from the same static list. Without it the absence check
    // below would pass just as happily against a Requests panel that never rendered.
    await expect(page.getByRole('tab', { name: /Number requests/ }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Visit requests$/ })).toHaveCount(0);
  });

  test('the Requests inbox shows a lead-triage summary strip', async ({ page }) => {
    const { owner } = await scene(['Asha Kulkarni']);
    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#leads', { waitUntil: 'networkidle' });

    await expect(page.getByText('Waiting on you')).toBeVisible();
    await expect(page.getByText('Open leads')).toBeVisible();
    await expect(page.getByText('Oldest waiting')).toBeVisible();
  });

  /* D5 (number-privacy policy): a buyer never receives the owner's phone number. Approval unlocks
     in-app messaging, not the digits, so a visit the buyer booked carries no WhatsApp handoff in
     either direction — `VisitsTab` returns `null` from the handoff block for a non-owner viewer,
     and the wire backs it up by never putting an owner on the row at all. */
  test('a buyer viewing their booked visit gets no WhatsApp handoff to the owner (D5)', async ({ page }) => {
    const { visitors } = await scene(['Asha Kulkarni']);
    const [asha] = visitors;
    await signedInAs(page, asha.mobile);
    await page.goto('/dashboard#visits', { waitUntil: 'networkidle' });

    /* The positive anchor, and the reason it is not the listing title. The mock anchored on
       'Test 2 BHK, Baner', which it had written onto the row itself; live the wire carries no
       title (`http/visitProvider.js` maps `listing: row.listing || ''`) and the dashboard fills it
       in from the catalogue afterwards — an anchor that depends on a second read landing. The
       row's own copy does not: a seeker's row is labelled with the visit mode, and the status
       badge is rendered from the visit's own status. */
    await expect(page.getByRole('heading', { name: /upcoming visits/i }).first()).toBeVisible();
    await expect(page.getByText('Your in-person')).toBeVisible();
    await expect(badges(page, 'Awaiting confirmation')).toHaveCount(1);

    // The row is on screen and fully rendered — and carries no route to the owner's number.
    await expect(page.getByRole('link', { name: /WhatsApp/i })).toHaveCount(0);
    await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
  });

  /* The mirror, and the one the mock could not write. The owner→visitor handoff is the direction
     D5 keeps, but the number behind it is contact-gated: `VisitService#visitorMobileVisibility`
     masks the visitor's mobile from the listing owner while the visit is merely `scheduled` — a
     booking nobody has agreed to yet must not hand out a phone number, or booking would become a
     way to harvest one — and reveals it once the owner has confirmed.

     So this is a gate test, not a render test. The before-half is a row that is otherwise complete
     (the visitor's real name is on it) and still has no button, which is what makes the after-half
     mean something: the only thing that changed between the two is the status. */
  test('the owner earns the visitor number by confirming, and the handoff appears without a reload', async ({ page }) => {
    const { owner, visitors } = await scene(['Asha Kulkarni']);
    const [asha] = visitors;
    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#visits', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible();

    // The row is there, named, and awaiting the owner…
    await expect(page.getByText('Asha Kulkarni')).toBeVisible();
    await expect(badges(page, 'Awaiting confirmation')).toHaveCount(1);
    // …and the number is masked, so there is nothing to dial. `isFullMobile` suppresses the button
    // for the five-digit fragment a masked value strips to.
    await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);

    // Confirm what the server itself is saying at this point, so a future failure here separates
    // "the gate opened too early" from "the component rendered it anyway".
    const [before] = await visitRowsOnMine(owner);
    expect(before.visitor.mobile, 'masked to the owner while merely scheduled')
      .toBe(`${asha.mobile.slice(0, 2)}XXXXX${asha.mobile.slice(-3)}`);

    await page.getByRole('button', { name: /^Confirm$/ }).first().click();
    await expect(badges(page, 'Confirmed')).toHaveCount(1);

    /* No reload between the click and this assertion, deliberately. The optimistic patch in
       `mutateVisit` carries only `{status}`, so the row would still hold the masked number and the
       button would stay hidden; the write is followed by a re-read for exactly this reason. Drop
       that refresh and the reveal ships on the wire while the one screen that acts on it cannot
       see it until the owner happens to reload. */
    const wa = page.locator(`a[href*="wa.me/91${asha.mobile}"]`);
    await expect(wa).toHaveCount(1);
    await expect(wa).toHaveAttribute('aria-label', /Asha Kulkarni/);

    const [after] = await visitRowsOnMine(owner);
    expect(after.visitor.mobile, 'revealed to the owner once confirmed').toBe(asha.mobile);
  });
});
