import { test, expect } from '../../../fixtures/base.js';
import { ownerIdOf, ownerMobileOf } from '../../../helpers/app.js';

/* Offers, negotiation & maker-checker deal finalization.
 *
 * The deal UI lives in the property-detail DealPanel (src/pages/consumer/property/DealPanel.jsx),
 * rendered on the public route /property/:id via PropertyHeader. Owner-side deal management also
 * surfaces on the /dashboard "My Listings" panel, which sits behind ProtectedRoute.
 *
 * All deal/offer/finalization state is localStorage keyed by the OWNER's account id
 * (src/lib/store/deals.js): pnOffers:<ownerId>, puneNestDealReq:<ownerId>, puneNestDeals:<ownerId>.
 * So a buyer's offer and the owner's inbox share the same origin store — tests seed that store
 * before boot to reach negotiation / finalize states, then assert the REAL DealPanel behaviour.
 * The contact-request store is a separate module and is still mobile-keyed, so both constants are
 * needed here.
 *
 * Fixtures: `PROP` is an approved RENT listing from the seed catalog (src/data/db.json) so a
 * finalize-accept also exercises the rent tenancy side-effect. `OWNER` is that listing's account
 * id; we log in as the owner by overriding the seeded owner's mobile so isOwner === true.
 */

const PROP = 'P5000';                          // approved rent listing in the seed DB
const OWNER = ownerIdOf('P5000');              // read from properties.json, never copied
const OWNER_MOBILE = ownerMobileOf('P5000');   // ditto — for the mobile-keyed contact store
const BUYER = '9876500001';      // default seeded buyer mobile (helpers/seed.js)

// The global cookie-consent banner is role="dialog"; seed consent so it never overlays the
// property page or the offer modal. (Same pattern as support-tickets.spec.js.)
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

// Seed the owner-keyed offer store (pnOffers:<ownerId>) before the app boots.
async function seedOffers(page, owner, offers) {
  await page.addInitScript(({ owner, offers }) => {
    localStorage.setItem('pnOffers:' + owner, JSON.stringify(offers));
  }, { owner, offers });
}

// Seed the owner-keyed finalize-request store (puneNestDealReq:<ownerId>).
async function seedFinalizeReqs(page, owner, reqs) {
  await page.addInitScript(({ owner, reqs }) => {
    localStorage.setItem('puneNestDealReq:' + owner, JSON.stringify(reqs));
  }, { owner, reqs });
}

// Seed an approved contact request so a buyer's DealPanel shows the finalize card
// (renderFinalize hides "Request to Finalize" for a cold buyer until contact is approved).
async function seedApprovedContact(page, owner, buyer, propId) {
  await page.addInitScript(({ owner, buyer, propId }) => {
    localStorage.setItem(
      'puneNestContactReq:' + owner,
      JSON.stringify([{ id: 'c1', propId, buyerName: 'Test Buyer', buyerMobile: buyer, status: 'approved', requestedAt: Date.now() }]),
    );
  }, { owner, buyer, propId });
}

