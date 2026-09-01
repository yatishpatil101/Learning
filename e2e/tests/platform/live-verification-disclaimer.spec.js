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
 * ## Why the read-back is the migration assertion
 *
 * The buyer request now crosses the `documentService` seam: one POST carries every displayed
 * category, and `GET /me/document-requests` is the buyer's status source. That closes the defect
 * the old local implementation could not avoid: it keyed the write by `p.ownerMobile`, but a live
 * buyer only receives the owner's masked number, so the request was filed under a storage bucket
 * the owner's dashboard would never read. The assertion below stays on the rendered "Awaiting
 * owner" chips rather than a request body: it proves both halves — mutation and authenticated
 * read-back — agree on the row the buyer just wrote.
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
