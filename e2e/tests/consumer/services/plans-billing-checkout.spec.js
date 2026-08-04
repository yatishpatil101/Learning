import { test, expect } from '../../../fixtures/base.js';

// Plans → Checkout → subscription/order state. Behaviour verified from:
//   pages/consumer/Plans.jsx (persona cards, CTAs → /checkout?plan=<id>),
//   pages/consumer/Checkout.jsx (simulated pay → setPlan + addServiceOrder,
//     alreadyOnThisPlan re-purchase guard, unknown-plan → Navigate('/plans')),
//   lib/store/billing.js (pnPlan:<mobile> + pnServiceOrders:<mobile> keys),
//   components/RouteGuards.jsx (/checkout is ProtectedRoute → /signin?next=),
//   i18n en/misc1.json (plans*) and en/misc2.json (co*).
//
// The owner demo user's mobile is 9876500002 (helpers/seed.js), so the per-user
// plan/order stores are keyed pnPlan:9876500002 / pnServiceOrders:9876500002.
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

  test('completing checkout activates the subscription and records the order', async ({ page, login }) => {
    await login.asOwner();
    await seedConsent(page);
    await page.goto('/checkout?plan=owner2');

    await expect(page.getByRole('button', { name: /Pay ₹999/ })).toBeVisible();
    await page.getByRole('button', { name: /Pay ₹999/ }).click();

    // Simulated gateway round-trip → success screen with an order reference.
    await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible();
    await expect(page.getByText('Order reference')).toBeVisible();
    await expect(page.getByText(/so\d+/)).toBeVisible();

    // Subscription state persists to pnPlan:<mobile>; the order lands in pnServiceOrders.
    const state = await page.evaluate((m) => ({
      plan: JSON.parse(localStorage.getItem('pnPlan:' + m) || 'null'),
      orders: JSON.parse(localStorage.getItem('pnServiceOrders:' + m) || '[]'),
    }), OWNER_MOBILE);
    expect(state.plan?.id).toBe('owner2');
    expect(state.orders.length).toBeGreaterThanOrEqual(1);
    expect(state.orders[0]).toMatchObject({ type: 'subscription', plan: 'owner2' });

    // Re-visiting the same plan now short-circuits to the already-active screen
    // (the re-purchase guard proves the subscription is durable).
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
