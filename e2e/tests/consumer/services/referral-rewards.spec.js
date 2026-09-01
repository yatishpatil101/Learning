import { test, expect } from '@playwright/test';
import {
  ADMIN, OWNER, SEEKER, seed, open, openProperty, rentListing, propertyListing, publishListing,
  setFlags, readContactsUsed, readReferralStats,
} from '../../../helpers/app.js';

/* Referral rewards — the "earn it instead of buying it" paths.

   Two quotas can be lifted by referring instead of paying:
     · seeker — 15 free owner contacts, +15 per friend who joins
     · owner  — 1 free listing slot, +1 per referred owner who posts
   Everything else (boosts, featuring, priority support) must stay paid-only,
   and Ops can withdraw the whole free route with the `referralRewards` flag.

   ── What D31b changed under these tests ──────────────────────────────────
   The arithmetic is identical; where it happens is not. The contact quota used
   to be read synchronously out of localStorage during first render, and the
   browser decided whether to send the request at all. It is now server-owned:
   the countdown comes from `GET /me/entitlements` and the refusal is a 422 from
   `POST /contacts/request`. On this (mock) build the numbers still come from
   the same localStorage keys, because the mock provider *is* the server — which
   is why `seed()` still sets them and `readContactsUsed()` still reads them.

   The one visible consequence: an exhausted seeker now makes a round trip
   before being turned away, so the upsell arrives a tick later than it used to.
   Every assertion below waits for it rather than asserting synchronously, which
   they had to do anyway. Nothing here should ever assert that a blocked press
   made *no* network call — that was the old design and it was the bug. */

const PROP = 'P-e2e-1';

/* The property is owned by OWNER, so a signed-in SEEKER is a genuine third
   party — owners always see their own number and would bypass the gate. */
const openProp = (page) => openProperty(page, PROP);

const requestNumber = (page) => page.getByRole('button', { name: /Request number/i }).first().click();

const exhaustedModal = (page) => page.getByTestId('contacts-exhausted');

/* Publish the listing, set flags, then land on the property. setFlags navigates,
   so it must run before the assertion-bearing navigation. */
const arrive = async (page, flags = null) => {
  await publishListing(page, propertyListing());
  if (flags) await setFlags(page, flags);
  await openProp(page);
};

/**
 * An owner sitting on exactly one live listing — the state the free-tier paywall measures.
 *
 * `seed({ listings })` alone is no longer enough. It writes the per-user browser key, which is
 * what the old client-side quota counted; the wizard now asks the property service how many
 * listings the owner has, and on this build that is the mock marketplace DB. Seeding only the
 * browser key left the owner looking like they had posted nothing, so every paywall assertion
 * below went quietly green in the wrong direction. `publishListing()` writes both stores, which
 * is what a genuinely posted listing does.
 */
const seedOwnerWithOneListing = async (page, extra = {}) => {
  await seed(page, { user: OWNER, ...extra });
  await publishListing(page, rentListing({ status: 'approved' }));
};

