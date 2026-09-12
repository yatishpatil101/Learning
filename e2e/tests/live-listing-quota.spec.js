// @ts-check
/**
 * The freemium listing quota, against the live API.
 *
 * ## The defect this exists to hold down
 *
 * The wizard used to decide the quota entirely in the browser: `canPostListing()` counted the
 * listings in *this browser's* localStorage and compared them to a ceiling the browser also
 * computed, adding a referral bonus it had minted for itself. Both halves were wrong in opposite
 * directions, and the more dangerous one is the one asserted below — a fresh browser holds no
 * listings, so an owner who was already at their ceiling opened the wizard on a second device and
 * was waved straight through it. The paywall was, in practice, a paywall against clearing your
 * cookies.
 *
 * Every test here therefore runs in a fresh context that has never posted anything. That is not
 * incidental to the setup; it *is* the test. Under the old code all of these passed the wrong way.
 *
 * The fixture: Meera Deshpande (`9470744469`) owns four active listings and holds no subscription,
 * so the server's free-tier allowance is 1 and she is three over. Rahul Mehta (`9700000001`) owns
 * none, so his first post is free.
 */
import { expect, test } from '../fixtures/live.js';
import { ACTORS } from '../fixtures/live.js';
import { signedInAs, authHeaders, API } from '../helpers/liveAuth.js';

test.describe('Listing quota — live', () => {
  test('the server, not the browser, decides the ceiling and the count', async ({ request }) => {
    const headers = await authHeaders(ACTORS.owner);

    const ent = await request.get(`${API}/me/entitlements`, { headers });
    expect(ent.status()).toBe(200);
    const { listings } = await ent.json();
    // Free tier, no granting referrals. Asserted as a number rather than "is defined", because the
    // wizard now branches on it and a null would silently un-gate the paywall.
    expect(listings.allowance).toBe(1);
    expect(listings.referralBonus).toBe(0);

    const mine = await request.get(`${API}/me/listings`, { headers });
    expect(mine.status()).toBe(200);
    const body = await mine.json();
    const rows = Array.isArray(body) ? body : (body.content ?? []);
    const occupying = rows.filter((r) => !r.flatmate && !/deleted|archived/i.test(String(r.status || '')));
    expect(occupying.length).toBe(4);
    // The whole point: four against a ceiling of one. Nothing in the browser was consulted.
    expect(occupying.length).toBeGreaterThan(listings.allowance);
  });

  test('an over-quota owner is paywalled on a browser that has never posted', async ({ page }) => {
    await signedInAs(page, ACTORS.owner);
    await page.goto('/list-property', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('listing-paywall')).toBeVisible({ timeout: 15000 });
    // The paywall quotes the server's numbers. "1" used to be a localStorage plan row and "4" used
    // to be a count of what this browser remembered posting, which on a fresh context was zero —
    // so the card, on the rare occasion it appeared at all, said "you have 0".
    const paywall = page.getByTestId('listing-paywall');
    await expect(paywall).toContainText('4');
    await expect(paywall).toContainText('1');
  });

  test('an owner with nothing listed still gets their first post free', async ({ page }) => {
    await signedInAs(page, ACTORS.buyer);
    await page.goto('/list-property', { waitUntil: 'networkidle' });

    // The opposite failure mode, and the reason the quota load fails permissive: a slow or failed
    // entitlements call must not paywall somebody who is entitled to post.
    await expect(page.getByTestId('listing-paywall')).toHaveCount(0);
  });
});
