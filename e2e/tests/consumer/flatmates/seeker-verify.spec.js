/** Live coverage verifies the flatmates hero enters the identity badge funnel. */
import { test, expect } from '@playwright/test';
import { signedInAs, apiLogin, grantIdentityBadge, uniqueMobile } from '../../../helpers/liveAuth.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* Read the badge off a fresh login response rather than holding a bearer across browser activity.
   A token minted before the page signs in goes stale the moment the browser's own refresh rotates
   the family, and presenting it afterwards trips ADR-008 reuse detection - a 401 that looks like an
   API defect and is not. One round trip, and it cannot go stale. */
const verifiedOnServer = async (mobile) => (await apiLogin(mobile)).user.verified;

const openBoard = async (page) => {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20000 });
};

/* Scoped to the hero rather than the page: "Get verified" is a nudge the app shows in several
   places (VerificationContext.jsx:12 counts seven), and an unscoped locator would happily pass on
   somebody else's copy of it while the hero's own branch was broken. */
const hero = (page) => page.locator('.glass').filter({ has: page.getByRole('heading', { level: 1 }) }).first();
/* The offer is a *route*, not a dialog: `VerifyIdentityRedirect` navigates to `/verify-identity`
   and renders nothing itself, so a dialog-name locator would name an element that exists nowhere
   and could never fail. */
const onCaptureRoute = (page) => expect(page).toHaveURL(/\/verify-identity/);

/* `exact` is load-bearing: a bare `getByText('Verified Seeker')` also matches the hero's static
   "Verified seekers" pill two elements away, making the earned badge indistinguishable from
   decoration that is on the page for everyone. */
const verifiedBadge = (page) => hero(page).getByText('Verified Seeker', { exact: true });

test.describe('Flatmates seeker verification entry point (live)', () => {
  test('the hero CTA hands an unverified seeker to the identity funnel', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    expect(await verifiedOnServer(mobile)).toBe(false);

    await signedInAs(page, mobile);
    await openBoard(page);

    // The two hero branches are mutually exclusive - assert both halves, or the pill could be
    // rendering alongside and this would still pass.
    await expect(hero(page).getByRole('button', { name: 'Get verified' })).toBeVisible();
    await expect(verifiedBadge(page)).toHaveCount(0);

    await hero(page).getByRole('button', { name: 'Get verified' }).click();
    await onCaptureRoute(page);

    // And no OTP box anywhere near it - the thing ADR-009a moved off our surface entirely. The
    // document is photographed on this device; no number is typed into a Draazy page.
    await expect(page.getByLabel('OTP digit 1')).toHaveCount(0);
  });

  test('declining the badge leaves the seeker on the board, not stuck in front of it', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    await signedInAs(page, mobile);
    await openBoard(page);

    await hero(page).getByRole('button', { name: 'Get verified' }).click();
    await onCaptureRoute(page);

    await page.goBack();

    /* Badge-not-gate, asserted as *reachability*: an absence assertion stays green against a wall
       reinstated under another name, whereas a usable Post CTA is what a gate would break. */
    await expect(page).toHaveURL(/\/flatmates/);
    await expect(page.getByRole('button', { name: /^Post( Property)?$/ }).first()).toBeEnabled();
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
    await expect(hero(page).getByRole('button', { name: 'Get verified' })).toHaveCount(0);
  });
});
