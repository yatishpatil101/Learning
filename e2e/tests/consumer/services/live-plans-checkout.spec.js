// @ts-check
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { signedInAs, signedInAsNew, apiLogin, authHeaders, API } from '../../../helpers/liveAuth.js';

/*
 * Plans and Checkout against the real API.
 *
 * ## What this file exists to catch, that the mock twin structurally could not
 *
 * The mock asserted a "Pay ₹999" button. Against this backend that assertion is not merely
 * unverified — it is **the bug**. Two different tables answer "what does Owner Plus cost":
 *
 *   GET /pricing  ->  ownerPlanYearly: 999    (the back-office fee schedule, the FALLBACK)
 *   GET /plans    ->  "Owner Plus", price: 2499  (the catalogue, what is actually CHARGED)
 *
 * Both `Plans.jsx` (`priced()`, L233) and `Checkout.jsx` (`serverPrice`, L44-58) resolve the
 * catalogue and fall back to the fee only while it is unreachable. `Checkout.jsx:57` names the
 * incident in its own words: "Showing the back-office fee here was how a customer came to click
 * 'Pay ₹999' and be billed ₹2,499."
 *
 * A regression that dropped either catalogue read renders ₹999 — a live, reachable mis-quote of a
 * real charge. The mock build has no catalogue at all, so its ₹999 assertion would go **green on
 * exactly that defect**. That is the whole reason this conversion was worth doing rather than
 * carrying the mock forward.
 *
 * ## Scope: the pay path is deliberately NOT here
 *
 * `live-property-integration.spec.js:1841` already owns "buying a paid plan leaves it pending, and
 * the entitlement it gates stays shut" — it drives Pay, reads `POST /me/subscription` off the wire,
 * and checks the `#billing` gate. Repeating it would add a second writer of subscription rows to a
 * database that lives for the whole run, for no new claim. So this file covers everything
 * *upstream* of Pay, which is precisely the half nothing live was asserting:
 * the route guard, the public catalogue, the price the customer is quoted, the CTA hand-off, and
 * the unknown-plan redirect.
 *
 * `live-property-integration.spec.js:1821` does assert `GET /plans` is called and the page renders
 * for a signed-out visitor — but it asserts only that *a* heading appeared. It never looks at a
 * price, a persona section or a CTA, so the page could quote any number and still pass it.
 */

/** The catalogue price of Owner Plus, and the fee-schedule number it must never be confused with. */
const OWNER_PLUS_CHARGED = '₹2,499';
const OWNER_PLUS_FALLBACK_FEE = '₹999';
/** Owner Pro's catalogue price. Its fee-schedule number is ₹2,499 — Owner Plus's real price. */
const OWNER_PRO_CHARGED = '₹4,999';

