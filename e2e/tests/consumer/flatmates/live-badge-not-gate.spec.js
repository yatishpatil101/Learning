import { test, expect } from '@playwright/test';
import { signedInAs, apiLogin, grantAadhaarBadge, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Badge-not-gate for flatmates supply (ADR-019).
 *
 * Listing a room, creating a group and posting a requirement are host actions that need only a
 * signed-in account. The Aadhaar OTP wall that used to stand in front of them is gone; the
 * "Verified Seeker" badge that replaced it is a perk, and the only floor is being signed in.
 *
 * ## Why this asserts reachability and not the absence of the gate
 *
 * The mock spec this replaces made its case four times as `expect(gateDialog).toHaveCount(0)`,
 * against `getByRole('dialog', { name: /Verify your identity with Aadhaar/i })`. That string
 * survives in exactly one place in the frontend - `dashboard/retention.js:17`, where it labels a
 * row in a profile-completion checklist - and in no dialog at all. The wall was not renamed, it
 * was deleted, so the locator matches nothing no matter what the app does: reinstate a gate under
 * any other accessible name and all four assertions stay green. An absence assertion whose subject
 * cannot exist is not evidence.
 *
 * What can fail is the positive half. If a gate came back under any name it would sit between the
 * chooser and the form, and the form would not appear - so `toBeVisible` on the form is the
 * assertion that actually carries the claim, and it is the one kept here.
 *
 * ## What makes "unverified" mean something
 *
 * The mock established its unverified user by writing `draazyUser` and deliberately *not* writing
 * an Aadhaar key - that is, it asserted a property of its own fixture. Live, the account is minted
 * fresh and its unverified state is read back from the server before the walk begins. Without that
 * anchor, "an unverified user reached the form" would still pass on a server that shipped every new
 * account pre-verified, which is the one way the claim could be false while looking true.
 *
 * The flag is read off the `user` on the login response rather than through a held bearer. An
 * earlier draft kept one access token per test and re-read `GET /auth/me` with it; the second read
 * 401'd once the browser session had refreshed underneath it, because presenting a rotated token is
 * indistinguishable from presenting a stolen one and the server revokes the family (ADR-008 - the
 * hazard `signedInAs` documents at length). The API itself is fine: a probe confirmed a token
 * survives both a second login and the badge grant when no browser is racing it. Reading the flag
 * off a fresh login leaves no long-lived bearer to go stale, and costs one round trip rather than
 * two.
 *
 * Guest routing and the `?post=1` deep link are owned by `live-posting.spec.js`, for both the
 * signed-in and signed-out cases. This file owns the verification dimension only.
 *
 * ## Its sibling
 *
 * `consumer/list-property/live-no-gate.spec.js` makes the same ADR-019 argument for the *wizard*,
 * and was converted from the same mock file - which is why that mock survived until now: only half
 * of it had been carried over. The two divide by surface. That one owns what an owner sees once
 * they are inside `/list-property`; this one owns the three doors on the flatmates board that lead
 * there, plus the group and seeker forms that never leave it. Worth knowing before adding to
 * either: the sibling's six `toHaveCount(0)` assertions have the same problem this file's docblock
 * describes above - `'Verify your identity to start'` appears nowhere in the frontend, and the only
 * "mobile number linked to your Aadhaar" string is a differently-worded note in `misc2.json` that
 * its locator does not match. Its *positive* assertions are sound; the absence half is decoration.
 *
 * This file is named for what it asserts rather than sharing the `live-no-gate` basename, because
 * two spec files with one name in one suite is a trap for whoever greps next. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/** One unverified account for the three read-only tests.
 *
 *  They only open forms, so they cannot disturb each other, and sharing means one browser sign-in
 *  instead of three - `signedInAs` replays the cached session for the rest. The badge test keeps
 *  its own account precisely because it is *not* read-only: verification is a one-way flip on a
 *  database that lives for the whole run. */
let unverified;

test.beforeAll(async () => {
  unverified = uniqueMobile();
  await apiLogin(unverified); // `POST /auth/login` auto-registers an unknown mobile.
});

/** The board's lazy chunk. A static control, so this survives an empty feed. */
const openBoard = async (page) => {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20000 });
};

/** The server's word on whether this account carries the identity badge. */
const verifiedOnServer = async (mobile) => (await apiLogin(mobile)).user.aadhaarVerified;

