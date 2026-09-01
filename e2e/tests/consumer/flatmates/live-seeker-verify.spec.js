/**
 * The flatmates board's entry into the Verified-badge funnel, against a real account.
 *
 * ## What this file owns, and what it deliberately does not
 *
 * The badge funnel is covered end-to-end elsewhere and this file must not re-litigate it.
 * `platform/auth/live-verify-funnel` owns the hard security claim - that starting DigiLocker
 * verification grants nothing, and that only the signed webhook can - and `live-kyc-growth-levers`
 * owns the dashboard card. What is left, and what nothing else asserts, is that the *flatmates*
 * hero is wired to the same funnel: a seeker who wants the badge can start it from the board they
 * are standing on rather than having to find the dashboard.
 *
 * So this file asserts one seam, from both sides of it.
 *
 * ## Why the mock version could not have caught a regression here
 *
 * The mock established its unverified seeker with `addInitScript` writing `draazyUser`, which is
 * not a session - no token, nothing the server ever saw. `Hero.jsx` renders the CTA on
 * `user && !isVerified`, so a fabricated `user` object satisfied the left half and an absent
 * localStorage badge satisfied the right, and the CTA appeared because the fixture said so. The
 * live version signs in over HTTP and reads `aadhaarVerified` back off the login response, so the
 * CTA appears because the *server* says this account has no badge.
 *
 * ## The assertion that makes the other two mean something
 *
 * "The Get verified button is visible" is a weak claim on its own: a hero that rendered it
 * unconditionally would satisfy it forever. `Hero.jsx:26-28` is a ternary - verified seekers get a
 * "Verified Seeker" pill *instead*, and the two never coexist. The third test grants the badge
 * server-side and watches the branch flip, which is what turns the first test from "an element
 * exists" into "the hero is reading real verification state". Without it, this file would pass
 * against a hero with the ternary deleted.
 *
 * ## The absence assertion, and its anchor
 *
 * The old Draazy-side Aadhaar OTP is gone (ADR-009a): the number and the OTP are entered on
 * DigiLocker's own page and never on ours, so an OTP field appearing anywhere in this modal would
 * be a serious regression. But a `toHaveCount(0)` on an input that no longer exists in the codebase
 * is unfalsifiable on its own - the same trap the mock `no-gate` spec fell into, where four
 * assertions named a dialog that had been deleted rather than renamed. It is asserted here only
 * *after* the DigiLocker button is proven visible, so the absence is a statement about a modal that
 * demonstrably rendered.
 */
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
       absence assertion green - the Post CTA being usable is what a gate would actually break. */
    await expect(page).toHaveURL(/\/flatmates/);
    await expect(hero(page).getByRole('button', { name: /^Post$/ })).toBeEnabled();
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
