import { test, expect } from '../../../fixtures/base.js';

/* D194 — the tenancy half of review eligibility, end to end.
 *
 * WHAT WAS BROKEN. `ReviewsSection` decided "has a tenancy" by reading a `localStorage` bucket
 * (`getTenanciesFor`) that nothing on the live path ever writes. Against the real API that bucket is
 * empty, so the term was unconditionally false and the review composer was closed to the one person
 * most entitled to open it. Every mock-mode test passed, because in mock mode that same bucket was
 * the source of truth for both halves at once — the check agreed with itself and with nothing else.
 *
 * WHY THIS SPEC IS NOT JUST "THE BUTTON APPEARS". Making a resident eligible is easy; making them
 * eligible *without* handing everyone a self-service review button is the entire problem. So the
 * load-bearing assertions here are the negative ones:
 *
 *   - a claim that the owner has not answered must NOT open the composer, and
 *   - a claim the owner withdraws must CLOSE it again.
 *
 * If those two ever pass with the confirmation step removed, the feature has become "assert you
 * lived anywhere, then review it", which is strictly worse than the dead check it replaced — that
 * one at least failed closed.
 *
 * WHAT THIS SPEC DOES NOT PROVE. It runs in mock mode, so it proves the UI agrees with the mock
 * provider — which is the same kind of self-agreement that hid the original bug. The server side of
 * the identical rule is proved separately and against real HTTP in `TenancyDeclarationFlowTest`
 * (422 from `ReviewNotEligibleException` for a pending or revoked claim, 201 once confirmed), and
 * the two provider implementations are kept honest by hand, not by a test. A `live-*` counterpart
 * under `playwright.live.config.js` would close that gap and does not exist yet.
 *
 * SWITCHING SIDES MID-TEST. The claim is a conversation between two people about one flat, so a
 * single-actor test cannot exercise it. The session is swapped in place rather than by re-seeding:
 * `seedStorage` writes through `addInitScript` and skips keys that are already present, so
 * overwriting `puneNestUser` survives the reload while every other fixture key stays put — which is
 * exactly what is needed, because the declaration itself has to outlive the swap.
 *
 * `U1013` / `9999618812` is P5013's owner in the seeded catalogue (`data/db.json`). It is spelled
 * out rather than taken from `USERS` because the mock resolves ownership through the catalogue, not
 * through the session — a fixture owner who does not appear there owns nothing.
 */

const PROP = 'P5013';
const OWNER = { name: 'Nikhil Jain', mobile: '9999618812', role: 'owner', id: 'U1013' };
const BUYER = { name: 'Test Buyer', mobile: '9876500001', role: 'buyer', id: null };

/** Swap the signed-in session and reload. The reload is what re-runs the seam reads. */
async function becomes(page, user) {
  await page.evaluate((u) => {
    const stored = { ...u, loginAt: Date.now() };
    if (!stored.id) delete stored.id;
    localStorage.setItem('puneNestUser', JSON.stringify(stored));
  }, user);
  await open(page);
}

/* `?tab=amenities`: PropertyTabs only mounts the reviews block while that tab is current, so on the
   default Overview tab none of this exists. The reveal-class flush is the house pattern — the
   fade-in observer does not fire for content Playwright scrolls past instantly. */
async function open(page) {
  await page.goto(`/property/${PROP}?tab=amenities`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
}

/** Ask the UI whether it thinks the caller may review, the only way that cannot lie: click it. */
async function rateOpensComposer(page) {
  const dialog = page.getByRole('dialog', { name: 'Rate this property' });
  try {
    // The click is inside the try on purpose. "No composer" is a legitimate way for the UI to say
    // no, and hiding the button for an ineligible viewer would be a reasonable change — if that
    // ever happens this should keep answering false, not fail the negative assertions on a click
    // timeout and report a broken test where the behaviour is correct.
    await page.getByRole('button', { name: 'Rate this property' }).click({ timeout: 4000 });
    await expect(dialog).toBeVisible({ timeout: 4000 });
    await page.keyboard.press('Escape');
    return true;
  } catch {
    return false;
  }
}

test('a stay only counts once the owner confirms it — and stops counting when they withdraw', async ({ page, login }) => {
  await login.asBuyer();
  await open(page);

  // 1. No visit and no tenancy: the buyer is offered the door rather than told to book a viewing
  //    of a flat they say they already lived in.
  const declare = page.getByTestId('tenancy-declare');
  await expect(declare).toBeVisible();
  await declare.getByRole('button', { name: 'I lived here' }).click();

  // 2. Claimed, unanswered — and therefore worth nothing. This is the anti-loophole assertion: if
  //    declaring alone opened the composer, the owner's confirmation would be decoration.
  await expect(page.getByTestId('tenancy-declaration-pending')).toBeVisible();
  expect(await rateOpensComposer(page)).toBe(false);

  // 3. The owner sees the claim on their own listing, with a name and no phone number.
  await becomes(page, OWNER);
  const claims = page.getByTestId('tenancy-claims');
  await expect(claims).toBeVisible();
  await expect(claims).toContainText('Test Buyer');
  await expect(claims).not.toContainText('9876500001');
  await claims.getByRole('button', { name: 'Confirm' }).click();
  await expect(claims.getByText('Confirmed')).toBeVisible();

  // 4. Now — and only now — the resident may review. Nothing about the buyer changed between
  //    step 2 and here except that the landlord agreed.
  await becomes(page, BUYER);
  await expect(page.getByTestId('tenancy-declare')).toHaveCount(0);
  expect(await rateOpensComposer(page)).toBe(true);

  // 5. Withdrawal actually withdraws. A confirmation an owner cannot take back is not a decision,
  //    it is a trap — and this is the half a "does the button appear" test would never reach.
  await becomes(page, OWNER);
  await page.getByTestId('tenancy-claims').getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByTestId('tenancy-claims').getByText('Not confirmed')).toBeVisible();

  await becomes(page, BUYER);
  await expect(page.getByTestId('tenancy-declaration-revoked')).toBeVisible();
  expect(await rateOpensComposer(page)).toBe(false);
});

test('an owner is never offered a claim on their own listing', async ({ page, login }) => {
  // The owner is already excluded from reviewing their own flat; without this they would be shown a
  // button whose only outcome is a 409 from a rule they cannot do anything about.
  await login.asOwner(OWNER);
  await open(page);
  await expect(page.getByTestId('tenancy-declare')).toHaveCount(0);
});
