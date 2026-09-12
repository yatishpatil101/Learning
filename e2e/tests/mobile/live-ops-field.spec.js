import { test, expect } from '../../fixtures/live.js';
import { API, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';

/* Back-office ops on a phone — review §H Q7, answered: the drafting desk is the one
   back-office surface that is genuinely used away from a desk, standing in front of
   the customer or the flat.

   The rest of the back-office is desktop-first by design (§B.8) and stays that way.

   ## What this file lost when it moved to the live API (P5b wave 3)

   It used to target `/ops/rent-agreement`, one of the five type-specific desks retired
   in `0b5cab0`; that path is now a redirect to `/ops/drafting-desk?type=…`. Retargeting
   is trivial. The real loss is what it used to assert *inside* the record.

   Four of its six tests measured per-document **Verify / Reject / View / Add a note**
   controls: that each cleared 44px, and that each carried a real accessible name rather
   than a `title=` tooltip, which never fires on touch. Those controls existed only in
   the mock's `docs[]` array. The live desk has the read-only checklist panel (D120) and
   nothing else — there is no verify, no reject, no document viewer. So the four tests
   were not converted; they were deleted, and the capability they guarded is recorded as
   an open gap in `docs/migration/README.md`. Restoring them is not a spec change: it
   needs document storage and two write endpoints first.

   What survives is still worth having, and is the only tap-floor audit of any staff
   surface: the queue must degrade to stacked cards rather than a clipped table, those
   cards must be real touch targets, and the detail sheet must open cleanly on a phone.

   Runs under `mobile` (412x915) and `mobile-small` (360x640). */

const MIN_TAP = 44;

/* boundingBox() returns a float, and under full-suite load Chromium has handed back
   43.99993896484375 (= 44 - 2^-14) for a control whose CSS floor is exactly 44px --
   a measurement artifact, not a layout regression. The same half-pixel slack is
   already used in phase3.spec.js. It cannot mask the regression this file guards,
   which is 26px icon buttons. */
const TAP_EPSILON = 0.5;

/* Only this spec writes this string, so a card carrying it is *our* row and not a
   coincidence — and the assertions below can therefore be about layout rather than
   about which request happened to sort first. */
const OUR_FLAT = 'Field spec flat, Baner';

/* `valuation`, not `rental`, for the same reason `ops/live-drafting-desk.spec.js` uses it:
   `rent-agreement` is the one *priced* type, so it is created at `awaiting-payment` and
   `ServiceRequestRepository.findForQueue` excludes that status on purpose. A rental request
   seeded here would never reach the queue, and every assertion would pass vacuously against
   an empty desk. Valuation is free to file, so it is in the queue the moment it exists — and
   none of the rules here are about rent agreements, they are about a queue on a small screen. */
const TYPE = 'valuation';

/**
 * Create one request over HTTP, the way `live-drafting-desk.spec.js` does.
 *
 * The seeded database has users but no service requests, so a spec that merely opened the
 * desk would find an empty queue and pass its layout assertions by having nothing to lay out.
 * A throwaway raiser per run keeps repeat runs independent; an unknown mobile is auto-registered
 * as a buyer on first verify.
 */
async function seedRequest() {
  const { accessToken } = await apiLogin(uniqueMobile());
  const res = await fetch(`${API}/service-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      type: TYPE,
      details: { ownerName: 'Field Spec Owner', property: OUR_FLAT, purpose: 'Field spec valuation' },
    }),
  });
  const dto = await res.json();
  if (res.status >= 300) throw new Error(`create failed (${res.status}): ${JSON.stringify(dto)}`);
  return dto;
}

/** Sign the valuation staffer in and land on the desk, scoped to the type we seeded. */
async function openDesk(page, login) {
  await login.asStaff(TYPE);
  await page.goto(`/ops/drafting-desk?type=${TYPE}`);
  await expect(page.getByRole('heading', { name: 'Drafting desk' })).toBeVisible();
  // In live mode the screen must render the queue, not the offline panel.
  await expect(page.getByText(/needs the live API/i)).toHaveCount(0);
}

/** Our row as it appears on a phone: the queue's card renderer, matched on its own text. */
const ourCard = (page) => page.locator('button.dz-card').filter({ hasText: OUR_FLAT }).first();

test.describe('Drafting desk in the field', () => {
  test.beforeEach(async () => { await seedRequest(); });

  test('the queue falls back to stacked cards instead of a cut-off table', async ({ page, login }) => {
    await openDesk(page, login);

    // Table.jsx renders the mobileCard branch below `sm` and hides the grid; a
    // queue with no card renderer would be a horizontally-clipped table here.
    await expect(ourCard(page)).toBeVisible();
    await expect(page.getByRole('table')).toBeHidden();
  });

  test('a queue card is a real touch target, not a dense table row', async ({ page, login }) => {
    await openDesk(page, login);

    /* The card *is* the control — the desk has no separate "Open" button on a phone,
       which is the right call as long as the card itself is tappable. It carries three
       lines of content, so this cannot fail by accident; it fails if someone turns the
       card back into a row. */
    const card = ourCard(page);
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box, 'the card is laid out').not.toBeNull();
    expect(box.height, 'card height').toBeGreaterThanOrEqual(MIN_TAP - TAP_EPSILON);
  });

  test('every control in the open record clears the touch minimum', async ({ page, login }) => {
    /* The narrowed successor to the deleted document-action tests. It can no longer name
       the controls it expects, because the read-only checklist has none to name — so it
       sweeps whatever the sheet does render, and refuses to report a pass on an empty
       sweep. That guard is the whole point: without it this test passes loudest exactly
       when the sheet has failed to open. */
    await openDesk(page, login);
    await ourCard(page).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const undersized = await dialog.locator('button:visible, a[href]:visible').evaluateAll(
      (els, floor) => els
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
        .filter(({ r }) => r.height < floor)
        .map(({ el, r }) => `${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)} @${Math.round(r.height)}px`),
      MIN_TAP - TAP_EPSILON,
    );

    const total = await dialog.locator('button:visible, a[href]:visible').count();
    expect(total, 'the sheet must render controls, or this sweep proves nothing').toBeGreaterThan(0);
    expect(undersized, 'controls below the touch floor').toEqual([]);
  });

  test('the detail sheet logs no console errors on a phone', async ({ page, login, consoleErrors }) => {
    await openDesk(page, login);
    await ourCard(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
