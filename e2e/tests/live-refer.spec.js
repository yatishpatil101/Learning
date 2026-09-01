/**
 * `/refer`, against the **live** backend — the page's own code, not the browser's.
 *
 * ## What this proves that `tests/ops/live-referrals.spec.js` cannot
 *
 * That file already drives `GET /me/referrals` and `POST /referrals/redeem` over HTTP, and has
 * since the fraud desk shipped. Both endpoints were green the whole time. What nothing checked is
 * that **the product uses them** — and it did not.
 *
 * `Refer.jsx` minted its own code in the browser: four letters of the user's name and the last four
 * digits of their mobile, `NIKH5615`, kept in localStorage under `pnReferralCode:<mobile>`. The
 * server's is `PUNE-2NQ7`, from `referral_codes` (V23), permanent by design. Every share button,
 * every copied link, every WhatsApp message this product has ever produced carried the first one,
 * and `POST /referrals/redeem` can only resolve the second. The scheme had a front door nobody
 * could open, and no test failed, because the API tests never opened the page and the page tests
 * never asked the API.
 *
 * So the assertion here is deliberately a **comparison**, not a format check. A regex for
 * `PUNE-\w{4}` would pass for a browser that had merely learned to *imitate* the server's format.
 * The only statement worth making is that the string on screen is the string this user's row in
 * `referral_codes` holds, so the test fetches it and compares.
 *
 * ## And the absence, paired with a presence
 *
 * The old code is asserted gone from the clipboard link too, because "the heading shows the server's
 * code" would still be true of a page that displayed one code and shared another — which, given
 * that the link is built by a separate function (`referralLink`), is a real way to get this half
 * right and half wrong.
 *
 * Fixtures: `9441541427 Isha Bhosale`, an active Aadhaar-verified buyer with no referrals, chosen
 * because a referrer with a redemption history would make `invited` non-zero and the "0" assertion
 * would stop distinguishing "the server said 0" from "the local counter is at 0".
 */
import { expect, test } from '../fixtures/live.js';
import { API, apiLogin, signIn } from '../helpers/liveAuth.js';
import { appReady } from '../helpers/app.js';

/** Active, Aadhaar-verified, not used as a referrer or referee by any other live spec. */
const REFERRER = '9441541427';

/** What the browser used to mint for this account: four letters of the name, four digits of the
 *  mobile. Named so the absence assertions below say what they are excluding. */
const BROWSER_MINTED = 'ISHA1427';

test.describe('refer page, live', () => {
  test('the code on screen is the one in referral_codes, not one the browser made up', async ({ page, request }) => {
    const { accessToken } = await apiLogin(REFERRER);
    const res = await request.get(`${API}/me/referrals`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const summary = await res.json();

    // The endpoint's own shape, asserted once so a later failure of the page test cannot be
    // mistaken for a change here.
    expect(summary.code).toBeTruthy();
    expect(typeof summary.invited).toBe('number');
    expect(typeof summary.converted).toBe('number');
    expect(summary.code).not.toBe(BROWSER_MINTED);

    await signIn(page, REFERRER);
    await page.goto('/refer');
    await appReady(page);

    // Positive gate first: the card has rendered at all. Without this the absence assertions below
    // would pass against a page that failed to load.
    const copyCode = page.getByRole('button', { name: 'Copy referral code' });
    await expect(copyCode).toBeVisible();

    await expect(page.getByText(summary.code, { exact: true })).toBeVisible();
    await expect(page.getByText(BROWSER_MINTED, { exact: true })).toHaveCount(0);
  });

  test('the shared link carries the server code, so the scheme can resolve it', async ({ page, request }) => {
    const { accessToken } = await apiLogin(REFERRER);
    const summary = await (await request.get(`${API}/me/referrals`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })).json();

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, REFERRER);
    await page.goto('/refer');
    await appReady(page);

    const copyLink = page.getByRole('button', { name: 'Copy link' });
    await expect(copyLink).toBeVisible();
    await copyLink.click();
    // `setCopied('link')` runs only after the clipboard write resolved, so this is causally
    // downstream of the clipboard actually holding the URL.
    await expect(copyLink).toContainText(/Copied/i);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(`/signup?ref=${summary.code}`);
    expect(clip).not.toContain(BROWSER_MINTED);
  });

  test('the invite count is the server\'s redemptions, and sharing does not inflate it', async ({ page }) => {
    await page.addInitScript(() => {
      window.__opened = [];
      window.open = (u) => { window.__opened.push(String(u)); return null; };
    });
    await signIn(page, REFERRER);
    await page.goto('/refer');
    await appReady(page);

    const counter = page.getByTestId('refer-invited');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('0');

    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    // Prove the share happened before claiming the counter did not move. "Still 0" is otherwise
    // true of a button that is not wired up at all.
    await expect.poll(() => page.evaluate(() => (window.__opened || []).length)).toBe(1);

    /* On the mock build this reads 1 by now, because there the number counts *shares* — a fact
       about this browser's owner rather than about anybody they reached. Against the server it
       counts redemptions, which is the only reading under which the copy "You've invited N" is
       true. The difference is the point of the assertion, not an accident of it. */
    await expect(counter).toContainText('0');
  });

  test('redeem rejects a code nobody owns, and says so with 409 rather than 200', async ({ request }) => {
    const { accessToken } = await apiLogin(REFERRER);
    const res = await request.post(`${API}/referrals/redeem`, {
      headers: { authorization: `Bearer ${accessToken}` },
      data: { code: 'PUNE-ZZZZ', shareChannel: 'link' },
    });
    // Not 404: the request was well-formed and the caller is allowed to make it; what failed is the
    // state, which is what 409 is for. A 200 here would mean the sign-up path silently attributes
    // new accounts to nothing at all and reports success.
    expect(res.status()).toBe(409);
  });

  test('redeem is closed to anonymous callers', async ({ request }) => {
    const res = await request.post(`${API}/referrals/redeem`, {
      data: { code: 'PUNE-ZZZZ', shareChannel: 'link' },
    });
    expect([401, 403]).toContain(res.status());
  });
});
