/** Live coverage verifies the flatmates hero enters the DigiLocker badge funnel. */
import { test, expect } from '@playwright/test';
import { signedInAs, apiLogin, grantAadhaarBadge, uniqueMobile } from '../../../helpers/liveAuth.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* Read the badge off a fresh login response rather than holding a bearer across browser activity.
   A token minted before the page signs in goes stale the moment the browser's own refresh rotates
   the family, and presenting it afterwards trips ADR-008 reuse detection - a 401 that looks like an
   API defect and is not. One round trip, and it cannot go stale. */
const verifiedOnServer = async (mobile) => (await apiLogin(mobile)).user.aadhaarVerified;

const openBoard = async (page) => {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20000 });
};

/* Scoped to the hero rather than the page: "Get verified" is a nudge the app shows in several
   places (VerificationContext.jsx:12 counts seven), and an unscoped locator would happily pass on
   somebody else's copy of it while the hero's own branch was broken. */
const hero = (page) => page.locator('.glass').filter({ has: page.getByRole('heading', { level: 1 }) }).first();
const badgeModal = (page) => page.getByRole('dialog', { name: 'Get your Verified badge' });

/* `exact` is load-bearing, not tidiness. A bare `getByText('Verified Seeker')` matches
   case-insensitively on a substring, and the hero also carries a static feature pill reading
   "Verified seekers" (`flatmates.heroPillVerified`) two elements away. Without `exact` the earned
   badge is indistinguishable from a decorative label that is on the page for everyone - which made
   the unverified control fail against a correct app, and would have made the verified assertion
   pass against a hero that never rendered the badge at all. */
const verifiedBadge = (page) => hero(page).getByText('Verified Seeker', { exact: true });

test.describe('Flatmates seeker verification entry point (live)', () => {
  test('the hero CTA hands an unverified seeker to the DigiLocker funnel', async ({ page }) => {
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
    await expect(badgeModal(page)).toBeVisible();

    // The one door the modal offers. Proven present BEFORE the absence assertion below.
    await expect(badgeModal(page).getByRole('button', { name: /continue with digilocker/i })).toBeVisible();

    // And no Aadhaar OTP on a Draazy page - the thing ADR-009a moved off our surface entirely.
    await expect(page.getByLabel('OTP digit 1')).toHaveCount(0);
  });

  test('declining the badge leaves the seeker on the board, not stuck in front of it', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    await signedInAs(page, mobile);
    await openBoard(page);

    await hero(page).getByRole('button', { name: 'Get verified' }).click();
    await expect(badgeModal(page)).toBeVisible();

    await badgeModal(page).getByRole('button', { name: /close/i }).click();
    await expect(badgeModal(page)).toHaveCount(0);

    /* Badge-not-gate: dismissing the offer costs nothing. Asserted as *reachability* rather than
       as the absence of a wall, because a wall reinstated under any name would still leave an
       absence assertion green - the Post CTA being usable is what a gate would actually break.
       Page-scoped, not hero-scoped: the hero's own copy of this button was deleted as a duplicate
       of the bottom bar's `+`, so the surviving entry point is the tab-row "Post" at lg+ and the
       bar's "Post Property" below it. */
    await expect(page).toHaveURL(/\/flatmates/);
    await expect(page.getByRole('button', { name: /^Post( Property)?$/ }).first()).toBeEnabled();
  });

  test('earning the badge retires the CTA - the hero is reading real state, not rendering a constant', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    expect(await verifiedOnServer(mobile)).toBe(false);

    await grantAadhaarBadge(mobile);
    expect(await verifiedOnServer(mobile)).toBe(true);

    await signedInAs(page, mobile);
    await openBoard(page);

    await expect(verifiedBadge(page)).toBeVisible();
    await expect(hero(page).getByRole('button', { name: 'Get verified' })).toHaveCount(0);
  });
});
