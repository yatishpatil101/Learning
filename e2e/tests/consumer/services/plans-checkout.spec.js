// @ts-check
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { signedInAs, signedInAsNew, apiLogin, authHeaders, API } from '../../../helpers/liveAuth.js';

/* Everything upstream of Pay. Two tables answer "what does Owner Plus cost" — the fee schedule
   (₹999, fallback) and the catalogue (₹2499, charged) — so a dropped catalogue read mis-quotes. */

/** The catalogue price of Owner Plus, and the fee-schedule number it must never be confused with. */
const OWNER_PLUS_CHARGED = '₹2,499';
const OWNER_PLUS_FALLBACK_FEE = '₹999';
/** Owner Pro's catalogue price. Its fee-schedule number is ₹2,499 — Owner Plus's real price. */
const OWNER_PRO_CHARGED = '₹4,999';

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
    /* The FAQ and the cards must quote the same table. Pricing the FAQ off the fee schedule while
       the cards read the catalogue quoted Owner Pro at Owner Plus's real price — wrong in the worst
       available way, since it is a real number on that same page. */
    await page.context().clearCookies();
    await seedConsent(page);
    await page.goto('/plans');

    // The answers live in collapsed `<details>` cards, so open the one quoting the plan prices.
    // Clicking the summary rather than setting `open` keeps this honest about the disclosure.
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

    // The two pages resolve the catalogue independently, so agreeing is a real claim: a customer
    // shown one price on the card and charged another at the button is what both reads prevent.
    const payButton = page.getByRole('button', { name: /^Pay ₹/ });
    await expect.poll(
      async () => (await payButton.first().textContent())?.trim() ?? '',
      { timeout: 20000, message: 'the Pay button never picked up the catalogue price' },
    ).toContain(OWNER_PLUS_CHARGED);
    await expect(page.getByRole('button', { name: new RegExp(`Pay ${OWNER_PLUS_FALLBACK_FEE}`) })).toHaveCount(0);
  });

  test('a signed-in user with no subscription is on the free tier, and the server says so with a document not a 404', async ({ page }) => {
    const mobile = await signedInAsNew(page);

    /* The wire half first: `getSubscription` answers 200 with an empty document for someone who never
       subscribed, so the free tier renders from an object rather than a caught error. A 404 would
       render the same free tier via the catch path, so the UI assertion cannot tell them apart. */
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
