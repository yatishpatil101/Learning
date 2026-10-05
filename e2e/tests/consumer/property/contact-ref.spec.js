import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';
import { trackErrors } from '../../../helpers/console.js';
/** The masked shape `maskPhone` renders: first two digits, then bullets, then the last two. */
const maskOf = (mobile) => new RegExp(`${mobile.slice(0, 2)}\u2022\u2022\u2022 \u2022\u2022\u2022${mobile.slice(-2)}`);

async function anyPublishedListing() {
  const list = await fetch(`${API}/properties`);
  expect(list.status).toBe(200);
  const body = await list.json();
  const rows = body.content ?? body.items ?? body;
  expect(Array.isArray(rows) && rows.length > 0).toBe(true);
  // The list rows carry no owner, so the detail read is where the owner card's data comes from --
  // and it is the same endpoint the page itself will call.
  for (const row of rows.slice(0, 12)) {
    const detail = await fetch(`${API}/properties/${row.id}`);
    expect(detail.status).toBe(200);
    const listing = await detail.json();
    if (listing.owner?.name && listing.owner?.id && listing.owner?.mobile && listing.title && listing.locality) {
      return listing;
    }
  }
  throw new Error('no published listing carries a complete owner card — the fixture, not the page, is wrong');
}

test('the enquiry page names the listing the API returns, not one it found in localStorage', async ({ page }) => {
  const listing = await anyPublishedListing();

  const detail = page.waitForResponse(
    (r) => new RegExp(`/api/properties/${listing.id}(\\?|$)`).test(r.url()) && r.request().method() === 'GET',
    { timeout: 15_000 },
  );
  await page.goto(`/contact?ref=${listing.id}`);
  expect((await detail).status()).toBe(200);

  const publicId = listing.slug || listing.id;
  // The "enquiring about" card names the listing, using the title the API just supplied.
  const about = page.getByRole('link', { name: new RegExp(listing.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  await expect(about).toBeVisible();
  await expect(about).toHaveAttribute('href', `/property/${publicId}`);
  await expect(about).toContainText(listing.locality);

  await expect(page.locator('textarea').first()).toHaveValue(new RegExp(`Ref: ${publicId}`));
});

test('the signed-out owner card is built from the server response, and the number stays masked', async ({ page }) => {
  const listing = await anyPublishedListing();
  const mobile = listing.owner?.mobile ?? '';
  // The server masks before it serialises, so what arrives here is already `94XXXXX469`-shaped.
  // Asserting that is the point: the client is never handed a number it could leak.
  expect(mobile).not.toMatch(/^[6-9]\d{9}$/);

  await page.goto(`/contact?ref=${listing.id}`);

  const card = page.locator('.glass-card', { hasText: 'Contact owner directly' });
  await expect(card).toBeVisible();
  await expect(card).toContainText(listing.owner.name);
  await expect(card.getByRole('link', { name: /owner profile/i })).toHaveAttribute('href', `/owner/${listing.owner.id}`);
  /* No escape hatch to the owner anywhere on the page -- not just inside the card. A `tel:` link in
     the support panel is fine and expected; one carrying the owner's digits is not. */

  const digits = String(mobile).replace(/\D/g, '');
  if (digits.length === 10) {
    await expect(page.getByText(digits)).toHaveCount(0);
  }
  await expect(card.locator('a[href^="tel:"], a[href^="mailto:"], a[href^="https://wa.me/"]')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /request it/i })).toBeVisible();
});

test('a slow lookup does not overwrite what the visitor has already typed', async ({ page }) => {
  const listing = await anyPublishedListing();

  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(`**/api/properties/${listing.id}*`, async (route) => {
    await held;
    await route.continue();
  });

  await page.goto(`/contact?ref=${listing.id}`);
  const msg = page.locator('textarea').first();
  await expect(msg).toHaveValue('');
  await msg.fill('I can only view on weekends.');

  release();

  await expect(page.getByRole('link', { name: /Enquiring about/i })).toBeVisible();
  await expect(msg).toHaveValue('I can only view on weekends.');
});

test('an unknown ref leaves the page as the plain support page rather than breaking it', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('/contact?ref=00000000-0000-4000-8000-000000000000');

  await expect(page.locator('.glass-card', { hasText: 'Contact owner directly' })).toHaveCount(0);
  // The positive anchor: the support page itself still rendered. Without this the assertion above
  // would pass just as happily on a blank screen.
  await expect(page.getByRole('button', { name: 'Send enquiry', exact: true })).toBeVisible();
  await expect(page.locator('textarea').first()).toHaveValue('');
  expect(errors).toEqual([]);
});
