import { test, expect } from '../../../fixtures/base.js';

// Plans → Checkout → subscription/order state. Behaviour verified from:
//   pages/consumer/Plans.jsx (persona cards, CTAs → /checkout?plan=<id>),
//   pages/consumer/Checkout.jsx (pay → a `pending` subscription; `paid` requires
//     status === 'active', alreadyOnThisPlan re-purchase guard,
//     unknown-plan → Navigate('/plans')),
//   services/providers/mock/planProvider.js (priced plan → `pending`;
//     `mockActivateSubscription` is the local stand-in for the payment webhook),
//   lib/store/billing.js (pnPlan:<mobile> key),
//   components/RouteGuards.jsx (/checkout is ProtectedRoute → /signin?next=),
//   i18n en/misc1.json (plans*) and en/misc2.json (co*).
//
// The load-bearing rule across this file: buying does not grant. Paying opens a gateway
// order; only the payment webhook moves the subscription to `active`. No browser can make
// that happen — one that could would be one that can grant itself a paid plan.
//
// The owner demo user's mobile is 9876500002 (helpers/seed.js), so the per-user
// plan store is keyed pnPlan:9876500002.
const OWNER_MOBILE = '9876500002';

// The global cookie-consent banner is also role="dialog"; seed consent so it
// never overlays the plan-card CTAs or the checkout page.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Plans, Checkout & subscription state', () => {
  test('guards /checkout: a signed-out visitor is redirected to /signin with next', async ({ page }) => {
    await page.goto('/checkout?plan=owner2');
    // ProtectedRoute redirects to /signin?next=/checkout?plan=owner2.
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    await expect(page).toHaveURL(/checkout/);
    // The checkout surface must not render for a signed-out user.
    await expect(page.getByRole('heading', { name: 'Checkout' })).toHaveCount(0);
  });

  test('/plans is public and renders both persona plan sets with CTAs', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto('/plans');

    await expect(page.getByRole('heading', { name: 'Plans & Pricing' })).toBeVisible();
    // Desktop grid renders both persona sections (seeker + owner).
    await expect(page.getByRole('heading', { name: 'For seekers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'For owners' })).toBeVisible();
    // Paid-plan CTAs link into the checkout flow.
    await expect(page.getByRole('link', { name: 'Get Seeker Plus' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upgrade to Owner Plus' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go Pro' }).first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('initial state: a signed-in owner is on the free tier (Current plan badge)', async ({ page, login }) => {
    await login.asOwner();
    await seedConsent(page);
    await page.goto('/plans');
    // Default plan id is 'free' for everyone; the owner's free tier is marked current.
    // The badge renders in both the hidden mobile carousel and the visible desktop
    // grid (last in DOM), so assert the visible desktop one.
    await expect(page.getByText('Current plan').last()).toBeVisible();
    // No paid subscription persisted yet.
    const plan = await page.evaluate((m) => localStorage.getItem('pnPlan:' + m), OWNER_MOBILE);
    expect(plan).toBeNull();
  });

  test('selecting a plan on /plans navigates into the checkout order summary', async ({ page, login }) => {
    await login.asOwner();
    await seedConsent(page);
    await page.goto('/plans');

    await page.getByRole('link', { name: 'Upgrade to Owner Plus' }).first().click();

    await expect(page).toHaveURL(/\/checkout\?plan=owner2/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Owner', exact: true })).toBeVisible();
    await expect(page.getByText('Order summary')).toBeVisible();
    await expect(page.getByRole('button', { name: /Pay ₹999/ })).toBeVisible();
  });

  // The rule this test exists to protect: **the browser cannot activate a paid plan — only the
  // payment webhook can.** Paying opens a gateway order and leaves the subscription `pending`;
  // entitlement arrives later, out-of-band, signature-verified. A client that could flip its own
  // subscription to `active` is a client that can grant itself a paid plan for free.
  test('paying leaves the plan pending — only the webhook activates it', async ({ page, login }) => {
    await login.asOwner();
    await seedConsent(page);
    await page.goto('/checkout?plan=owner2');

    await expect(page.getByRole('button', { name: /Pay ₹999/ })).toBeVisible();
    await page.getByRole('button', { name: /Pay ₹999/ }).click();

    // Pending, not paid. Telling someone the purchase landed before the money has is the one
    // outcome Checkout.jsx is designed against, so the copy asserted here is the honest one.
    await expect(page.getByRole('heading', { name: 'Payment pending' })).toBeVisible();
    await expect(page.getByText(/waiting for your bank to confirm/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment successful!' })).toHaveCount(0);
    // The gateway reference is shown so the customer can chase the payment. It is the server's
    // `paymentRef` — the id the bank and the gateway both know the order by. It used to fall back
    // to a `so<timestamp>` minted by the browser and written to `pnServiceOrders:<mobile>`, which
    // no screen in the app ever read back, so the "reference" was unlookupable by anyone the
    // customer could have quoted it to (D236).
    await expect(page.getByText('Order reference')).toBeVisible();
    await expect(page.getByText(/mock-order-\d+/)).toBeVisible();

    // The entitlement key is the thing that must NOT have moved: `pnPlan:<mobile>` stays empty
    // until the webhook says the money arrived.
    const beforeWebhook = await page.evaluate((m) => ({
      plan: JSON.parse(localStorage.getItem('pnPlan:' + m) || 'null'),
      orders: localStorage.getItem('pnServiceOrders:' + m),
    }), OWNER_MOBILE);
    expect(beforeWebhook.plan).toBeNull();
    // Nothing writes a browser-local order any more.
    expect(beforeWebhook.orders).toBeNull();

    // Now play the webhook. `mockActivateSubscription` is the mock provider's stand-in for it and
    // has no http counterpart on purpose (see providers/mock/planProvider.js), so the spec reaches
    // for the provider directly rather than through planService — there is nothing to reach for
    // in the service contract, which is exactly the point.
    const activated = await page.evaluate(async () => {
      const m = await import('/src/services/providers/mock/planProvider.js');
      return m.mockActivateSubscription();
    });
    expect(activated.status).toBe('active');
    expect(activated.id).toBe('owner2');

    // Only now does the subscription persist to pnPlan:<mobile>.
    const afterWebhook = await page.evaluate((m) => JSON.parse(localStorage.getItem('pnPlan:' + m) || 'null'), OWNER_MOBILE);
    expect(afterWebhook?.id).toBe('owner2');

    // Re-visiting the same plan now short-circuits to the already-active screen
    // (the re-purchase guard proves the webhook's grant is durable).
    await page.goto('/checkout?plan=owner2');
    await expect(page.getByRole('heading', { name: "You're already on this plan" })).toBeVisible();
  });

  test('checkout with an unknown plan param redirects back to /plans', async ({ page, login }) => {
    await login.asOwner();
    await seedConsent(page);
    await page.goto('/checkout?plan=not-a-plan');
    await expect(page).toHaveURL(/\/plans$/);
    await expect(page.getByRole('heading', { name: 'Plans & Pricing' })).toBeVisible();
  });
});
