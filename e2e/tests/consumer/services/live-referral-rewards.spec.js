/* Referral rewards — the "earn it instead of buying it" route, against the live API.
 *
 * Replaces `consumer/services/referral-rewards.spec.js`, whose own docblock was the argument for
 * converting it. It said, of D31b: *"On this (mock) build the numbers still come from the same
 * localStorage keys, because the mock provider **is** the server — which is why `seed()` still sets
 * them and `readContactsUsed()` still reads them."* Seventeen tests then agreed with themselves. The
 * fake stored the client's own vocabulary and handed it back, so `contactsUsed: 15` went in and a
 * blocked seeker came out — arithmetic that, after D31b, no longer happens anywhere near the browser.
 *
 * What is asserted here is the part that was never provable on a mock build:
 *
 *  1. **The modal is a reaction to a refusal, not a decision.** Before D31b the browser counted, and
 *     an exhausted press made no request at all. Now the press goes out, comes back
 *     `422 contact_quota_exhausted`, and *that* opens the modal (`ContactBox.jsx:55`). The mock could
 *     not tell those apart — both end with a modal on screen — so the round trip is asserted on the
 *     wire, in both directions: the refusal happens, and the press that is allowed is not refused.
 *  2. **The countdown on the property page is the server's number**, checked against
 *     `GET /me/entitlements` read outside the browser rather than against a constant.
 *  3. **`referralRewards` is a server document.** `PUT /admin/settings` writes it, public `GET /flags`
 *     serves it, and the consumer screens read it from there. The mock asserted this by reading
 *     `draazyDB_v5` out of localStorage, which is a claim about a browser key.
 *
 * Ownership, so nothing here restates a claim that already has a home:
 *  · The quota arithmetic itself — allowance, the derived `used`, idempotent repeat requests, the 422
 *    and its cost — is `consumer/live-entitlements`, at the API. This file is the screen half only,
 *    and deliberately does not re-count.
 *  · `/refer`'s code, share link and invite count are `live-refer`. The **balance panel** and its flag
 *    gating are not, and are here.
 *  · The listing paywall appearing at all is `live-listing-quota`.
 *  · `platform/live-feature-flags` covers nine flags; `referralRewards` is not one of them.
 *
 * Four mock tests are deliberately **not** ported:
 *  · "spends exactly one", "a repeat request does not burn quota again", "Seeker Plus lifts the
 *    ceiling", "a referred friend buys back 15" — arithmetic, owned by `live-entitlements`, and its
 *    fixtures (`seed({ contactsUsed })`) do not exist server-side.
 *  · "earned slots do not buy premium tools" imported `/src/lib/store.js` into the page and called
 *    `isPaidOwnerPlan()` — a test of a module the live build does not consult.
 *  · **"off — already-earned bonus contacts stop applying" and "off — an earned listing slot is
 *    withdrawn" assert behaviour that does not hold live**, which is a product gap rather than test
 *    debt and is filed as such in `tasks/DECISIONS-NEEDED.md`. Measured: with `referralRewards:false`
 *    on the server, a referrer holding one approved referral still reads
 *    `{allowance: 30, referralBonus: 15}` from `GET /me/entitlements` — the string `referralRewards`
 *    appears nowhere in `backend/src/main/java`, so no server path can consult it. The flag withdraws
 *    the *routes* (this file proves that) and not the *entitlement*, while the admin panel describes
 *    it as "Off = paid plans are the only way past a quota" (`AppFlagsPanel.jsx:52`). Pinning the
 *    current behaviour here would bake the contradiction into the suite and turn the eventual fix
 *    red, so it is documented instead of asserted.
 */
import { expect, test, ACTORS } from '../../../fixtures/live.js';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/** `settings.fees.freeContactLimit`. Mirrored, so a drift in the seed shows up here as a failure. */
const FREE_LIMIT = 15;

const entitlements = (token) =>
  fetch(`${API}/me/entitlements`, { headers: auth(token) }).then((r) => r.json());

