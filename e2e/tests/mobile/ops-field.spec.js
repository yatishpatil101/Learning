import { test, expect } from '../../fixtures/live.js';
import { API, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';

/* The drafting desk is the one back-office surface genuinely used away from a desk; the rest of the
   back-office is desktop-first by design. Runs under `mobile` (412x915) and `mobile-small` (360x640). */

const MIN_TAP = 44;

/* boundingBox() returns a float, and under load Chromium has handed back 43.99993896484375 for a
   control whose CSS floor is exactly 44px. The regression guarded here is 26px icon buttons. */
const TAP_EPSILON = 0.5;

/* Only this spec writes this string, so a card carrying it is *our* row and not a coincidence. */
const OUR_FLAT = 'Field spec flat, Baner';

/* `valuation`, not `rental`: `rent-agreement` is the one *priced* type, created at
   `awaiting-payment`, which `ServiceRequestRepository.findForQueue` excludes on purpose. */
const TYPE = 'valuation';

/* The seeded database has users but no service requests, so a spec that merely opened the desk
 * would pass its layout assertions by having nothing to lay out. */
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

/** Sign the valuation staffer in and land on the valuation desk through the retired bookmark. */
async function openDesk(page, login) {
  await login.asStaff(TYPE);
  await page.goto(`/ops/drafting-desk?type=${TYPE}`);
  await expect(page).toHaveURL(/\/admin\/valuation/);
  await expect(page.getByRole('heading', { name: 'Property Valuation', level: 1 })).toBeVisible();
  // In live mode the screen must render the queue, not the offline panel.
  await expect(page.getByText(/needs the live API/i)).toHaveCount(0);
}

/** Our row as it appears on a phone: the queue's row card, matched on its own text. */
const ourCard = (page) => page.getByTestId('queue-row').filter({ hasText: OUR_FLAT }).first();

test.describe('Drafting desk in the field', () => {
  test.beforeEach(async () => { await seedRequest(); });

  test('the queue stacks into touch-sized cards and the open record is touch-sized and error-free', async ({ page, login, consoleErrors }) => {
    test.slow();
    await openDesk(page, login);

    await test.step('the queue renders stacked row cards instead of a cut-off table', async () => {
      await expect(ourCard(page)).toBeVisible();
      await expect(page.getByRole('table')).toBeHidden();
    });

    await test.step('a queue card is a real touch target, not a dense table row', async () => {
      /* The card carries three lines of content, so this fails only if someone turns it back into a dense row. */
      const box = await ourCard(page).boundingBox();
      expect(box, 'the card is laid out').not.toBeNull();
      expect(box.height, 'card height').toBeGreaterThanOrEqual(MIN_TAP - TAP_EPSILON);
    });

    await test.step('every control in the open record clears the touch minimum', async () => {
      /* The read-only checklist has no named controls, so this sweeps whatever the sheet renders and
         refuses to report a pass on an empty sweep — otherwise it passes loudest when nothing opened. */
      await ourCard(page).getByRole('button', { name: 'Open', exact: true }).click();

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

    expect(consoleErrors).toEqual([]);
  });
});
