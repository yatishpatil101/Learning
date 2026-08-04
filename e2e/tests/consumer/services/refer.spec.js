import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

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
    await page.addInitScript(() => { navigator.share = () => Promise.reject(new Error('cancel')); });
  }
  await page.goto(BASE);
  await page.evaluate((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Rahul Verma', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.removeItem('pnReferralStats:' + m);
  }, mobile);
  await page.goto(`${BASE}/refer`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
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
    for (let i = 0; i < 3; i++) { await copy.click(); await page.waitForTimeout(100); }
    expect(await invited(page)).toBe('0');
    await expect(copy).toContainText(/Copied/i);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^[A-Z]{3,4}\d{4}$/);
  });

  test('copy link puts a /signup?ref= URL on the clipboard', async ({ page }) => {
    await loginAndOpen(page);
    await page.locator('button[aria-label="Copy link"]').click();
    await page.waitForTimeout(120);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('/signup?ref=');
  });

  test('native share sends a full payload and counts one invite', async ({ page }) => {
    await loginAndOpen(page, { share: 'resolve' });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.waitForTimeout(150);
    const payload = await page.evaluate(() => window.__shared);
    expect(payload).toBeTruthy();
    expect(payload.url).toContain('/signup?ref=');
    expect(payload.text).toContain('/signup?ref=');
    expect(await invited(page)).toBe('1');
  });

  test('cancelled native share does NOT count an invite', async ({ page }) => {
    await loginAndOpen(page, { share: 'reject' });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.waitForTimeout(150);
    expect(await invited(page)).toBe('0');
  });

  test('WhatsApp button opens wa.me and counts an invite', async ({ page }) => {
    await loginAndOpen(page); // desktop: WhatsApp is the primary share button
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    await page.waitForTimeout(150);
    const opened = await page.evaluate(() => window.__opened || []);
    expect(opened.some((u) => u.includes('wa.me') && u.includes('signup'))).toBe(true);
    expect(await invited(page)).toBe('1');
  });
});