test.describe('Seeker contact quota', () => {
  test('spends exactly one free contact per new request', async ({ page }) => {
    await seed(page, { user: SEEKER, contactsUsed: 0 });
    await arrive(page);

    await expect(page.getByTestId('contacts-left')).toContainText('15');
    await requestNumber(page);

    await expect(page.getByText(/awaiting owner/i)).toBeVisible();
    expect(await readContactsUsed(page, SEEKER.mobile)).toBe(1);
  });

  test('a repeat request on the same property does not burn quota again', async ({ page }) => {
    await seed(page, { user: SEEKER, contactsUsed: 0 });
    await arrive(page);
    await requestNumber(page);

    // Quota is spent *after* `requestContact()` resolves — the click only starts the
    // request. Reading the store the instant after the press asserts on a moment that
    // has no meaning; wait for the state the spend is bundled with instead.
    await expect(page.getByText(/awaiting owner/i)).toBeVisible();
    expect(await readContactsUsed(page, SEEKER.mobile)).toBe(1);

    // requestContact() returns the existing status rather than creating a second
    // record, so re-landing on the page must not cost another contact.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/awaiting owner/i)).toBeVisible();
    expect(await readContactsUsed(page, SEEKER.mobile)).toBe(1);
  });

  test('the gate opens the upsell instead of a request once all 15 are spent', async ({ page }) => {
    await seed(page, { user: SEEKER, contactsUsed: 15 });
    await arrive(page);

    await expect(page.getByTestId('contacts-left')).toContainText(/No free contacts left/i);
    await requestNumber(page);

    await expect(exhaustedModal(page)).toBeVisible();
    // A blocked request must never be recorded, and must never cost quota.
    expect(await readContactsUsed(page, SEEKER.mobile)).toBe(15);
    await expect(page.getByText(/awaiting owner/i)).toHaveCount(0);
  });

  test('the upsell offers the free referral route alongside the paid plan', async ({ page }) => {
    await seed(page, { user: SEEKER, contactsUsed: 15 });
    await arrive(page);
    await requestNumber(page);

    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-refer')).toBeVisible();
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-plan')).toBeVisible();
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-refer')).toHaveAttribute('href', '/refer');
  });

  test('a referred friend who joined buys back 15 more contacts', async ({ page }) => {
    // 15 spent, but one friend joined → allowance is 30, so 15 remain.
    await seed(page, { user: SEEKER, contactsUsed: 15, referralStats: { invited: 1, joined: 1, listed: 0 } });
    await arrive(page);

    await expect(page.getByTestId('contacts-left')).toContainText('15');
    await requestNumber(page);

    await expect(exhaustedModal(page)).toHaveCount(0);
    // As above: the spend lands with the request, not with the click, so wait for the
    // request to be observable before reading the counter it moved.
    await expect(page.getByText(/awaiting owner/i)).toBeVisible();
    expect(await readContactsUsed(page, SEEKER.mobile)).toBe(16);
  });

  test('Seeker Plus lifts the ceiling entirely — the gate never fires', async ({ page }) => {
    await seed(page, { user: SEEKER, contactsUsed: 99, plan: { id: 'seeker-plus', name: 'Seeker Plus' } });
    await arrive(page);

    // Unlimited plans render no countdown at all.
    await expect(page.getByTestId('contacts-left')).toHaveCount(0);
    await requestNumber(page);
    await expect(exhaustedModal(page)).toHaveCount(0);
    await expect(page.getByText(/awaiting owner/i)).toBeVisible();
  });
});

test.describe('Owner listing slots', () => {
  const openWizard = (page) => open(page, '/list-property');

  test('a free owner at their one-listing limit hits the paywall with a referral route', async ({ page }) => {
    await seedOwnerWithOneListing(page);
    await openWizard(page);

    await expect(page.getByTestId('listing-paywall')).toBeVisible();
    await expect(page.getByTestId('paywall-refer')).toBeVisible();
    await expect(page.getByTestId('paywall-refer')).toHaveAttribute('href', '/refer');
  });

  test('a referred owner who posted unlocks an extra free slot', async ({ page }) => {
    // Same one live listing, but one referred owner has posted → limit is 2.
    await seedOwnerWithOneListing(page, { referralStats: { invited: 1, joined: 0, listed: 1 } });
    await openWizard(page);

    await expect(page.getByTestId('listing-paywall')).toHaveCount(0);
  });

  test('earned slots do not buy premium tools', async ({ page }) => {
    await seed(page, {
      user: OWNER,
      listings: [rentListing({ status: 'approved' })],
      referralStats: { invited: 5, joined: 5, listed: 5 },
    });
    await open(page, '/dashboard');

    // Referrals move the quota and nothing else — boosting/featuring is still
    // gated on a genuinely paid plan.
    const paid = await page.evaluate(async () => {
      const m = await import('/src/lib/store.js');
      return { paidPlan: m.isPaidOwnerPlan(), plan: m.getPlan().id, limit: m.listingLimit() };
    });
    expect(paid.paidPlan).toBe(false);
    expect(paid.plan).toBe('free');
    expect(paid.limit).toBe(6);
  });
});