/**
 * Listings from the seeded catalogue to spend contacts against.
 *
 * Borrowed rather than minted: this file needs sixteen of them and has no opinion about any of them
 * beyond existing and belonging to somebody else. `live-contact-badge-not-gate` mints its own because
 * its subject *is* the listing's owner policy; here the listing is only a door to knock on.
 */
async function someListings(count) {
  const res = await fetch(`${API}/properties?size=${count}`);
  expect(res.status).toBe(200);
  const rows = (await res.json()).content;
  expect(rows.length, 'the seeded catalogue has listings to contact').toBeGreaterThanOrEqual(count);
  return rows.map((r) => ({ id: r.id, ref: r.slug || r.id }));
}

const askFor = (token, propertyId) =>
  fetch(`${API}/contacts/request`, { method: 'POST', headers: auth(token), body: JSON.stringify({ propertyId }) });

/**
 * A signed-in buyer with every free contact spent, and one unspent listing left to press on.
 *
 * Spent over HTTP rather than by clicking fifteen times: the subject is the sixteenth press, and
 * driving the first fifteen through the browser would be fifteen chances to fail for reasons this
 * file is not about. A fresh account each time because spending a quota mutates it — the seeded
 * actors publish their state as an invariant and this would break the next spec's premise.
 */
async function exhaustedBuyer(page) {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const listings = await someListings(FREE_LIMIT + 1);

  for (const { id } of listings.slice(0, FREE_LIMIT)) {
    expect((await askFor(accessToken, id)).status, 'the free allowance is spendable in full').toBe(200);
  }
  await signedInAs(page, mobile);
  return { mobile, accessToken, untouched: listings[FREE_LIMIT] };
}

/* The button is rendered in two places at two viewports and this file has no opinion about which one
   answered, so it is reached by role and `.first()` — the same anchor `live-contact-badge-not-gate`
   uses. `getByTestId` would not help: the testid is on the countdown, not the button. */
const requestBtn = (page) => page.getByRole('button', { name: /Request number/i }).first();