test.describe('Deals — offers, negotiation & finalization', () => {
  test('guards owner deal management: /dashboard redirects a signed-out visitor to /signin', async ({ page }) => {
    await page.goto('/dashboard');
    // ProtectedRoute → /signin?next=/dashboard (RouteGuards.jsx). Owner offers/finalize inbox
    // (My Listings) must not render for a signed-out user.
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
  });

  test('empty state: an owner with no offers sees the "no offers yet" prompt', async ({ page, login }) => {
    await seedConsent(page);
    await login.asOwner({ mobile: OWNER_MOBILE });
    await page.goto(`/property/${PROP}`);

    // Owner branch of renderOffers with an empty list.
    await expect(page.getByText('No offers yet. Buyers/tenants can negotiate price here.')).toBeVisible();
    // And the owner deal-close card is offered.
    await expect(page.getByRole('button', { name: 'Finalize Deal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as Under Offer' })).toBeVisible();
  });

  test('a buyer makes an offer and sees it pending', async ({ page, login }) => {
    await seedConsent(page);
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    // Default (no offer yet) buyer card.
    await expect(page.getByRole('heading', { name: 'Negotiate the price' })).toBeVisible();
    await page.getByRole('button', { name: 'Make an offer', exact: true }).click();

    // Offer modal (portal).
    await expect(page.getByRole('heading', { name: 'Make an offer' })).toBeVisible();
    await page.getByPlaceholder('e.g. 32000').fill('40000');
    await page.getByRole('button', { name: 'Send offer' }).click();

    // Real toast + the panel flips to the buyer's pending offer.
    await expect(page.getByRole('alert').getByText('Offer sent to the owner.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your offer' })).toBeVisible();
    await expect(page.getByText('is pending')).toBeVisible();
  });

  test('rejects a blank offer amount with an inline error', async ({ page, login }) => {
    await seedConsent(page);
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    await page.getByRole('button', { name: 'Make an offer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Make an offer' })).toBeVisible();
    // Send with an empty amount — submitOffer rejects with an inline FieldError + toast.
    await page.getByRole('button', { name: 'Send offer' }).click();
    await expect(page.getByText('Enter an offer amount.')).toBeVisible();
  });

  test('an owner counters a pending offer (maker-checker: owner is the checker)', async ({ page, login }) => {
    await seedConsent(page);
    await seedOffers(page, OWNER, [
      { id: 'of1', propId: PROP, buyerName: 'Aarti Shah', buyerMobile: '9812300000', amount: 38000, status: 'pending', from: 'buyer', at: Date.now(), history: [] },
    ]);
    await login.asOwner({ mobile: OWNER_MOBILE });
    // The owner "counter" affordance is a window.prompt; answer it before clicking.
    page.once('dialog', (d) => d.accept('42000'));
    await page.goto(`/property/${PROP}`);

    await expect(page.getByRole('heading', { name: 'Offers (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Counter' }).click();

    await expect(page.getByRole('alert').getByText('Counter sent.')).toBeVisible();
    await expect(page.getByText('You countered')).toBeVisible();
  });

  test('an owner accepts a pending offer', async ({ page, login }) => {
    await seedConsent(page);
    await seedOffers(page, OWNER, [
      { id: 'of2', propId: PROP, buyerName: 'Aarti Shah', buyerMobile: '9812300000', amount: 41000, status: 'pending', from: 'buyer', at: Date.now(), history: [] },
    ]);
    await login.asOwner({ mobile: OWNER_MOBILE });
    await page.goto(`/property/${PROP}`);

    await expect(page.getByRole('heading', { name: 'Offers (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();

    await expect(page.getByRole('alert').getByText('Offer accepted.')).toBeVisible();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
  });

  test('a buyer agrees to the owner counter by countering at that number', async ({ page, login }) => {
    await seedConsent(page);
    // A live owner counter waiting on the buyer.
    await seedOffers(page, OWNER, [
      { id: 'of3', propId: PROP, buyerName: 'Test Buyer', buyerMobile: BUYER, amount: 43000, status: 'countered', from: 'owner', at: Date.now(), updatedAt: Date.now(), history: [{ amount: 40000, by: 'buyer', at: Date.now() }] },
    ]);
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    /* This used to be an "Accept ₹43,000" button, and it worked — against the mock.

       `OfferService.respond` reserves accept and decline for the listing owner and answers a buyer
       403, because otherwise a buyer marks a price as agreed with no owner involvement and, through
       the status-driven contact reveal, unmasks a mobile the owner never chose to share.

       Agreeing is now expressed as a counter at the owner's own number: the one response a buyer is
       allowed, saying the same thing, and leaving the owner as the party who closes. */
    await expect(page.getByText('Owner countered at')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^Agree at ₹/ }).click();

    await expect(page.getByRole('alert').getByText('Sent — the owner confirms to close the deal.')).toBeVisible();
  });

  test('a buyer sends a finalize request (maker-checker: buyer is the maker)', async ({ page, login }) => {
    await seedConsent(page);
    await seedApprovedContact(page, OWNER_MOBILE, BUYER, PROP);
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    await expect(page.getByRole('heading', { name: 'Closing the deal?' })).toBeVisible();
    await page.getByRole('button', { name: 'Request to Finalize' }).click();

    await expect(page.getByRole('alert').getByText('Finalize request sent — the owner must confirm to close the deal.')).toBeVisible();
    // Panel flips to the buyer's pending finalize state.
    await expect(page.getByRole('heading', { name: 'Finalize requested' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Withdraw request' })).toBeVisible();
  });

  test('a buyer whose finalize request was declined is told, and can ask again (D111)', async ({ page, login }) => {
    await seedConsent(page);
    // Contact is approved — a buyer only reaches a declined row by first sending a request, which
    // requires an approved contact; the panel also only loads the finalize status once approved.
    await seedApprovedContact(page, OWNER_MOBILE, BUYER, PROP);
    // A turned-down request for this buyer. Before D111 the status read was pending-only, so a
    // declined row read the same as never having asked and the refusal copy never rendered.
    await seedFinalizeReqs(page, OWNER, [
      { id: 'f2', propId: PROP, deal: 'rent', buyerName: 'Test Buyer', buyerMobile: BUYER, status: 'declined', at: Date.now() },
    ]);
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    // The declined branch surfaces the refusal copy (not the neutral "send a request" prompt).
    await expect(page.getByRole('heading', { name: 'Closing the deal?' })).toBeVisible();
    await expect(page.getByText("The owner hasn't confirmed yet. You can request again.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request to Finalize' })).toBeVisible();
  });

  test('an owner accepts a finalize request — the maker-checker transition closes the deal', async ({ page, login }) => {
    await seedConsent(page);
    // A pending buyer finalize request in the owner's inbox.
    await seedFinalizeReqs(page, OWNER, [
      { id: 'f1', propId: PROP, deal: 'rent', buyerName: 'Aarti Shah', buyerMobile: '9812300000', status: 'pending', at: Date.now() },
    ]);
    await login.asOwner({ mobile: OWNER_MOBILE });
    await page.goto(`/property/${PROP}`);

    // Owner finalize inbox lists the maker's request.
    await expect(page.getByRole('heading', { name: 'Finalize request' })).toBeVisible();
    await expect(page.getByText('Aarti Shah')).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();

    // Accept is the side-effect boundary: the deal is closed.
    await expect(page.getByRole('alert').getByText('Deal finalized — listing is now closed.')).toBeVisible();
    await expect(page.getByText('You finalized this deal')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deal finalized' })).toBeVisible();
  });

  test('loads the deal panel with no real console errors', async ({ page, login, consoleErrors }) => {
    await seedConsent(page);
    await login.asBuyer();
    await page.goto(`/property/${PROP}`);

    await expect(page.getByRole('heading', { name: 'Negotiate the price' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
