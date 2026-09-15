import { test, expect } from '@playwright/test';
import { seedConsent, signedInAsNew } from '../../../helpers/liveAuth.js';

/* The gate's toast text is the sign-in screen's own heading, so the two cannot disagree; the
   `?reason=` and `?next=` pair is as much under test as the redirect itself. */

const LISTING = 'p5145';

/* Scoped to the toast stack rather than to `role="alert"`, which the sign-in screen also puts on a
   permanently-mounted sr-only status line that a bare role query would keep counting. */
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

test.describe('a signed-out visitor clicking a gated control is taken to sign in', () => {
  test('"Contact Owner" carries the contact reason and the listing to come back to', async ({ page }) => {
    await openListing(page);

    await page.getByRole('button', { name: /Contact Owner/i }).first().click();

    /* Captured before the assertions below, because the toast is on a three-second fuse and the
       navigation assertions are slower than that. The toast stack lives above the router, so it
       survives onto the destination — which is the point: the explanation is still on screen while
       the sign-in form is being read. */
    const said = await toasts(page).first().innerText();

    await page.waitForURL(/\/signin\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('reason'), 'the sign-in screen cannot explain an interruption it was not told about').toBe('contact');
    expect(url.searchParams.get('next'), 'the visitor is returned to the listing that sent them').toBe(`/property/${LISTING}`);

    // Read off the screen, not off the URL: `reason` is only worth carrying if it changes the copy.
    const heading = page.getByRole('heading', { name: /contact the owner/i });
    await expect(heading).toBeVisible();

    /* The centralisation invariant. Asserting the toast against a literal would pass just as well
       if the two copies drifted apart later; asserting it against the heading the visitor is now
       looking at is the property that actually matters, and it fails the moment a call site goes
       back to writing its own sentence. */
    expect(said.trim(), 'the toast and the screen it opens are the same sentence').toBe((await heading.innerText()).trim());

    /* "Vanish in max 3 secs". Bounded above, so a toast left on screen indefinitely — the state the
       fuse exists to prevent — fails here rather than merely looking untidy. */
    await expect(toasts(page)).toHaveCount(0, { timeout: 3500 });
  });

  test('a gate that used to redirect in silence now explains itself too', async ({ page }) => {
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

  test('the same click signed in is not sent to sign in', async ({ page }) => {
    /* The counterweight, and the half that actually decays. Every assertion above is equally
       satisfied by a control that redirects unconditionally — a worse bug than the dead-end toast,
       because it would bounce signed-in buyers off the highest-intent click in the product. */
    await signedInAsNew(page);
    await openListing(page);

    await page.getByRole('button', { name: /Contact Owner/i }).first().click();

    /* Anchored on the positive landing, not on "the URL is not /signin": a URL absence assertion is
       satisfied by its first sample, so it would go green before the click could navigate at all. */
    await page.waitForURL(/\/messages/);
    await expect(page.getByText(/waiting for the owner to accept/i)).toBeVisible();
  });

  test('a session still being restored is waited for, not mistaken for a signed-out one', async ({ page }) => {
    /* "No user object yet" is not "signed out". A hinted session with no cached user is reachable in
       production — sessionStorage without "Remember this device", or ITP eviction around a live
       refresh cookie — and a public page paints fully interactive during those two round trips, so a
       gate reading `!isIn` alone would send a signed-in buyer to an OTP form with no way back. */
    await signedInAsNew(page);
    await page.evaluate(() => {
      for (const store of [localStorage, sessionStorage]) { store.removeItem('draazyUser'); store.removeItem('draazyTokens'); }
    });

    let release;
    const restored = new Promise((r) => { release = r; });
    await page.route('**/auth/refresh', async (route) => { await restored; await route.continue(); });

    await openListing(page);
    await page.getByRole('button', { name: /Contact Owner/i }).first().click();

    /* The click during the unknown window is deliberately inert; what it must not do is decide. The
       real assertion is below — a second click after the restore lands could not happen on an OTP form. */
    const identified = page.waitForResponse((r) => r.url().includes('/auth/me') && r.ok());
    release();
    await identified;

    await page.getByRole('button', { name: /Contact Owner/i }).first().click();

    await page.waitForURL(/\/messages/);
    await expect(page.getByText(/waiting for the owner to accept/i)).toBeVisible();
  });
});