async function openListing(page, ref) {
  await page.goto(`/property/${ref}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await requestBtn(page).waitFor({ timeout: 20000 });
}

const exhaustedModal = (page) => page.getByTestId('contacts-exhausted');

/** Press, and hand back the response the press produced. Armed before the click, never after. */
async function pressAndCatch(page) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/contacts\/request$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 }),
    requestBtn(page).click(),
  ]);
  return res;
}

test.describe('the free-contact wall, on screen', () => {
  test('an exhausted press is refused by the server, and it is the refusal that opens the upsell', async ({ page }) => {
    const { untouched } = await exhaustedBuyer(page);
    await openListing(page, untouched.ref);

    /* The whole point of the conversion. A modal on screen is equally consistent with a browser that
       decided locally and never asked — which is what this screen used to do, and what D31b removed.
       Only the wire tells them apart. */
    const refused = await pressAndCatch(page);
    expect(refused.status(), 'the press left the browser and was turned away by the server').toBe(422);
    expect((await refused.json()).error).toBe('contact_quota_exhausted');

    await expect(exhaustedModal(page)).toBeVisible();
  });

  test('the upsell offers the free route beside the paid one, and points at /refer', async ({ page }) => {
    const { untouched } = await exhaustedBuyer(page);
    await openListing(page, untouched.ref);
    await pressAndCatch(page);

    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-refer')).toBeVisible();
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-plan')).toBeVisible();
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-refer')).toHaveAttribute('href', '/refer');
  });

  test('the countdown on the page is the number the server is holding', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const [first, second] = await someListings(2);

    expect((await askFor(accessToken, first.id)).status).toBe(200);

    /* Read from outside the browser, and asserted against that rather than against `FREE_LIMIT - 1`.
       A literal would keep passing if the page stopped asking and started counting again — which is
       precisely the regression D31b exists to prevent. */
    const { contacts } = await entitlements(accessToken);
    expect(contacts.used, 'the fixture spent exactly one').toBe(1);

    await signedInAs(page, mobile);
    await openListing(page, second.ref);
    await expect(page.getByTestId('contacts-left')).toContainText(String(contacts.remaining));
  });
});

test.describe('referralRewards is a server document', () => {
  test('with it off, the upsell drops the free route and keeps the paid one', async ({ page, flags }) => {
    const { untouched } = await exhaustedBuyer(page);
    await flags.disable('referralRewards');
    await openListing(page, untouched.ref);
    await pressAndCatch(page);

    await expect(exhaustedModal(page)).toBeVisible();
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-refer')).toHaveCount(0);
    /* The paid route surviving is half the claim. A flag that took the whole modal away would also
       satisfy the line above, and would be a different — much worse — behaviour. */
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-plan')).toBeVisible();
  });

  test('with it off, /refer hides the quota tracks and keeps the base programme', async ({ page, flags }) => {
    await signedInAs(page, ACTORS.buyer);
    await flags.disable('referralRewards');
    await page.goto('/refer', { waitUntil: 'networkidle' });

    /* Asserted **first**, and it is not decoration. `toHaveCount(0)` is satisfied the instant it is
       asked on a page that has not finished rendering, so a premature negative passes whether the
       flag works or not — proven the hard way: with the gating mutated out, the two lines below still
       went green until this wait was moved above them. The rent-agreement reward belongs to the base
       referral programme rather than to this feature, so it both has to survive the flag and is the
       right thing to wait for. */
    await expect(page.getByText(/free rent agreement/i).first()).toBeVisible();

    await expect(page.getByTestId('refer-balance')).toHaveCount(0);
    await expect(page.getByTestId('refer-seeker-track')).toHaveCount(0);
  });

  test('with it on, the /refer balance is the server’s arithmetic', async ({ page, flags }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const [only] = await someListings(1);
    expect((await askFor(accessToken, only.id)).status).toBe(200);

    await flags.enable('referralRewards');
    const { contacts } = await entitlements(accessToken);

    await signedInAs(page, mobile);
    await page.goto('/refer', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('refer-seeker-track')).toBeVisible();
    /* Allowance minus spent, taken from the same read the page makes, so the assertion moves with the
       seed instead of pinning 15/30 into a second place they would have to be kept in step. */
    await expect(page.getByTestId('refer-balance-contacts')).toHaveText(String(contacts.remaining));
  });

  test('Ops switching it off is a confirmed write that lands on the server', async ({ page, flags }) => {
    await flags.enable('referralRewards');
    await signedInAs(page, ACTORS.admin);
    await page.goto('/admin/settings?tab=flags', { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: /Monetization & Payments/i }).click();
    const row = page.getByRole('switch', { name: 'Toggle Referral rewards' });
    await expect(row).toHaveAttribute('aria-checked', 'true');

    /* Confirmation-gated: the switch alone must not commit. Read back through the public `GET /flags`
       — the same route the consumer screens use — rather than out of a browser key, so an optimistic
       toggle that never reached the server cannot satisfy it. The mock twin read `draazyDB_v5`
       from localStorage, which on a live build is not where the answer lives. */
    await row.click();
    await expect(page.getByText('Disable Referral Rewards?')).toBeVisible();
    const midFlight = await (await fetch(`${API}/flags`)).json();
    expect(midFlight.referralRewards, 'an unconfirmed toggle changed the server').toBe(true);

    await page.getByRole('button', { name: /^Disable$/ }).click();
    await expect(row).toHaveAttribute('aria-checked', 'false');

    /* Polled: the switch flips from optimistic local state, so `aria-checked` settles a turn before
       the write is on the wire, and a one-shot read here would be asserting on a moment with no
       meaning about half the time. */
    await expect
      .poll(async () => (await (await fetch(`${API}/flags`)).json()).referralRewards,
        { message: 'the disable never reached the settings document' })
      .toBe(false);
  });
});
