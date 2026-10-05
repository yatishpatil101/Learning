import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';

// OTP tests need a registered number because unknown sign-ins redirect to signup.
const REG_MOBILE = '9700000001';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch {}
  });
});

// Sign-in gates the OTP step behind "Send OTP", so most assertions need that click first.
async function sendOtp(page) {
  await page.locator('#signin-mobile').fill(REG_MOBILE);
  await page.getByRole('button', { name: /send otp/i }).click();
  await page.getByLabel('OTP digit 1').waitFor({ timeout: 10000 });
}

test.describe('Mobile auth keyboard', () => {
  test('the sign-in form asks for the numeric keypad, strips the app chrome and keeps its rows tappable', async ({ page }) => {
    await page.goto('/signin');

    await test.step('the phone field asks for the numeric keypad, not the full keyboard', async () => {
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

    await test.step('the consent and helper rows are real targets, not text links', async () => {
      const remember = page.getByText(/remember this device/i);
      const rememberRow = remember.locator('xpath=ancestor::label[1]');
      const rowBox = await rememberRow.boundingBox();
      expect(rowBox.height, 'the whole consent row is tappable').toBeGreaterThanOrEqual(44);

      const help = page.getByRole('link', { name: /need help/i });
      const helpBox = await help.boundingBox();
      expect(helpBox.height).toBeGreaterThanOrEqual(44);
    });

    await test.step('auth strips the app chrome so the keyboard has room', async () => {
      await expect(page.locator('nav.dz-bottom-nav')).toHaveCount(0);
      await expect(page.locator('footer')).toBeHidden();
    });
  });

  test('the OTP step accepts SMS autofill, avoids focus zoom and pins a reachable submit, without console errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/signin');
    await sendOtp(page);

    await test.step('no auth field can trigger a focus zoom', async () => {
      // Playwright cannot raise a soft keyboard, so pinned actions are the proxy.
      const fields = await page.evaluate(() =>
        [...document.querySelectorAll('input, select, textarea')]
          .filter((el) => el.offsetParent !== null && el.type !== 'checkbox')
          .map((el) => ({
            id: el.id || el.getAttribute('aria-label') || el.type,
            size: parseFloat(getComputedStyle(el).fontSize),
          })),
      );
      // Anchor the form first; no fields would otherwise satisfy `toEqual([])`.
      expect(fields.length, 'the OTP step must render fields to measure').toBeGreaterThanOrEqual(7);
      expect(fields.filter((x) => x.size < 16), 'every visible field is >=16px').toEqual([]);
    });

    await test.step('the OTP boxes accept SMS autofill', async () => {
      // The `pointer: coarse` rule in index.css is what prevents it; this asserts the outcome rather than the rule.
      const otp = page.locator('input[autocomplete="one-time-code"]');
      await expect(otp, 'exactly one box claims the autofill').toHaveCount(1);
      await expect(otp).toHaveAttribute('inputmode', 'numeric');
      await expect(otp).toHaveAttribute('maxlength', '6');

      await otp.fill('123456');
      for (let i = 1; i <= 6; i++) await expect(page.getByLabel(`OTP digit ${i}`)).toHaveValue(String(i));

      const boxes = page.locator('.otp-container input[inputmode="numeric"]');
      await expect(boxes, 'six digits').toHaveCount(6);
    });

    await test.step('the submit is pinned and reachable with the OTP filled in', async () => {
      for (let i = 1; i <= 6; i++) await page.getByLabel(`OTP digit ${i}`).fill(String(i));

      const submit = page.locator('.dz-auth-submit');
      await expect(submit).toBeVisible();
      await expect(submit).toBeInViewport();
      // Pinned so the keyboard cannot bury it.
      await expect(submit).toHaveCSS('position', 'sticky');

      const box = await submit.boundingBox();
      expect(box.height, 'primary conversion button clears 48px').toBeGreaterThanOrEqual(44);
    });

    expect(errors, 'signing in logs no console errors').toEqual([]);
  });
});