/* "Just me" also appears as a share-intent control on room cards, so chooser steps are scoped to
   the modal rather than the whole page - unscoped, they resolve to several elements. */
const chooser = (page) => page.locator('.sf-modal');

/**
 * Open the post chooser, allowing for the board still hydrating.
 *
 * `app.js` has `postAsGroup`/`postHavingPlace` for this, and they are correct for the mock suite,
 * but the first test in a live file is the coldest moment in the run: Vite is compiling the board's
 * lazy chunk on demand and the feed is still in flight. A click that lands before React has
 * attached the handler is *accepted* and then does nothing - Playwright's actionability retries
 * cannot see that, because the button is visible, enabled and hit-target-clear the whole time. The
 * failure that follows names the chooser button, fifteen seconds later, and looks like a missing
 * element rather than a lost click. It cost this file two runs to place.
 *
 * So the click is retried against its actual effect. One retry is enough because the race is with
 * first paint, not with anything periodic.
 */
const openChooser = async (page) => {
  const post = page.getByRole('button', { name: /^Post$/ }).first();
  const heading = page.getByText('What are you posting?');
  await post.click();
  if (!(await heading.isVisible().catch(() => false))) {
    await post.click();
  }
  await expect(heading).toBeVisible();
};

/** Chooser -> "still looking" -> "we're a group" -> the group form. */
const pickGroup = async (page) => {
  await openChooser(page);
  await chooser(page).getByRole('button', { name: /I'm still looking for a place/ }).click();
  await chooser(page).getByRole('button', { name: /We're already a group/ }).click();
};

test.describe('Flatmates supply is badge-not-gate (live)', () => {
  test('an account the server calls unverified still opens the group form', async ({ page }) => {
    // The anchor. Read before the walk, so a pre-verified account fails here - naming the reason -
    // rather than sailing through the form and reporting a gate that was never tested. Strict
    // `false`, not `toBeFalsy`: a field absent from the payload would otherwise satisfy it. The
    // last test in this file is what proves the field is genuinely being read.
    expect(await verifiedOnServer(unverified)).toBe(false);

    await signedInAs(page, unverified);
    await openBoard(page);
    await pickGroup(page);

    // The group form is the entry point `live-posting` does not cover, and a gate would stand
    // exactly here.
    await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible();
  });

  test('the same unverified account is routed into the room flow, not stopped in front of it', async ({ page }) => {
    expect(await verifiedOnServer(unverified)).toBe(false);

    await signedInAs(page, unverified);
    await openBoard(page);
    await openChooser(page);
    await chooser(page).getByRole('button', { name: /I have a place/ }).click();

    // A room is a property with a flatmate flag, so "I have a place" leaves the board entirely.
    // Landing on the wizard is the proof: an identity check would have to intercept the navigation,
    // and the URL would not be this one.
    await expect(page).toHaveURL(/\/list-property\?flatmate=1/);
  });

  test('the badge is offered, not demanded - the seeker form opens without it', async ({ page }) => {
    expect(await verifiedOnServer(unverified)).toBe(false);

    await signedInAs(page, unverified);
    await openBoard(page);
    await openChooser(page);
    await chooser(page).getByRole('button', { name: /I'm still looking for a place/ }).click();
    await chooser(page).getByRole('button', { name: /Just me/ }).click();

    await expect(page.getByText('Post your flatmate request')).toBeVisible();

    // And the offer is still on the page behind the form - the badge exists, it just is not in the
    // way. Asserting only the form would leave "we removed the gate by removing the feature"
    // indistinguishable from the intended behaviour.
    await expect(page.getByRole('button', { name: /Get verified/i }).first()).toBeVisible();
  });

  test('earning the badge changes nothing about access - which is what makes it a badge', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    expect(await verifiedOnServer(mobile)).toBe(false);

    // This is what keeps the three anchors above honest. A field simply missing from the payload
    // reads as `undefined`, so every "unverified" check would pass while measuring nothing.
    // Granting the badge and reading `true` back through the same helper proves the reading tracks
    // the row.
    await grantAadhaarBadge(mobile);
    expect(await verifiedOnServer(mobile)).toBe(true);

    // And the point of the flip: the verified account reaches the same form by the same route. If
    // access had quietly become conditional on the badge, the tests above would fail and this one
    // would pass - the pair distinguishes "no gate" from "a gate nobody has tripped".
    await signedInAs(page, mobile);
    await openBoard(page);
    await pickGroup(page);
    await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible();
  });
});