test.describe('referralRewards feature flag', () => {
  test('off — the contacts upsell drops the free route but keeps the paid one', async ({ page }) => {
    await seed(page, { user: SEEKER, contactsUsed: 15 });
    await arrive(page, { referralRewards: false });
    await requestNumber(page);

    await expect(exhaustedModal(page)).toBeVisible();
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-refer')).toHaveCount(0);
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-plan')).toBeVisible();
  });

  test('off — already-earned bonus contacts stop applying, and come back when re-enabled', async ({ page }) => {
    await seed(page, { user: SEEKER, contactsUsed: 15, referralStats: { invited: 1, joined: 1, listed: 0 } });
    await arrive(page, { referralRewards: false });

    // The 15 earned contacts are withheld, so the seeker is blocked again.
    await requestNumber(page);
    await expect(exhaustedModal(page)).toBeVisible();

    // Turning it back on restores the entitlement — the counters were never wiped.
    await setFlags(page, { referralRewards: true });
    await openProp(page);
    await expect(page.getByTestId('contacts-left')).toContainText('15');
  });

  test('off — the owner paywall drops the referral CTA', async ({ page }) => {
    await seedOwnerWithOneListing(page);
    await setFlags(page, { referralRewards: false });
    await open(page, '/list-property');

    await expect(page.getByTestId('listing-paywall')).toBeVisible();
    await expect(page.getByTestId('paywall-refer')).toHaveCount(0);
  });

  test('off — an earned listing slot is withdrawn', async ({ page }) => {
    await seedOwnerWithOneListing(page, { referralStats: { invited: 1, joined: 0, listed: 1 } });
    await setFlags(page, { referralRewards: false });
    await open(page, '/list-property');

    await expect(page.getByTestId('listing-paywall')).toBeVisible();
  });

  test('off — the Refer page hides the quota tracks but keeps the base program', async ({ page }) => {
    await seed(page, { user: SEEKER });
    await setFlags(page, { referralRewards: false });
    await open(page, '/refer');

    await expect(page.getByTestId('refer-balance')).toHaveCount(0);
    await expect(page.getByTestId('refer-seeker-track')).toHaveCount(0);
    // The rent-agreement track is part of the base referral program, not this
    // feature, so it must survive the flag being off.
    await expect(page.getByText(/free rent agreement/i).first()).toBeVisible();
  });

  test('on — the Refer page shows the live spendable balance', async ({ page }) => {
    await seed(page, { user: SEEKER, contactsUsed: 5, referralStats: { invited: 2, joined: 1, listed: 0 } });
    await setFlags(page, { referralRewards: true });
    await open(page, '/refer');

    await expect(page.getByTestId('refer-seeker-track')).toBeVisible();
    // 15 free + 15 earned - 5 spent.
    await expect(page.getByTestId('refer-balance-contacts')).toHaveText('25');
  });
});

test.describe('Admin feature flag toggle', () => {
  test('Ops can switch referral rewards off from Settings ▸ Feature flags', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await open(page, '/admin/settings?tab=flags');

    await page.getByRole('button', { name: /Monetization & Payments/i }).click();
    const row = page.getByRole('switch', { name: 'Toggle Referral rewards' });
    await expect(row).toHaveAttribute('aria-checked', 'true');

    // Flag changes are confirmation-gated — the switch alone must not commit.
    await row.click();
    await expect(page.getByText('Disable Referral Rewards?')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestDB_v5')).settings.flags.referralRewards)).toBe(true);

    await page.getByRole('button', { name: /^Disable$/ }).click();
    await expect(row).toHaveAttribute('aria-checked', 'false');
    /* Polled, not read once. `AdminSettings.persist` became async when settings moved behind the
       service seam (P5a): the switch flips from optimistic local state, so `aria-checked` settles a
       turn before the write reaches the store. A one-shot read here asserted the old value about
       half the time — a race in the test, not in the product, but one that only appeared once the
       write stopped being synchronous. */
    await expect
      .poll(() => page.evaluate(
        () => JSON.parse(localStorage.getItem('puneNestDB_v5')).settings.flags.referralRewards,
      ), { message: 'the disable never reached the settings store' })
      .toBe(false);
  });

  test('the flag ships registered, so admin and runtime agree', async ({ page }) => {
    await seed(page, { user: SEEKER });
    await open(page, '/');

    // A key missing from settings.flags renders OFF in admin but behaves ON at
    // runtime (flagEnabled is `!== false`). Guard against that drift.
    const flags = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestDB_v5')).settings.flags);
    expect(Object.prototype.hasOwnProperty.call(flags, 'referralRewards')).toBe(true);
    expect(flags.referralRewards).toBe(true);
  });
});
