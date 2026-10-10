import { test, expect, MOBILE } from '../../../fixtures/live.js';

/* `/contact` without a property must not fetch or render an owner; otherwise it bypasses the
   enquiry gate and leaks a personal number on a support page. */

test('the generic support page shows no owner card and leaks no owner number', async ({ page, consoleErrors }) => {
  await page.goto('/contact', { waitUntil: 'networkidle' });

  /* Positive assertions come first because the right rail mounts late; otherwise absence is
     indistinguishable from not-yet-rendered. */
  const support = page.locator('.glass-card', { hasText: 'Need help?' });
  await expect(support).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send enquiry', exact: true })).toBeVisible();

  // And what it offers is Draazy's own channels, which belong to the company and not to a person.
  await expect(support.locator('a[href="tel:+918728872895"]')).toBeVisible();
  await expect(support.locator('a[href^="mailto:support@draazy.com"]')).toBeVisible();
  await expect(support.locator('a[href^="https://wa.me/"]')).toBeVisible();

  // No owner card, under any name. `Contact owner directly` is the card's own heading, so its
  // absence is the absence of the card rather than of one particular owner's details.
  await expect(page.locator('.glass-card', { hasText: 'Contact owner directly' })).toHaveCount(0);

  // Use the shared mobile matcher so this catches any visible owner number, not only one fixture.
  const body = await page.locator('body').innerText();
  expect(body.match(new RegExp(MOBILE.source, 'g')) ?? [], 'a mobile number appeared on the generic support page').toEqual([]);

  expect(consoleErrors).toEqual([]);
});
