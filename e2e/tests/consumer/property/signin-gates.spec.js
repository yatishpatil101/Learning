import { test, expect } from '@playwright/test';
import { seedConsent, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
/* The gate's toast text is the sign-in screen's own heading, so the two cannot disagree; the
   `?reason=` and `?next=` pair is as much under test as the redirect itself. */

const LISTING = 'p5145';

const toasts = (page) => page.getByTestId('toasts').getByRole('alert');

async function openListing(page) {
  // The consent bar sits above the modal band and swallows clicks near the bottom of a mobile
  // viewport; every signed-in spec gets this from `signIn`, and a hand-driven spec must ask for it.
  await seedConsent(page);
  await page.goto(`/property/${LISTING}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  // Positive anchor: the right rail mounts after first paint, so without this a click on a
  // not-yet-rendered control fails as a timeout rather than as the gate regression it would be.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });
}

test.describe('a visitor clicking a gated control gets the matching auth gate', () => {
  test('Save property redirects to sign-in with the save reason', async ({ page }) => {
    /* The other direction of the drift: `Card.jsx`'s save heart takes a guest to sign-in correctly
       but must say so on the way, or the listing simply vanishes and an OTP form appears. */
    await seedConsent(page);
    await page.goto('/listings', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));

    await page.getByRole('button', { name: 'Save property' }).first().click();

    await expect(toasts(page)).toContainText(/sign in to save/i);
    await page.waitForURL(/\/signin\?/);
    expect(new URL(page.url()).searchParams.get('reason')).toBe('save');
  });

  test('the same click signed in opens the contact modal without leaving the listing', async ({ page }) => {
    await signedInAsNew(page);
    await openListing(page);

    const before = page.url();
    await page.getByRole('button', { name: /Contact Owner/i }).first().click();

    await expect(page.getByRole('dialog', { name: /^Contact the owner$/i })).toBeVisible();
    await expect(page).toHaveURL(before);
  });

  test('a session still being restored is waited for, not mistaken for a signed-out one', async ({ page }) => {
    await signedInAs(page, uniqueMobile());
    await page.addInitScript(() => {
      for (const store of [localStorage, sessionStorage]) { store.removeItem('draazyUser'); store.removeItem('draazyTokens'); }
    });

    let release;
    const restored = new Promise((r) => { release = r; });
    await page.route('**/auth/refresh', async (route) => { await restored; await route.continue(); });

    await openListing(page);
    await page.getByRole('button', { name: /Contact Owner/i }).first().click();

    // The click during the unknown window is deliberately inert; what it must not do is decide.
    await expect(page.getByRole('dialog', { name: /sign in to contact the owner/i })).toHaveCount(0);
    const renewed = page.waitForResponse((r) => r.url().includes('/auth/refresh') && r.ok());
    release();
    await renewed;

    await page.getByRole('button', { name: /Contact Owner/i }).first().click();

    await expect(page.getByRole('dialog', { name: /^Contact the owner$/i })).toBeVisible();
  });
});
