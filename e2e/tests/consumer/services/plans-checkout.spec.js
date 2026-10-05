// @ts-check
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

/* Everything upstream of Pay. The catalogue's paid-plan prices are the admin fee schedule's, so the
   page quotes the same figure whether the catalogue or its `/pricing` fallback rendered it. */

/** What Owner Plus costs, in both tables. Formatted as the page formats it (`en-IN` grouping). */
const OWNER_PLUS = '₹999';
/** Owner Pro's price. Note it is Owner Plus's *old*, drifted catalogue figure — see `SENTINEL` below. */
const OWNER_PRO = '₹2,499';

/**
 * A price in neither table, served by intercepting the catalogue.
 *
 * The catalogue and the fee schedule now quote the same numbers, so an assertion on a price alone
 * passes whichever table was read — the fallback could silently become the only live path and
 * every price assertion here would stay green.
 *
 * Substituting a sentinel restores the distinction without depending on the two tables differing,
 * so it survives the next price change too. It must not collide with any real price on the page —
 * ₹999 and ₹2,499 are owner plans, ₹199 is Seeker Plus, ₹4,999 is Packers & Movers.
 */
const SENTINEL = 111777;
const SENTINEL_TEXT = '₹1,11,777';

/**
 * Serve the plan catalogue with `name`'s price replaced, leaving every other field untouched.
 *
 * Keyed on the server's `name` rather than the app's `slug` because the slug does not exist on the
 * wire — `planMapper` derives it from the name — so this intercepts the response the mapper is
 * about to read, which is the point at which a card that ignored the catalogue would diverge.
 *
 * Returns an assertion the caller must run at the end of the test: see the comment on it below.
 */
async function catalogueQuoting(page, name, price) {
  let substituted = false;
  await page.route('**/api/plans', async (route) => {
    const res = await route.fetch();
    const rows = await res.json();
    if (!rows.some((r) => r.name === name)) {
      throw new Error(`the catalogue carries no plan named "${name}", so nothing was substituted`);
    }
    substituted = true;
    await route.fulfill({
      response: res,
      json: rows.map((r) => (r.name === name ? { ...r, price } : r)),
    });
  });
  /* Every caller must assert this. A glob that stops matching — a query string appended, the path
     versioned — silently serves the real catalogue, and the price poll below then fails as "the
     card never showed the catalogue price", which blames the application for a broken fixture. */
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
    const plans = await (await fetch(`${API}/plans`)).json();
    const pricing = await (await fetch(`${API}/pricing`)).json();

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
    /* The catalogue is made to say something the fee schedule does not, so "the card shows this"
       identifies *which* table was read. Quoting the seeded price would not: the two agree, so the
       fallback renders the same figure and a card that never heard from the catalogue would pass. */
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
    // ₹999 is the fee-schedule number for this same plan. Seeing it while the catalogue says
    // otherwise means the catalogue read was skipped and the customer is being quoted something
    // they will not be billed.
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

    // The two pages resolve the catalogue independently, so agreeing is a real claim: a customer
    // shown one price on the card and charged another at the button is what both reads prevent.
    // The substituted price is what makes it a claim about the *catalogue* rather than about any
    // number being rendered — the fallback would otherwise quote the same ₹999 and pass.
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
});