/*
 * The global cookie banner is also role="dialog" and can overlay the plan-card CTAs. Seeding
 * consent is presentation-only — it changes nothing this file asserts, it just stops an unrelated
 * overlay from deciding whether a click lands.
 */
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('LIVE: plans, pricing and the checkout hand-off', () => {
  test('the catalogue and the fee schedule really do disagree, so the rest of this file means something', async () => {
    /* A positive control for the two assertions below. "The page shows ₹2,499 and not ₹999" only
       proves the catalogue was read if the two numbers are actually different on this backend. If a
       future seed change made them equal, the price tests would keep passing while asserting
       nothing — this test fails first and says why. */
    const plans = await (await fetch(`${API}/plans`)).json();
    const ownerPlus = plans.find((p) => p.name === 'Owner Plus');
    expect(ownerPlus, 'the seeded catalogue must carry an "Owner Plus" plan').toBeTruthy();
    expect(ownerPlus.price).toBe(2499);

    const pricing = await (await fetch(`${API}/pricing`)).json();
    expect(pricing.ownerPlanYearly).toBe(999);
    expect(
      ownerPlus.price,
      'catalogue price and fallback fee are equal — the price assertions below are now vacuous',
    ).not.toBe(pricing.ownerPlanYearly);

    /* And the same for Owner Pro, whose fee-schedule number happens to be Owner Plus's catalogue
       price. That coincidence is what made the FAQ defect below read as plausible copy rather than
       as an obvious typo, so it is worth pinning rather than leaving to chance. */
    const ownerPro = plans.find((p) => p.name === 'Owner Pro');
    expect(ownerPro?.price).toBe(4999);
    expect(pricing.ownerProYearly).toBe(2499);
  });

  test('/checkout is guarded: a signed-out visitor is sent to sign-in carrying where they were going', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkout?plan=owner2');

    await expect(page).toHaveURL(/\/signin/);
    // `next` is the part that matters: a guard that bounced to a bare /signin would strand the
    // customer on the dashboard after they authenticated, mid-purchase.
    await expect(page).toHaveURL(/next=/);
    await expect(page).toHaveURL(/checkout/);
    await expect(page).toHaveURL(/owner2/);
    // And the checkout surface must not have rendered on the way past.
    await expect(page.getByRole('heading', { name: 'Checkout' })).toHaveCount(0);
  });

  test('/plans is public and quotes the catalogue price, not the back-office fee', async ({ page }) => {
    await page.context().clearCookies();
    await seedConsent(page);
    await page.goto('/plans');

    await expect(page.getByRole('heading', { name: 'Plans & Pricing' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'For seekers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'For owners' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get Seeker Plus' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upgrade to Owner Plus' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go Pro' }).first()).toBeVisible();

    /* The load-bearing assertion. `priced()` runs after `listPlans()` resolves, so poll rather than
       assert once — the first paint legitimately shows the fallback. What must not survive is the
       fallback still being on screen once the catalogue has landed. */
    await expect.poll(
      async () => page.getByText(OWNER_PLUS_CHARGED, { exact: false }).count(),
      { timeout: 20000, message: 'the Owner Plus card never showed the catalogue price' },
    ).toBeGreaterThan(0);
    // ₹999 is the fee-schedule number for this same plan. Seeing it on a pricing page means the
    // catalogue read was skipped and the customer is being quoted something they will not be billed.
    await expect(page.getByText(OWNER_PLUS_FALLBACK_FEE, { exact: false })).toHaveCount(0);
  });

  test('the FAQ quotes the same owner-plan prices as the cards above it', async ({ page }) => {
    /* This found a live defect on first run, and it is the exact shape of defect the mock twin was
       structurally incapable of seeing.

       `plansFaqs` used to answer "What do the owner plans cost?" from `usePricing()` — the
       back-office fee schedule — while the cards eight inches above it were priced from the plan
       catalogue. On the seeded data those two tables disagree, so the page rendered:

         card "Owner Plus"  ₹2,499   FAQ "Owner Plus is ₹999 per year"
         card "Owner Pro"   ₹4,999   FAQ "Owner Pro is ₹2,499 per year"

       Both FAQ numbers were wrong, and the second was wrong in the worst available way: ₹2,499 is a
       real price on that page, for the *other* plan. A visitor reading the FAQ would conclude Owner
       Pro costs what Owner Plus costs.

       A mock build has no plan catalogue at all — every number on the page comes from the same
       fee schedule, so the cards and the FAQ always agree there and the mock suite would go green
       on this forever. It is only visible against a backend where the two tables are distinct. */
    await page.context().clearCookies();
    await seedConsent(page);
    await page.goto('/plans');

    // The answers live in collapsed `<details>` cards (`Plans.jsx:326`), so open the one that
    // quotes the plan prices. Clicking the summary rather than setting `open` keeps this honest
    // about the disclosure actually working.
    const question = page.getByText('What do the owner plans cost?');
    await expect(question).toBeVisible({ timeout: 20000 });
    await question.click();

    const faq = page.getByText(/Owner Plus is .* per year and Owner Pro is .* per year/);
    await expect(faq).toBeVisible({ timeout: 20000 });

    // Poll: like the cards, the answer is re-rendered when the catalogue resolves.
    await expect.poll(
      async () => (await faq.textContent())?.replace(/\s+/g, ' ').trim() ?? '',
      { timeout: 20000, message: 'the FAQ never picked up the catalogue prices' },
    ).toContain(`Owner Plus is ${OWNER_PLUS_CHARGED} per year`);
    await expect(faq).toContainText(`Owner Pro is ${OWNER_PRO_CHARGED} per year`);
  });

  test('a plan CTA hands off to checkout, and the Pay button quotes the same price the card did', async ({ page }) => {
    /* A fresh account rather than a seeded actor: this walks up to (but never presses) Pay, and a
       seeded actor's subscription state is a published invariant other specs rely on. A brand-new
       user is also the only way to be sure the re-purchase guard is not what renders. */
    await signedInAsNew(page);
    await seedConsent(page);
    await page.goto('/plans');

    await page.getByRole('link', { name: 'Upgrade to Owner Plus' }).first().click();

    await expect(page).toHaveURL(/\/checkout\?plan=owner2/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Owner', exact: true })).toBeVisible();
    await expect(page.getByText('Order summary')).toBeVisible();

    // The same number, one page later. The two pages resolve the catalogue independently
    // (`Plans.jsx:202` and `Checkout.jsx:45`), so agreeing is a real claim rather than a tautology:
    // a customer who is shown one price on the card and charged another at the button is the
    // failure both of those reads were added to prevent.
    const payButton = page.getByRole('button', { name: /^Pay ₹/ });
    await expect.poll(
      async () => (await payButton.first().textContent())?.trim() ?? '',
      { timeout: 20000, message: 'the Pay button never picked up the catalogue price' },
    ).toContain(OWNER_PLUS_CHARGED);
    await expect(page.getByRole('button', { name: new RegExp(`Pay ${OWNER_PLUS_FALLBACK_FEE}`) })).toHaveCount(0);
  });

  test('a signed-in user with no subscription is on the free tier, and the server says so with a document not a 404', async ({ page }) => {
    const mobile = await signedInAsNew(page);

    /* The wire half first. `getSubscription` answers 200 with an empty document for someone who
       never subscribed — deliberately, so the plan screen renders "you are on the free tier" from
       an object rather than from an error it has to catch (`planMapper.js:78`). A 404 here would
       still render a free tier in the browser, via the catch path, so the UI assertion below cannot
       tell the two apart on its own. */
    const res = await fetch(`${API}/me/subscription`, { headers: await authHeaders(mobile) });
    expect(res.status).toBe(200);
    const sub = await res.json();
    expect(sub?.status ?? null, 'a brand-new account must hold no subscription').not.toBe('active');

    await seedConsent(page);
    await page.goto('/plans');
    // The badge renders in both the hidden mobile carousel and the visible desktop grid, so take
    // the desktop one (last in DOM), as the mock twin did.
    await expect(page.getByText('Current plan').last()).toBeVisible({ timeout: 20000 });
    // And no paid card is locked: a "Current plan" lock on a plan nobody bought would be the
    // entitlement bug this badge is otherwise a harmless decoration for.
    await expect(page.getByRole('link', { name: 'Upgrade to Owner Plus' }).first()).toBeVisible();
  });

  test('checkout with an unknown plan redirects back to /plans rather than rendering an empty order', async ({ page }) => {
    await signedInAs(page, ACTORS.owner);
    await seedConsent(page);
    await page.goto('/checkout?plan=not-a-plan');

    await expect(page).toHaveURL(/\/plans$/);
    await expect(page.getByRole('heading', { name: 'Plans & Pricing' })).toBeVisible({ timeout: 20000 });
  });
});
