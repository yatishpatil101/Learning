/** Live coverage verifies the flatmates hero enters the identity badge funnel. */
import { test, expect } from '@playwright/test';
import { signedInAs, apiLogin, grantIdentityBadge, uniqueMobile } from '../../../helpers/liveAuth.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const verifiedOnServer = async (mobile) => (await apiLogin(mobile)).user.verified;

const openBoard = async (page) => {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20000 });
};

const hero = (page) => page.locator('.sf-hero').first();
const onCaptureRoute = (page) => expect(page).toHaveURL(/\/verify-identity/);

const verifiedBadge = (page) => hero(page).getByText('Verified Seeker', { exact: true });

test.describe('Flatmates seeker verification entry point (live)', () => {
  test('the hero CTA hands an unverified seeker to the identity funnel, and declining leaves them on the board', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    expect(await verifiedOnServer(mobile)).toBe(false);

    await signedInAs(page, mobile);
    await openBoard(page);

    await test.step('the hero CTA hands an unverified seeker to the identity funnel', async () => {
      // The two hero branches are mutually exclusive - assert both halves, or the pill could be
      // rendering alongside and this would still pass.
      await expect(hero(page).getByRole('button', { name: 'Verify identity' })).toBeVisible();
      await expect(verifiedBadge(page)).toHaveCount(0);

      await hero(page).getByRole('button', { name: 'Verify identity' }).click();
      await onCaptureRoute(page);

      await expect(page.getByLabel('OTP digit 1')).toHaveCount(0);
    });

    await test.step('declining the badge leaves the seeker on the board, not stuck in front of it', async () => {
      await page.goBack();

      await expect(page).toHaveURL(/\/flatmates/);
      await expect(page.getByRole('button', { name: /^Post( Property)?$/ }).first()).toBeEnabled();
    });
  });
  test('earning the badge retires the CTA - the hero is reading real state, not rendering a constant', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    expect(await verifiedOnServer(mobile)).toBe(false);

    await grantIdentityBadge(mobile);
    expect(await verifiedOnServer(mobile)).toBe(true);

    await signedInAs(page, mobile);
    await openBoard(page);

    await expect(verifiedBadge(page)).toBeVisible();
    await expect(hero(page).getByRole('button', { name: 'Verify identity' })).toHaveCount(0);
  });

  test('a stale browser-stored seeker badge does not make an unverified user look verified', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    expect(await verifiedOnServer(mobile)).toBe(false);

    await page.addInitScript((m) => {
      localStorage.setItem('draazySeekerVerified', JSON.stringify({ [m]: true }));
    }, mobile);
    await signedInAs(page, mobile);
    await openBoard(page);

    await expect(verifiedBadge(page)).toHaveCount(0);
    await expect(hero(page).getByRole('button', { name: 'Verify identity' })).toBeVisible();
  });
});
