// @ts-check
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

/* Everything upstream of Pay. The catalogue's paid-plan prices are the admin fee schedule's, so the
   page quotes the same figure whether the catalogue or its `pricing` fallback rendered it. */

/** What Owner Plus costs, in both tables. Formatted as the page formats it (`en-IN` grouping). */
const OWNER_PLUS = '₹999';
/** Owner Pro's price. Note it is Owner Plus's *old*, drifted catalogue figure — see `SENTINEL` below. */
const OWNER_PRO = '₹2,499';

/** A price in neither table, via intercepting the catalogue: catalogue and fee schedule quote the same numbers, so
 * only a sentinel shows which was read. It must not collide with any real price on the page. */
const SENTINEL = 111777;
const SENTINEL_TEXT = '₹1,11,777';

/** Serves the catalogue with `name`'s price replaced; keyed on `name` because the slug is derived by `planMapper`
 * and is not on the wire. The caller must run the returned assertion. */
async function catalogueQuoting(page, name, price) {
  let substituted = false;
  await page.route('**/api/bootstrap', async (route) => {
    const res = await route.fetch();
    const doc = await res.json();
    if (!doc.plans.some((r) => r.name === name)) {
      throw new Error(`the catalogue carries no plan named "${name}", so nothing was substituted`);
    }
    substituted = true;
    await route.fulfill({
      response: res,
      json: { ...doc, plans: doc.plans.map((r) => (r.name === name ? { ...r, price } : r)) },
    });
  });
  /* Every caller must assert this: a glob that stops matching silently serves the real catalogue. */
  return () => expect(substituted, `the ${name} price was never substituted — check the route glob`).toBe(true);
}

