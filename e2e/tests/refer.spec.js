/* The code on screen must equal this user's row in `referral_codes` — a format check would pass for
 * a browser that merely imitates the server's shape but mints a code redeem cannot resolve. */
import { expect, test } from '../fixtures/live.js';
import { API, apiLogin, signIn } from '../helpers/liveAuth.js';
import { appReady } from '../helpers/app.js';

/** Active, identity-verified, not used as a referrer or referee by any other live spec. */
const REFERRER = '9441541427';

/** A browser-minted code shape (name letters + mobile digits), named so the absence assertions
 *  below say what they are excluding. */
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

    /* And prove it is a *referral* share. `toBe(1)` alone is satisfied by any `window.open`, so a
       WhatsApp button that had lost its code — the exact failure this file was written for, just
       on a different button — would sail through it. */
    const opened = await page.evaluate(() => window.__opened);
    expect(opened[0]).toContain('wa.me');
    expect(decodeURIComponent(opened[0])).toContain('/signup?ref=');
    expect(decodeURIComponent(opened[0])).not.toContain(BROWSER_MINTED);

    /* On the mock build this reads 1 by now, because there the number counts *shares* — a fact
       about this browser's owner rather than about anybody they reached. Against the server it
       counts redemptions, which is the only reading under which the copy "You've invited N" is
       true. The difference is the point of the assertion, not an accident of it. */
    await expect(counter).toContainText('0');
  });

  test('the Copy code button puts the server code on the clipboard, not a look-alike', async ({ page, request }) => {
    const { accessToken } = await apiLogin(REFERRER);
    const summary = await (await request.get(`${API}/me/referrals`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })).json();

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, REFERRER);
    await page.goto('/refer');
    await appReady(page);

    /* The heading already asserts the server's code is *displayed*. This asserts it is the one that
       leaves the page, which is a separate claim: `copyCode` writes the `CODE` constant while the
       heading renders it, and the two only agree because nothing has come between them yet. The
       whole defect this file exists for was a page that showed one thing and shared another. */
    const copyCode = page.getByRole('button', { name: 'Copy referral code' });
    await expect(copyCode).toBeVisible();

    const counter = page.getByTestId('refer-invited');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('0');

    /* Three times, because the claim is that copying is *not* a share. A single click leaves "0"
       ambiguous between "copying does not count" and "one copy has not crossed a rounding line";
       repeating it makes the counter's silence deliberate. `Copied` is the per-click completion
       signal, so each iteration waits for the write rather than for a duration. */
    for (let i = 0; i < 3; i++) {
      await copyCode.click();
      await expect(copyCode).toContainText(/Copied/i);
    }

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(summary.code);
    await expect(counter).toContainText('0');
  });

  test('a completed native share carries the server code and still does not invent an invite', async ({ page, request }) => {
    const { accessToken } = await apiLogin(REFERRER);
    const summary = await (await request.get(`${API}/me/referrals`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })).json();

    /* `canNativeShare` is read during render (`Refer.jsx:199`), so the stub has to be installed
       before the bundle evaluates — an `addInitScript` after `goto` would leave the desktop build
       showing WhatsApp and this test silently exercising the wrong button. */
    await page.addInitScript(() => {
      window.__shared = null;
      navigator.share = (d) => { window.__shared = d; return Promise.resolve(); };
    });
    await signIn(page, REFERRER);
    await page.goto('/refer');
    await appReady(page);

    const counter = page.getByTestId('refer-invited');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('0');

    await page.getByRole('button', { name: 'Share', exact: true }).click();

    // A comparison rather than a format check: imitating `PUNE-\w{4}` would pass a regex while
    // still sharing a code the scheme cannot resolve.
    await expect.poll(() => page.evaluate(() => window.__shared?.url || null)).toContain(`/signup?ref=${summary.code}`);
    const payload = await page.evaluate(() => window.__shared);
    expect(payload.text).toContain(`/signup?ref=${summary.code}`);
    expect(payload.text).not.toContain(BROWSER_MINTED);

    /* A successful share is the branch where "the number is the server's redemptions" is under real
       pressure; `countInvite` re-reads `GET /me/referrals` and nobody redeemed, so it stays 0. */
    await expect(counter).toContainText('0');
  });

  test('a cancelled native share counts nothing, and the attempt is proven to have happened', async ({ page }) => {
    await page.addInitScript(() => {
      window.__shareAttempts = 0;
      navigator.share = () => { window.__shareAttempts += 1; return Promise.reject(new Error('cancel')); };
    });
    await signIn(page, REFERRER);
    await page.goto('/refer');
    await appReady(page);

    const counter = page.getByTestId('refer-invited');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('0');

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    /* Without this the claim is "0 invites shortly after a click", equally true of a Share button
       wired to nothing; the stub counts the attempt so the absence has a presence to hang off. */
    await expect.poll(() => page.evaluate(() => window.__shareAttempts)).toBe(1);

    await expect(counter).toContainText('0');
  });

  test('redeem rejects a code nobody owns, and says so with 409 rather than 200', async ({ request }) => {
    const { accessToken } = await apiLogin(REFERRER);
    const res = await request.post(`${API}/referrals/redeem`, {
      headers: { authorization: `Bearer ${accessToken}` },
      data: { code: 'PUNE-ZZZZ', shareChannel: 'link' },
    });
    // Not 404: the request is well-formed and permitted; the state is what failed. A 200 would mean
    // the sign-up path attributes new accounts to nothing and reports success.
    expect(res.status()).toBe(409);
  });

  test('redeem is closed to anonymous callers', async ({ request }) => {
    const res = await request.post(`${API}/referrals/redeem`, {
      data: { code: 'PUNE-ZZZZ', shareChannel: 'link' },
    });
    expect([401, 403]).toContain(res.status());
  });
});
