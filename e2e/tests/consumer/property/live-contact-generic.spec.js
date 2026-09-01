import { test, expect, MOBILE } from '../../../fixtures/live.js';

/* The support page must not invent an owner, against real HTTP.
 *
 * ## What this is guarding
 *
 * `/contact` with no `?ref` is a support page: there is no property in the URL, so there is no
 * owner to contact. The failure it exists to catch is the page rendering an owner card anyway —
 * either a placeholder person or, worse, whichever listing happened to be first in the store. That
 * would put a real personal number on a page a visitor can reach without asking about anything,
 * which is the one route around the enquiry gate that no amount of masking downstream would close.
 *
 * ## Why the mock twin is not enough
 *
 * The mock version signed a user in by writing `draazyUser` into localStorage, and the "no owner
 * appears" assertion then held over a store the same process had populated. Live there is no store
 * to fall back to — an owner card can only be drawn from a fetch this page has no reason to make —
 * so a leak here would show up as a request, and asserting the absence against the real seam is
 * what makes the absence mean something. This also drops the sign-in entirely: it was never
 * relevant to a page with no owner on it, and the honest premise for a support page is a visitor
 * who has not signed in.
 *
 * The mock file's second test, `/contact?ref`, is not carried over: `live-contact-ref.spec.js`
 * already asserts the gated-number behaviour against the API, including that the masking is the
 * server's rather than the client's.
 */

test('the generic support page shows no owner card and leaks no owner number', async ({ page, consoleErrors }) => {
  await page.goto('/contact', { waitUntil: 'networkidle' });

  /* The positive assertions come FIRST, and that ordering is load-bearing rather than stylistic.
   *
   * Everything this test cares about is an absence, and an absence is indistinguishable from a
   * not-yet. The right rail mounts after the initial paint — `networkidle` resolves before the
   * owner card would appear — so a `toHaveCount(0)` placed at the top of the test passes whether
   * the card is absent or merely late. That was not a hypothetical: this spec was written that way,
   * and a deliberately reinstated phantom-owner fallback failed to fail it. Waiting for the support
   * card and the enquiry button establishes that the rail has rendered and this page is finished
   * deciding what belongs in it, which is what turns the counts below into evidence.
   */
  const support = page.locator('.glass-card', { hasText: 'Need help?' });
  await expect(support).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send enquiry', exact: true })).toBeVisible();

  // And what it offers is Draazy's own channels, which belong to the company and not to a person.
  await expect(support.locator('a[href="tel:18002000000"]')).toBeVisible();
  await expect(support.locator('a[href^="mailto:hello@draazy.com"]')).toBeVisible();
  await expect(support.locator('a[href^="https://wa.me/"]')).toBeVisible();

  // No owner card, under any name. `Contact owner directly` is the card's own heading, so its
  // absence is the absence of the card rather than of one particular owner's details.
  await expect(page.locator('.glass-card', { hasText: 'Contact owner directly' })).toHaveCount(0);

  // And nothing shaped like an Indian mobile anywhere on the page. This is the broader net: a leak
  // need not arrive inside a card with the expected heading, and checking for one specific seeded
  // owner's number would miss a leak of anybody else's. The support numbers above are a 1800
  // toll-free and a `wa.me` href, neither of which is visible text matching a 10-digit 6-9 mobile,
  // so this is not vacuous. The fixture's own `MOBILE` is reused rather than re-typed: it carries
  // lookarounds pinning the match to a complete digit run, and an optional `+91`, both of which a
  // hand-rolled copy has already been observed to miss.
  const body = await page.locator('body').innerText();
  expect(body.match(new RegExp(MOBILE.source, 'g')) ?? [], 'a mobile number appeared on the generic support page').toEqual([]);

  expect(consoleErrors).toEqual([]);
});
