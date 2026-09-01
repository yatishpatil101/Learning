/**
 * The one thing left in mock mode about the flatmate verification desk: that it says why it is
 * shut.
 *
 * This file used to drive the ops desk to produce a host's three verification states — seed a
 * `pending` review into `localStorage`, click Approve or Reject on the desk, then walk to
 * `/flatmates` and read the card. That worked only while the desk was a `localStorage` screen. It
 * is now backed by `flatmateService`, which in mock mode refuses the ops queues outright: there is
 * no mock behind them, and a mock that answered would be modelling a third of the desk while
 * claiming to model all of it.
 *
 * The three card tests were then cut at the seam and re-seeded here as consumer tests, reading a
 * review row planted directly in the state under test. That was the best mock mode could do, and it
 * was never much: seeding `puneNestFlatmateReviews` and then asserting the card renders it is a
 * test of the renderer, not of the verdict. It also asserted a fact the browser had no way to know
 * — the map was written to the *reviewer's* browser and was empty on every other machine in the
 * world.
 *
 * They are gone now, not moved, because that hole was fixed rather than worked around and the fix
 * came with its own tests. `reviewStatus` is joined onto the feed server-side
 * ({@code FlatmateReviewStatuses}), and `consumer/flatmates/live-review-status.spec.js` owns all
 * three labels against the real server — 'a tenant group waiting on Ops says so, and is not given
 * the badge it asked for', 'an Ops approval turns the same group into Tenant-verified', and 'a
 * rejected group stays on the board and says the review failed'. Each of those posts a group over
 * HTTP, publishes it through real moderation, finds its row in the Ops queue, decides it as Ops
 * would, and only then reads the card — so the label is proved to be *earned* rather than merely
 * rendered, which is the product claim. Two of them also assert the chip the card must no longer
 * carry. Porting the seeded versions alongside would have added a weaker restatement of each.
 *
 * What is left is the load-bearing one, and it can only be checked here: the desk is never shut
 * live, so only mock mode can ask what it says when it is. A queue that always looked empty would
 * be indistinguishable from a cleared backlog.
 *
 * ## Verdict: HONOURED (1 test)
 *
 * The desk is never shut live, so only mock mode can ask what it says when it is. A queue that
 * always looked empty would be indistinguishable from a cleared backlog; the shut panel is the
 * distinction.
 */
import { expect, test } from '../../fixtures/base.js';

const STAFF = '9900000009';

test('the ops desk says it needs the live API rather than showing an empty queue', async ({ page }) => {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Ops Staff', mobile: m, role: 'staff', loginAt: Date.now() }));
  }, STAFF);
  await page.goto('/ops/flatmate-review');

  await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toBeVisible();
  await expect(page.getByText(/needs the live API/i)).toBeVisible();
  await expect(page.getByText(/could only model a third of the desk/i)).toBeVisible();

  // No queue, and nothing to press. Both matter: a disabled desk that still rendered a table would
  // invite a moderator to believe the backlog was clear.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
});
