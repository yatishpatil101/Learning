import { test, expect } from '../../../fixtures/base.js';
import { ownerMobileOf } from '../../../helpers/app.js';

/* Buyer-facing deal visibility on the property detail page (D110).
 *
 * Before D110 a buyer standing on a sold or reserved listing saw the full offer UI live, because
 * closed-ness lived only in the owner-scoped `deals.status` and `dealStatusForBuyer()` had no honest
 * answer but `active`. D110 gives the property a public `dealStatus` mirror; the DealPanel
 * (src/pages/consumer/property/DealPanel.jsx) now reads it for a buyer too:
 *
 *   - closed   → a terminal "no longer available / sold|rented" banner, and the offer + finalize
 *                cards are hidden (a buyer cannot negotiate a done deal).
 *   - reserved → an "Under Offer" banner, but the offer UI STAYS (a reserved listing still takes
 *                offers so a buyer can queue up if it falls through).
 *
 * In mock mode `dealStatusForBuyer(property)` reads the owner-keyed client deal store
 * (src/lib/store/deals.js, key `puneNestDeals:<owner>`), the stand-in for the wire's mirrored
 * field — so these tests seed that store before boot, log in as a *buyer* (not the owner), and
 * assert the real buyer chrome. `PROP` is an approved RENT listing from the seed catalog, so the
 * closed banner exercises the rent wording ("rented out").
 */

const PROP = 'P5000';                 // approved rent listing in the seed DB
const OWNER = ownerMobileOf('P5000'); // read from properties.json, never copied

// Seed cookie consent so the role="dialog" banner never overlays the panel.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

// Seed the owner-keyed deal store (puneNestDeals:<owner>) before the app boots — the mock's
// stand-in for the property's mirrored public `dealStatus`.
async function seedDeal(page, owner, propId, deal) {
  await page.addInitScript(({ owner, propId, deal }) => {
    localStorage.setItem('puneNestDeals:' + owner, JSON.stringify({ [propId]: deal }));
  }, { owner, propId, deal });
}

test.describe('Deal visibility — a buyer learns a listing is sold or reserved (D110)', () => {
  test('a buyer on a closed rent listing sees the "rented out" banner and NO offer UI', async ({ page, login }) => {
    await seedConsent(page);
    await seedDeal(page, OWNER, PROP, {
      status: 'closed', deal: 'rent', at: Date.now(),
      closedWith: { rent: 41000, name: 'Someone Else', mobile: '9812300000' },
    });
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    // Terminal banner (rent wording): heading + sub both render for the buyer.
    await expect(page.getByText('This property is no longer available')).toBeVisible();
    await expect(page.getByText(/has been rented out and is closed for new enquiries/i)).toBeVisible();

    // The offer + finalize cards are hidden — a buyer cannot negotiate a done deal.
    await expect(page.getByRole('heading', { name: 'Negotiate the price' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toHaveCount(0);
  });

  test('a buyer on a reserved listing sees the "Under Offer" banner but KEEPS the offer UI', async ({ page, login }) => {
    await seedConsent(page);
    await seedDeal(page, OWNER, PROP, { status: 'reserved', deal: 'rent', at: Date.now() });
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    // Under-offer banner is shown to the buyer…
    await expect(page.getByText('This property is Under Offer')).toBeVisible();
    // …but a reserved listing still takes offers, so the negotiate card stays live (Q3).
    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toBeVisible();
  });

  test('a buyer on an untouched listing sees no deal banner and the normal offer UI', async ({ page, login }) => {
    await seedConsent(page);
    // No seeded deal → dealStatusForBuyer resolves to active.
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    await expect(page.getByText('This property is no longer available')).toHaveCount(0);
    await expect(page.getByText('This property is Under Offer')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toBeVisible();
  });
});