/* The global cookie banner is also role="dialog" and can overlay the plan-card CTAs. Seeding consent
   is presentation-only — it just stops an unrelated overlay from deciding whether a click lands. */
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('LIVE: plans, pricing and the checkout hand-off', () => {
  test('the catalogue and the fee schedule quote the same owner prices', async () => {
    /* `AdminFeesPriceEverySurfaceTest` pins this in the backend suite; repeated here against the
       database the rest of this file talks to. */
    const { plans, pricing } = await (await fetch(`${API}/bootstrap`)).json();

    const priceOf = (name) => {
      const plan = plans.find((p) => p.name === name);
      expect(plan, `the seeded catalogue must carry a plan named ${name}`).toBeTruthy();
      return plan.price;
    };

    expect(priceOf('Owner Plus'), 'Owner Plus is charged the catalogue price, so the schedule the page\n'
      + 'falls back to must name the same number').toBe(pricing.ownerPlanYearly);
    expect(priceOf('Owner Pro')).toBe(pricing.ownerProYearly);
    // And they are the numbers this file asserts on screen, so a repricing fails here rather than
    // in four separate UI assertions whose messages would blame the rendering.
    expect(priceOf('Owner Plus')).toBe(999);
    expect(priceOf('Owner Pro')).toBe(2499);
  });

  test('/plans is public and quotes the catalogue price on the cards and in the FAQ, and /checkout sends a signed-out visitor to sign-in', async ({ page }) => {
    await page.context().clearCookies();
    await seedConsent(page);
    /* The catalogue differs from the fee schedule, so the card's price identifies which table was read. */
    const substituted = await catalogueQuoting(page, 'Owner Plus', SENTINEL);
    await page.goto('/plans');

    await expect(page.getByRole('heading', { name: 'Plans & Pricing' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'For seekers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'For owners' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get Seeker Plus' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upgrade to Owner Plus' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go Pro' }).first()).toBeVisible();

    /* Polled, not asserted once: the first paint legitimately shows the fallback. What must not survive is the
       fallback still being on screen once the catalogue has landed. */
    await expect.poll(
      async () => page.getByText(SENTINEL_TEXT, { exact: false }).count(),
      { timeout: 20000, message: 'the Owner Plus card never showed the catalogue price' },
    ).toBeGreaterThan(0);
    // ?999 is the fee-schedule price: seeing it means the catalogue read was skipped.
    await expect(page.getByText(OWNER_PLUS, { exact: false })).toHaveCount(0);
    // The untouched rows still come through the same read, so this is not an interceptor that
    // replaced the catalogue with one plan.
    await expect(page.getByText(OWNER_PRO, { exact: false }).first()).toBeVisible();

    // The answers live in collapsed `<details>` cards, so open the one quoting the plan prices.
    // Clicking the summary rather than setting `open` keeps this honest about the disclosure.
    const question = page.getByText('What do the owner plans cost?');
    await expect(question).toBeVisible({ timeout: 20000 });
    await question.click();

    const faq = page.getByText(/Owner Plus is .* per year and Owner Pro is .* per year/);
    await expect(faq).toBeVisible({ timeout: 20000 });

    // With both tables agreeing, an FAQ that had gone back to reading the fee schedule would quote
    // the right number anyway, so it too is checked against the substituted catalogue.
    await expect.poll(
      async () => (await faq.textContent())?.replace(/\s+/g, ' ').trim() ?? '',
      { timeout: 20000, message: 'the FAQ never picked up the catalogue prices' },
    ).toContain(`Owner Plus is ${SENTINEL_TEXT} per year`);
    // Owner Pro stays at its real price: the substitution replaced one row, not the whole catalogue.
    await expect(faq).toContainText(`Owner Pro is ${OWNER_PRO} per year`);
    substituted();

    await page.goto('/checkout?plan=owner2');
    await expect(page).toHaveURL(/\/signin/);
    // A guard that bounced to a bare /signin would strand the customer on the dashboard mid-purchase.
    await expect(page).toHaveURL(/next=.*checkout.*owner2/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toHaveCount(0);
  });

  test('a new account is on the free tier, and its plan CTA hands off to checkout where the Pay button quotes the same price the card did', async ({ page }) => {
    /* A fresh account, because a seeded actor's subscription state is an invariant other specs rely on — and
       it is the only way to be sure the re-purchase guard is not what renders. */
    const mobile = await signedInAsNew(page);
    /* The wire half first: a 404 would render the same free tier through the catch path, so the UI assertion
       alone cannot tell an empty document from an error. */
    const res = await fetch(`${API}/me/subscription`, { headers: await authHeaders(mobile) });
    expect(res.status).toBe(200);
    const sub = await res.json();
    expect(sub?.status ?? null, 'a brand-new account must hold no subscription').not.toBe('active');

    await seedConsent(page);
    const substituted = await catalogueQuoting(page, 'Owner Plus', SENTINEL);
    await page.goto('/plans');
    // The badge renders in both the hidden mobile carousel and the visible desktop grid, so take
    // the desktop one (last in DOM).
    await expect(page.getByText('Current plan').last()).toBeVisible({ timeout: 20000 });
    // A "Current plan" lock on a plan nobody bought would be an entitlement bug.
    await expect(page.getByRole('link', { name: 'Upgrade to Owner Plus' }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Upgrade to Owner Plus' }).first().click();

    await expect(page).toHaveURL(/\/checkout\?plan=owner2/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Owner', exact: true })).toBeVisible();
    await expect(page.getByText('Order summary')).toBeVisible();

    // Both pages resolve the catalogue independently; the substituted price makes agreement a catalogue claim.
    const payButton = page.getByRole('button', { name: /^Pay ₹/ });
    await expect.poll(
      async () => (await payButton.first().textContent())?.trim() ?? '',
      { timeout: 20000, message: 'the Pay button never picked up the catalogue price' },
    ).toContain(SENTINEL_TEXT);
    await expect(page.getByRole('button', { name: new RegExp(`Pay ${OWNER_PLUS}`) })).toHaveCount(0);
    substituted();
  });

  test('a second checkout while an order is still unpaid names that order, instead of inviting a retry that cannot work; an unknown plan goes back to /plans', async ({ page }) => {
    /* The server caps a user at one open unpaid order and answers 409, so a generic "please try again" tells
       the customer to retry from the one state where retrying cannot work. */
    await signedInAsNew(page);
    await seedConsent(page);

    await page.goto('/checkout?plan=not-a-plan');
    await expect(page).toHaveURL(/\/plans$/);
    await expect(page.getByRole('heading', { name: 'Plans & Pricing' })).toBeVisible({ timeout: 20000 });

    await page.goto('/checkout?plan=owner2');
    await page.getByRole('button', { name: /^Pay ₹/ }).first().click();
    // The mock gateway hands back a `mock_session_*`, which the checkout lib short-circuits, so the
    // page settles on the pending screen without a real hosted checkout being opened.
    await expect(page.getByRole('heading', { name: 'Payment pending' })).toBeVisible({ timeout: 20000 });

    await page.goto('/checkout?plan=owner5');
    await page.getByRole('button', { name: /^Pay ₹/ }).first().click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('You already have an order waiting for payment', { timeout: 20000 });
    // The regression itself: the generic copy is what shipped, and it reads as though one more tap
    // would work. Asserting the new message alone would still pass if both were rendered.
    await expect(alert).not.toContainText('please try again');
  });

  test('the plan cards state the seeded entitlements, with listing counts read from the catalogue', async ({ page }) => {
    await page.context().clearCookies();
    await seedConsent(page);
    const { plans } = await (await fetch(`${API}/bootstrap`)).json();
    const limit = (name) => plans.find((p) => p.name === name).listingLimit;
    await page.goto('/plans');

    const card = (name) => page.locator('h3', { hasText: new RegExp(`^${name}$`) }).last().locator('xpath=ancestor::div[contains(@class,"glass")][1]');
    await expect(card('Seeker Free')).toContainText('15 owner contacts in total', { timeout: 20000 });
    await expect(card('Seeker Plus')).toContainText('Unlimited owner contacts');
    await expect(card('Owner Free')).toContainText('Verified owner badge');
    await expect(card('Owner Plus')).toContainText(`List up to ${limit('Owner Plus')} properties`);
    await expect(card('Owner Plus')).not.toContainText('Verified owner badge');
    await expect(card('Owner Pro')).toContainText(`List up to ${limit('Owner Pro')} properties`);
    await expect(card('Owner Pro')).toContainText('Rent agreement included');
  });

  test('a held paid plan carries its own listing limit, not the one-listing floor', async ({ page }) => {
    await signedInAsNew(page);
    await seedConsent(page);
    const { plans } = await (await fetch(`${API}/bootstrap`)).json();
    const pro = plans.find((p) => p.name === 'Owner Pro');
    await page.route('**/api/me/subscription', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ json: { id: 's1', planId: pro.id, status: 'active', paymentRef: null, paymentSessionId: null } })
      : route.continue()));
    await page.goto('/dashboard#billing');
    await expect(page.getByText(`Up to ${pro.listingLimit} properties`)).toBeVisible({ timeout: 20000 });
  });
});
