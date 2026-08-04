import { test, expect } from '../../../fixtures/base.js';

// Consumer Support (tickets + FAQ) — /support is behind ProtectedRoute; /contact is public.
// Behaviour verified from: pages/consumer/Support.jsx (+ support/*), lib/data/support.js,
// components/RouteGuards.jsx (redirect to /signin), and en/misc2.json / misc1.json labels.

// The global cookie-consent banner is also role="dialog"; seed consent so it never
// overlays the page or collides with the ticket-thread dialog lookup.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Consumer Support — tickets + FAQ', () => {
  test('guards /support: an unauthenticated visitor is redirected to /signin', async ({ page }) => {
    await page.goto('/support');
    // ProtectedRoute redirects to /signin?next=/support (see RouteGuards.jsx).
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    // The support surface must not render for a signed-out user.
    await expect(page.getByRole('heading', { name: 'Help & Support' })).toHaveCount(0);
  });

  test('a signed-in buyer sees the support UI: ticket form, contact card and FAQ', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/support');

    await expect(page.getByRole('heading', { name: 'Help & Support' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Raise a new ticket' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit ticket' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your tickets' })).toBeVisible();
    // FAQ section renders from getFaqs() (self-serve first).
    await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();
  });

  test('shows the empty state when the user has no tickets yet', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/support');
    await expect(page.getByText('No tickets yet')).toBeVisible();
    await expect(page.getByText("Raise a ticket and it'll show up here.")).toBeVisible();
  });

  test('creating a ticket opens the thread and lists it (empty state clears)', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/support');

    // Buyer name + mobile are prefilled; category defaults to "payment". Only
    // subject (>=4) and message (>=8) are needed to pass Support.submit validation.
    const subject = 'Refund not received for booking';
    await page.getByPlaceholder('Brief summary of your issue').fill(subject);
    await page
      .getByPlaceholder('Share as much detail as you can so we can help faster.')
      .fill('I paid for a visit booking but the refund has not arrived yet.');
    await page.getByRole('button', { name: 'Submit ticket' }).click();

    // A successful create opens the thread modal with a server-style SUP-<seq> id.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/SUP-\d+/)).toBeVisible();
    await expect(dialog.getByText('I paid for a visit booking but the refund has not arrived yet.')).toBeVisible();

    // Close the thread; the new ticket now appears in the list and the empty state is gone.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('No tickets yet')).toHaveCount(0);
    await expect(page.getByText(subject)).toBeVisible();
    await expect(page.getByText(/SUP-\d+/).first()).toBeVisible();
  });

  test('loads the support page with no real console errors', async ({ page, login, consoleErrors }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/support');
    await expect(page.getByRole('heading', { name: 'Help & Support' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('/contact is public and renders the enquiry form for a signed-out visitor', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto('/contact');
    await expect(page.getByRole('heading', { name: 'Get in touch' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Send an enquiry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send enquiry' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
