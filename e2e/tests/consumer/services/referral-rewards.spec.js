/* The screen half only — quota arithmetic is `consumer/live-entitlements`, the /refer code and share
 * link are `live-refer`. Withdrawal of already-earned bonuses is filed in `tasks/DECISIONS-NEEDED.md`. */
import { expect, test, ACTORS } from '../../../fixtures/live.js';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/** `settings.fees.freeContactLimit`. Mirrored, so a drift in the seed shows up here as a failure. */
const FREE_LIMIT = 15;

const entitlements = (token) =>
  fetch(`${API}/me/entitlements`, { headers: auth(token) }).then((r) => r.json());

/* Borrowed from the seeded catalogue rather than minted: this file has no opinion about the
 * listings beyond existing and belonging to somebody else. */
async function someListings(count) {
  const res = await fetch(`${API}/properties?size=${count}`);
  expect(res.status).toBe(200);
  const rows = (await res.json()).content;
  expect(rows.length, 'the seeded catalogue has listings to contact').toBeGreaterThanOrEqual(count);
  return rows.map((r) => ({ id: r.id, ref: r.slug || r.id }));
}

const askFor = (token, propertyId) =>
  fetch(`${API}/contacts/request`, { method: 'POST', headers: auth(token), body: JSON.stringify({ propertyId }) });

/* Spent over HTTP rather than by clicking fifteen times — the subject is the sixteenth press. A
 * fresh account each time, because the seeded actors publish their quota state as an invariant. */
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

/* The button renders in both the desktop sidebar card and the contact sheet and this file has no
   opinion about which answered, so it is reached by role and `.first()`. */
const requestBtn = (page) => page.getByRole('button', { name: /Request number/i }).first();

async function openListing(page, ref, flags) {
  /* Below `lg` the sidebar card is `display:none`, so the sticky CTA's contact sheet is the only
     surface carrying the button. An unset viewport is a maximised window, i.e. the desktop branch. */
  const phone = (page.viewportSize()?.width ?? 1024) < 1024;
  /* With `inAppMessaging` on, that CTA queues a chat and navigates to /messages instead of opening
     the sheet. Written before the page loads — live, the flag is a row, not a localStorage key. */
  if (phone) await flags.disable('inAppMessaging');
  await page.goto(`/property/${ref}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  if (phone) {
    await page.locator('.dz-sticky-cta').getByRole('button', { name: /contact owner/i }).click({ timeout: 20000 });
  }
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
  test('an exhausted press is refused by the server, and it is the refusal that opens the upsell', async ({ page, flags }) => {
    const { untouched } = await exhaustedBuyer(page);
    await openListing(page, untouched.ref, flags);

    /* A modal on screen is equally consistent with a browser that decided locally and never asked;
       only the wire tells them apart. */
    const refused = await pressAndCatch(page);
    expect(refused.status(), 'the press left the browser and was turned away by the server').toBe(422);
    expect((await refused.json()).error).toBe('contact_quota_exhausted');

    await expect(exhaustedModal(page)).toBeVisible();
  });

  test('the upsell offers the free route beside the paid one, and points at /refer', async ({ page, flags }) => {
    const { untouched } = await exhaustedBuyer(page);
    await openListing(page, untouched.ref, flags);
    await pressAndCatch(page);

    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-refer')).toBeVisible();
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-plan')).toBeVisible();
    await expect(exhaustedModal(page).getByTestId('contacts-exhausted-refer')).toHaveAttribute('href', '/refer');
  });

  test('dismissing the upsell returns to the contact form rather than closing both', async ({ page, viewport, flags }) => {
    /* The two sheets only stack below `lg`. On desktop the press comes from the sidebar card, which
       is not a dialog, so there is no pair for one keypress to collapse. */
    test.skip((viewport?.width ?? 1024) >= 1024, 'the contact form is a dialog only below lg');
    const contactForm = page.getByRole('dialog', { name: /contact the owner/i });
    const { untouched } = await exhaustedBuyer(page);
    await openListing(page, untouched.ref, flags);
    await pressAndCatch(page);
    await expect(exhaustedModal(page)).toBeVisible();

    /* The upsell mounts *inside* the contact form and both register a document-level Escape handler,
       so without the top-most-dialog guard one keypress runs both and loses the typed message. */
    await page.keyboard.press('Escape');
    await expect(exhaustedModal(page)).toHaveCount(0);
    await expect(contactForm).toBeVisible();

    // The second press still works, which a guard that never released would break.
    await page.keyboard.press('Escape');
    await expect(contactForm).toHaveCount(0);
  });

  test('the countdown on the page is the number the server is holding', async ({ page, flags }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const [first, second] = await someListings(2);

    expect((await askFor(accessToken, first.id)).status).toBe(200);

    /* Read outside the browser and asserted against that rather than `FREE_LIMIT - 1`: a literal
       would keep passing if the page stopped asking and started counting again. */
    const { contacts } = await entitlements(accessToken);
    expect(contacts.used, 'the fixture spent exactly one').toBe(1);

    await signedInAs(page, mobile);
    await openListing(page, second.ref, flags);
    /* `:visible`, not `.first()`: both surfaces render this countdown, and `toContainText` reads
       `textContent` right through a `display:none` parent. */
    const countdown = page.locator('[data-testid="contacts-left"]:visible');
    await expect(countdown).toHaveCount(1);
    await expect(countdown).toContainText(String(contacts.remaining));
  });
});

test.describe('referralRewards is a server document', () => {
  test('with it off, the upsell drops the free route and keeps the paid one', async ({ page, flags }) => {
    const { untouched } = await exhaustedBuyer(page);
    await flags.disable('referralRewards');
    await openListing(page, untouched.ref, flags);
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

    /* Asserted **first**: `toHaveCount(0)` is satisfied the instant it is asked on a page that has
       not finished rendering, so the two negatives below need something real to wait behind. */
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
       so an optimistic toggle that never reached the server cannot satisfy it. */
    await row.click();
    await expect(page.getByText('Disable Referral Rewards?')).toBeVisible();
    const midFlight = await (await fetch(`${API}/flags`)).json();
    expect(midFlight.referralRewards, 'an unconfirmed toggle changed the server').toBe(true);

    await page.getByRole('button', { name: /^Disable$/ }).click();
    await expect(row).toHaveAttribute('aria-checked', 'false');

    /* Polled: the switch flips from optimistic local state, so `aria-checked` settles a turn before
       the write is on the wire. */
    await expect
      .poll(async () => (await (await fetch(`${API}/flags`)).json()).referralRewards,
        { message: 'the disable never reached the settings document' })
      .toBe(false);
  });
});
