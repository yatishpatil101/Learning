import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// /refer is a protected route; log in via localStorage (mock auth) and start
// from a clean referral-stats slate so the invite counter is deterministic.
// `share` selects how the Web Share API is stubbed BEFORE the page loads:
//   'none'    → no navigator.share (desktop): WhatsApp is the primary button
//   'resolve' → native share available and succeeds
//   'reject'  → native share available but the user cancels
async function loginAndOpen(page, { mobile = '9876500011', share = 'none' } = {}) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  // Capture window.open targets so WhatsApp share is verifiable without hitting the network.
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  if (share === 'resolve') {
    await page.addInitScript(() => { navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; });
  } else if (share === 'reject') {
    /* The stub records the attempt as well as rejecting it. Without that there is no observable
       consequence of a cancelled share at all -- nothing renders, nothing increments -- so the
       "still 0 invites" test below had nothing to wait for and used a sleep, which meant it was
       really asserting "0 invites 150ms after a click" and would have passed just as happily if the
       button had done nothing whatsoever. Counting attempts lets the test prove the handler ran
       first, and only then claim the counter did not move. */
    await page.addInitScript(() => {
      window.__shareAttempts = 0;
      navigator.share = () => { window.__shareAttempts += 1; return Promise.reject(new Error('cancel')); };
    });
  }
  await page.goto(BASE);
  await page.evaluate((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Rahul Verma', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.removeItem('pnReferralStats:' + m);
  }, mobile);
  await page.goto(`${BASE}/refer`, { waitUntil: 'networkidle' });
  // The route is lazy and the invite count arrives from `GET /me/referrals`, so `networkidle` can
  // land before the counter every test reads is on screen.
  await expect(page.getByTestId('refer-invited')).toBeVisible();
}

// Reads the "You've invited N …" count from its stable test hook, tolerant of
// layout/markup/locale changes (extracts the first integer from the string).
const invited = async (page) => {
  const txt = await page.getByTestId('refer-invited').innerText();
  const m = txt.match(/\d+/);
  return m ? m[0] : null;
};

test.describe('Refer page', () => {
  test('copying the code does NOT count as an invite', async ({ page }) => {
    await loginAndOpen(page);
    expect(await invited(page)).toBe('0');
    const copy = page.locator('button[aria-label="Copy referral code"]');
    // `Copied` is set after the clipboard write resolves, so it is the per-click completion signal
    // the sleep was standing in for.
    for (let i = 0; i < 3; i++) { await copy.click(); await expect(copy).toContainText(/Copied/i); }
    expect(await invited(page)).toBe('0');
    await expect(copy).toContainText(/Copied/i);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^[A-Z]{3,4}\d{4}$/);
  });

  test('copy link puts a /signup?ref= URL on the clipboard', async ({ page }) => {
    await loginAndOpen(page);
    const link = page.locator('button[aria-label="Copy link"]');
    await link.click();
    // `setCopied('link')` runs only after the write resolved, so this is causally downstream of the
    // clipboard actually holding the URL -- unlike a fixed wait, which merely hopes it does.
    await expect(link).toContainText(/Copied/i);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('/signup?ref=');
  });

  test('native share sends a full payload and does not invent an invite', async ({ page }) => {
    await loginAndOpen(page, { share: 'resolve' });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    /* The share payload is now the completion signal. It used to be the invite counter, because a
       completed share bumped a local `invited` tally — a count of button presses wearing the name
       of a count of people, which drifted further from the truth the more the page was used. The
       number under "You've invited N" is `GET /me/referrals`, redemptions, and nothing this page
       can do to itself moves it. */
    await expect.poll(() => page.evaluate(() => window.__shared?.url || null)).toContain('/signup?ref=');
    const payload = await page.evaluate(() => window.__shared);
    expect(payload.text).toContain('/signup?ref=');
    expect(await invited(page)).toBe('0');
  });

  test('cancelled native share does NOT count an invite', async ({ page }) => {
    await loginAndOpen(page, { share: 'reject' });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    // Prove the share was attempted before claiming it was not counted. "Still 0" is otherwise
    // true of a button that is not wired up at all.
    await expect.poll(() => page.evaluate(() => window.__shareAttempts)).toBe(1);
    expect(await invited(page)).toBe('0');
  });

  test('WhatsApp button opens wa.me and does not invent an invite', async ({ page }) => {
    await loginAndOpen(page); // desktop: WhatsApp is the primary share button
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window.__opened || []).length)).toBeGreaterThan(0);
    const opened = await page.evaluate(() => window.__opened || []);
    expect(opened.some((u) => u.includes('wa.me') && u.includes('signup'))).toBe(true);
    expect(await invited(page)).toBe('0');
  });
});
