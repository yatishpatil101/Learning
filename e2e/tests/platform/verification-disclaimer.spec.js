import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

// "Verified by Draazy" legal scope + the due-diligence acknowledgement, against the live API.
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

  await expect(page.getByText(/What .Verified by Draazy. means/i).first()).toBeVisible();
  await expect(page.getByText(/independent legal due diligence/i).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Read the full Disclaimer/i }).first())
    .toHaveAttribute('href', '/disclaimer');
});

test('"Request to view documents" is gated behind the due-diligence acknowledgement', async ({ page, login, consoleErrors }) => {
  await login.asBuyer();
  await openTrustTab(page, SALE);

  const request = page.getByRole('button', { name: /Request to view documents/i });
  await expect(request).toBeVisible();
  // Disabled *before* the acknowledgement is the whole assertion.
  await expect(request).toBeDisabled();

  await page.getByText(/independently verify these documents/i).click();
  await expect(request).toBeEnabled();

  await request.click();
  // The confirmation repeats the duty rather than just confirming receipt.
  await expect(page.getByText(/verify them independently before finalizing/i)).toBeVisible();
  // The UI must read back the acknowledged owner-doc request it filed.
  await expect(page.getByText('Awaiting owner').first()).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('a rental shows the deal-appropriate notice and offers no document request', async ({ page, login }) => {
  await login.asBuyer();
  await openTrustTab(page, RENT);

  await expect(page.getByText(/What .Verified by Draazy. means/i).first()).toBeVisible();
  await expect(page.getByText(/leave-.-license agreement/i).first()).toBeVisible();
  // Rentals have no title chain, so a request button would imply nonexistent papers.
  await expect(page.getByRole('button', { name: /Request to view documents/i })).toHaveCount(0);
});

test.describe('the anchor listings keep the documents section reachable', () => {
  test('both anchors report a document count', async ({ page }) => {
    // If `docsCount` reaches zero, the whole legal disclosure disappears.
    for (const slug of [SALE, RENT]) {
      const res = await page.request.get(`${API}/properties/${slug}`);
      expect(res.status()).toBe(200);
      expect((await res.json()).docsCount).toBeGreaterThan(0);
    }
  });
});
