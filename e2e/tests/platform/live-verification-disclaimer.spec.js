import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

/* "Verified by PuneNest" legal scope + the due-diligence acknowledgement, against the live API.
 *
 * This is a **legal** spec, not a feature spec: what it guards is that the platform's verification
 * badge is never presented as a substitute for a buyer's own title check. That is a promise made in
 * copy, and copy is the one thing a backend migration can silently break — the section only renders
 * when `docsCount > 0`, so a listing that loses its document count loses the disclaimer with it and
 * every gate below it, without a single error.
 *
 * The anchors are registry rows rather than the old `P5013`/`P5014` mock ids: `p5021` is the buy
 * side (5 documents) and `p5015` the rent side (4). The deal split is the subject, not scenery —
 * a sale surfaces owner-gated title papers a buyer's lawyer checks, a rental surfaces only proof of
 * ownership, and showing a tenant sale-only papers that were never collected is the failure mode.
 *
 * ## What is deliberately still client-side
 *
 * The `document` domain has not flipped yet (see `docs/system/fixture-registry.md`). The buyer-side
 * request does not go through the service seam at all: `DocumentsSection` calls `addDocRequest`
 * from `lib/data/documents.js`, which writes to `localStorage`. So this spec asserts the gate and
 * the acknowledgement through the **UI's own read-back** rather than by scanning storage keys the
 * way the seeded version did. Two reasons, and the second is the important one:
 *
 *   1. Those keys are deleted in P5c, so a storage assertion is work that has to be redone.
 *   2. Scanning *every* `puneNestDocReq:*` bucket hid a live defect. The request is filed under
 *      `p.ownerMobile`, which on the live detail read is the **masked** number ("94XXXXX469") until
 *      the contact gate is passed, while the owner's dashboard reads its requests under the real
 *      one. Live, a buyer's document request is therefore filed where its owner will never look.
 *      The fix is the endpoint the document flip brings, not an unmask, so it is recorded in
 *      `docs/migration/README.md` rather than papered over here.
 */

const SALE = 'p5021';
const RENT = 'p5015';

const trustTab = (page) => page.getByRole('tab', { name: /Verification & Docs/i });

async function openTrustTab(page, slug) {
  await page.goto(`/property/${slug}`);
  await trustTab(page).click();
  // Scroll-reveal animations gate visibility on an IntersectionObserver that never fires for
  // off-screen content in a headless run.
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
}

test('the sale trust tab carries the verification-scope disclaimer and links to the full one', async ({ page, login }) => {
  await login.asBuyer();
  await openTrustTab(page, SALE);

  await expect(page.getByText(/What .Verified by PuneNest. means/i).first()).toBeVisible();
  await expect(page.getByText(/independent legal due diligence/i).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Read the full Disclaimer/i }).first())
    .toHaveAttribute('href', '/disclaimer');
});

test('"Request to view documents" is gated behind the due-diligence acknowledgement', async ({ page, login, consoleErrors }) => {
  await login.asBuyer();
  await openTrustTab(page, SALE);

  const request = page.getByRole('button', { name: /Request to view documents/i });
  await expect(request).toBeVisible();
  /* Disabled *before* the acknowledgement is the whole assertion. A buyer who can request papers
   * without reading the scope notice has been told nothing, and the platform has no answer to
   * "nobody warned me" — which is the one claim this entire tab exists to pre-empt. */
  await expect(request).toBeDisabled();

  await page.getByText(/independently verify these documents/i).click();
  await expect(request).toBeEnabled();

  await request.click();
  // The confirmation repeats the duty rather than just confirming receipt.
  await expect(page.getByText(/verify them independently before finalizing/i)).toBeVisible();
  /* And the request is recorded: every document flips to "Awaiting owner", which is the UI reading
   * back the acknowledged request it just filed. Asserted through the rendered state so it keeps
   * meaning the same thing after the document domain moves server-side. */
  await expect(page.getByText('Awaiting owner').first()).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('a rental shows the deal-appropriate notice and offers no document request', async ({ page, login }) => {
  await login.asBuyer();
  await openTrustTab(page, RENT);

  await expect(page.getByText(/What .Verified by PuneNest. means/i).first()).toBeVisible();
  await expect(page.getByText(/leave-.-license agreement/i).first()).toBeVisible();
  /* No request button on a rental: there is no title chain for a tenant to inspect, so offering
   * the action would imply papers exist that were never collected. */
  await expect(page.getByRole('button', { name: /Request to view documents/i })).toHaveCount(0);
});

test.describe('the anchor listings keep the documents section reachable', () => {
  test('both anchors report a document count', async ({ page }) => {
    /* The section is `if (!count) return null`, so `docsCount` reaching zero deletes the
     * disclaimer, the acknowledgement and the gate in one step — and every assertion above would
     * then fail as "element not found", which reads like a locator problem rather than a listing
     * that quietly stopped making its legal disclosure. This test names the real cause. */
    for (const slug of [SALE, RENT]) {
      const res = await page.request.get(`${API}/properties/${slug}`);
      expect(res.status()).toBe(200);
      expect((await res.json()).docsCount).toBeGreaterThan(0);
    }
  });
});
