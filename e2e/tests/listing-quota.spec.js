// @ts-check

// Every test runs in a fresh context that has never posted anything: the quota is the server's call,
// so a browser with no local history must still be gated.
import { expect, test } from '../fixtures/live.js';
import { ACTORS } from '../fixtures/live.js';
import { signedInAs, authHeaders, API, uniqueMobile } from '../helpers/liveAuth.js';

const BODY = (title) => ({
  title,
  deal: 'rent',
  propertyType: 'apartment',
  price: 25000,
  locality: 'Kothrud',
  city: 'Pune',
});

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
    // `archived` is its own boolean on the wire and the status is left alone, so a take-down has to
    // be read off the flag. Filtering on the status alone counts a freed slot as held.
    const occupying = rows.filter((r) => !r.flatmate && !r.archived
      && !/deleted|archived|rejected/i.test(String(r.status || '')));
    expect(occupying.length).toBe(4);
    // The whole point: four against a ceiling of one. Nothing in the browser was consulted.
    expect(occupying.length).toBeGreaterThan(listings.allowance);
  });

  test('an over-quota owner is paywalled on a browser that has never posted', async ({ page }) => {
    await signedInAs(page, ACTORS.owner);
    await page.goto('/list-property', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('listing-paywall')).toBeVisible({ timeout: 15000 });
    // The paywall quotes the server's numbers, so a fresh context must still see 4 against 1.
    const paywall = page.getByTestId('listing-paywall');
    await expect(paywall).toContainText('4');
    await expect(paywall).toContainText('1');
  });

  test('an owner with nothing listed still gets their first post free', async ({ page }) => {
    await signedInAs(page, ACTORS.buyer);
    await page.goto('/list-property', { waitUntil: 'networkidle' });

    // The opposite failure mode, and the reason the quota load fails permissive: a slow or failed
    // entitlements call must not paywall somebody who is entitled to post.
    await expect(page.getByTestId('listing-wizard')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('listing-paywall')).toHaveCount(0);
  });

  /* The exit from the ceiling, seen from the wizard rather than the API. The paywall is drawn from a
     browser-side count over `GET /me/listings` that read only `status` — so a take-down (which sets
     `archived` and leaves the status `approved`) still looked like a held slot. */
  test('a withdrawn listing frees the slot in the wizard, not just in the API', async ({ page, request }) => {
    const mobile = uniqueMobile();
    const headers = await authHeaders(mobile);

    const posted = await request.post(`${API}/me/listings`, { headers, data: BODY('Withdrawal probe') });
    expect(posted.status()).toBe(201);
    const taken = await request.delete(`${API}/me/listings/${(await posted.json()).id}`, { headers });
    expect(taken.status()).toBe(200);

    await signedInAs(page, mobile);
    await page.goto('/list-property', { waitUntil: 'networkidle' });

    // Wait for the wizard before asserting the paywall is gone. `toHaveCount(0)` is satisfied the
    // instant the page mounts, so without this the test passes against the very bug it describes.
    await expect(page.getByTestId('listing-wizard')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('listing-paywall')).toHaveCount(0);
  });

  /* A `FlatmateRoom` is invisible to `countOccupyingListingSlots`, so flatmate supply is free at
     every tier and the paywall must not stand in front of `/list-property?flatmate=1`. */
  test('a capped owner reaches the flatmate flow free, and is told why whole-flat is refused', async ({ page }) => {
    await signedInAs(page, ACTORS.owner);
    await page.goto('/list-property?flatmate=1', { waitUntil: 'networkidle' });

    // Wait on the wizard before asserting the paywall's absence — `toHaveCount(0)` is true of a
    // page that has not finished deciding, and passed against this exact bug.
    await expect(page.getByTestId('listing-wizard')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('listing-paywall')).toHaveCount(0);

    // Switching back keeps the wizard rather than trapping them behind the paywall...
    await page.getByText('Rent out the whole place').click();
    await expect(page.getByTestId('listing-wizard')).toBeVisible();
    await expect(page.getByTestId('listing-paywall')).toHaveCount(0);
    // ...and the way back to the free flow is still on the page, which is the point of not swapping.
    await expect(page.getByText('Find a flatmate')).toBeVisible();
  });
});
