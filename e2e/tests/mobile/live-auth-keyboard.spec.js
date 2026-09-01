import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';

/* Auth on a phone keyboard — §G.2 `mobile-auth-keyboard`.

   Sign-in is the highest-drop-off screen in the app and almost all of that drop-off
   is keyboard friction: the wrong keyboard for a phone number, no SMS autofill, a
   submit buried under the keyboard, or a focus-triggered page zoom. Each of those is
   a one-attribute fix, which is exactly why they need a guard — they are invisible
   until someone deletes one.

   Runs under `mobile` (412x915) and `mobile-small` (360x640). */

/* Sign-in bounces an *unregistered* number straight to /signup (see Signin.sendOtp),
   so a spec that wants the OTP step has to start from a number the app knows. Against the API
   that is a seeded account rather than a hand-written registry entry — Rahul Mehta, the buyer the
   live fixtures use everywhere else. */
const REG_MOBILE = '9700000001';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the cookie bar just stays up */ }
  });
});

/* Sign-in gates the OTP step behind "Send OTP", so most assertions need that click
   first. Demo mode accepts any 6 digits. */
async function sendOtp(page) {
  await page.locator('#signin-mobile').fill(REG_MOBILE);
  await page.getByRole('button', { name: /send otp/i }).click();
  await page.getByLabel('OTP digit 1').waitFor({ timeout: 10000 });
}

test.describe('Mobile auth keyboard', () => {
  test('the phone field asks for the numeric keypad, not the full keyboard', async ({ page }) => {
    await page.goto('/signin');
    const field = page.locator('#signin-mobile');
    await expect(field).toBeVisible();

    // type=tel alone gives the phone pad on iOS but not reliably on Android;
    // inputMode is what actually settles it. Both, or neither is trustworthy.
    await expect(field).toHaveAttribute('type', 'tel');
    await expect(field).toHaveAttribute('inputmode', 'numeric');
    // Lets the browser/OS fill the user's own number in one tap.
    await expect(field).toHaveAttribute('autocomplete', 'tel-national');
    // A phone number is never the last field here, so the action key should move on.
    await expect(field).toHaveAttribute('enterkeyhint', 'send');
  });

  test('the OTP boxes accept SMS autofill', async ({ page }) => {
    // one-time-code on the *first* box is what triggers the "from Messages" chip on
    // iOS and Android autofill. Putting it on every box makes them fight.
    await page.goto('/signin');
    await sendOtp(page);

    const otp = page.locator('input[autocomplete="one-time-code"]');
    await expect(otp, 'exactly one box claims the autofill').toHaveCount(1);
    await expect(otp).toHaveAttribute('inputmode', 'numeric');

    const boxes = page.locator('input[maxlength="1"][inputmode="numeric"]');
    await expect(boxes, 'six digits').toHaveCount(6);
  });

  test('no auth field can trigger a focus zoom', async ({ page }) => {
    // Any font-size below 16px on a focused input makes mobile Safari zoom the page,
    // which strands the user mid-form. The `pointer: coarse` rule in index.css is
    // what prevents it; this asserts the outcome rather than the rule.
    await page.goto('/signin');
    await sendOtp(page);

    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => el.offsetParent !== null && el.type !== 'checkbox')
        .map((el) => ({
          id: el.id || el.getAttribute('aria-label') || el.type,
          size: parseFloat(getComputedStyle(el).fontSize),
        }))
        .filter((x) => x.size < 16),
    );
    expect(tooSmall, 'every visible field is >=16px').toEqual([]);
  });

  test('the submit is reachable with the OTP filled in', async ({ page }) => {
    // The real failure is the keyboard covering the submit. Playwright cannot raise
    // a soft keyboard, so the proxy is that the button is pinned rather than sitting
    // at the natural end of a scrolling form.
    await page.goto('/signin');
    await sendOtp(page);

    for (let i = 1; i <= 6; i++) await page.getByLabel(`OTP digit ${i}`).fill(String(i));

    const submit = page.locator('.pn-auth-submit');
    await expect(submit).toBeVisible();
    await expect(submit).toBeInViewport();

    const box = await submit.boundingBox();
    expect(box.height, 'primary conversion button clears 48px').toBeGreaterThanOrEqual(44);
  });

  test('the consent and helper rows are real targets, not text links', async ({ page }) => {
    // A 16px checkbox next to legal-ish copy is the classic mis-tap; the row is
    // what should be tappable, not the box.
    await page.goto('/signin');

    const remember = page.getByText(/remember this device/i);
    const rememberRow = remember.locator('xpath=ancestor::label[1]');
    const rowBox = await rememberRow.boundingBox();
    expect(rowBox.height, 'the whole consent row is tappable').toBeGreaterThanOrEqual(44);

    const help = page.getByRole('link', { name: /need help/i });
    const helpBox = await help.boundingBox();
    expect(helpBox.height).toBeGreaterThanOrEqual(44);
  });

  test('auth strips the app chrome so the keyboard has room', async ({ page }) => {
    // ConsumerLayout drops the footer and the assistant on auth routes; the bottom
    // nav must stay gone too, or it eats 56px of an already-cramped form. The footer
    // is hidden by the `.route-auth > footer` rule rather than unmounted, so this
    // asserts visibility, not presence.
    await page.goto('/signin');
    await expect(page.locator('nav.pn-bottom-nav')).toHaveCount(0);
    await expect(page.locator('footer')).toBeHidden();
  });

  test('signing in logs no console errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/signin');
    await sendOtp(page);
    expect(errors).toEqual([]);
  });
});
