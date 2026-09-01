/* The enquiry page resolves `?ref=<id>` through the API, not through this browser's localStorage.
 *
 * `Contact.jsx` used to answer "which listing is this enquiry about?" with
 * `rawDb().listings.find(p => p.id === ref)` -- a synchronous read of the mock document in
 * localStorage. That worked for exactly one case: a listing this browser had already seeded or
 * created. Every other case -- a listing posted from another device, a link shared between two
 * people, a fresh profile following a "Contact about this property" link out of a search result --
 * found nothing, and the page rendered as though no `?ref=` had been passed at all. No error, no
 * empty state; the enquiry simply stopped naming the property it was about.
 *
 * That failure is invisible to the mock suite, because there the mock provider reads the very store
 * the old code read. Only a live run, against a database this browser has never written to, can
 * tell "resolved the listing" apart from "found it lying around locally". That is what this file
 * is for.
 *
 * The fixture is discovered from `GET /properties` rather than hardcoded, so the spec cannot drift
 * away from the seed: the id, the title and the locality all come from the same response the page
 * is being asked to render, and a seed change moves both sides together.
 *
 * Fixtures: none -- every assertion here is made signed out, which is also the stronger claim. The
 * owner's number is masked by `PropertyResponse` on the server (ADR-019, badge-not-gate), so a
 * signed-out visitor is exactly the case where a leak would matter most.
 */
import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/** The masked shape `maskPhone` renders: first two digits, then bullets, then the last two. */
const maskOf = (mobile) => new RegExp(`${mobile.slice(0, 2)}\u2022\u2022\u2022 \u2022\u2022\u2022${mobile.slice(-2)}`);

/**
 * The first published listing that actually carries an owner card.
 *
 * <p>Not simply `rows[0]`. The live database is reset to baseline once at the start of the whole
 * run, not between specs, so by the time this file executes several earlier specs have posted
 * listings of their own -- and `sort=newest` puts those first. Some are posted on behalf of a
 * number that has never signed in, so their owner has no display name yet, and the owner card this
 * file exists to assert on renders from `owner.name`. Taking the newest row made the fixture
 * depend on what ran before it: green in isolation, `Expected has value: null` at position 109 of
 * the full suite.
 *
 * <p>So the fixture is *selected* rather than assumed. A fixture must contain every state the code
 * under test branches on; scanning for one that does is the difference between a test that
 * measures the page and a test that measures the seed order.
 */
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

  /* Armed before the navigation: the point of the migration is *provenance*, and the only way to
     prove the page asked the server is to catch the request. A rendered title proves nothing on its
     own -- the old code could render a title too, whenever the listing happened to be local. */
  const detail = page.waitForResponse(
    (r) => new RegExp(`/api/properties/${listing.id}(\\?|$)`).test(r.url()) && r.request().method() === 'GET',
    { timeout: 15_000 },
  );
  await page.goto(`/contact?ref=${listing.id}`);
  expect((await detail).status()).toBe(200);

  /* The public id is the slug, not the UUID: `propertyMapper` maps `id: p.slug || p.id` and keeps
     the UUID under `uuid` (propertyMapper.js:95,98), so every link the app renders is slug-shaped.
     The lookup above still went out by UUID, because that is what was in the `?ref=` -- both forms
     resolve, which is exactly what a shared link needs. */
  const publicId = listing.slug || listing.id;

  // The "enquiring about" card names the listing, using the title the API just supplied.
  const about = page.getByRole('link', { name: new RegExp(listing.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  await expect(about).toBeVisible();
  await expect(about).toHaveAttribute('href', `/property/${publicId}`);
  await expect(about).toContainText(listing.locality);

  /* The message is prefilled with the reference, which is the reason the lookup exists at all: an
     enquiry that does not say which flat it is about is an enquiry nobody can action. */
  await expect(page.locator('textarea').first()).toHaveValue(new RegExp(`Ref: ${publicId}`));
});

test('the owner card is built from the server response, and the number stays masked', async ({ page }) => {
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

  /* The hazard this migration introduced, and the reason the prefill is conditional rather than a
     blanket write. When the listing was read synchronously the form could be *initialised* with the
     prefilled message, so there was never a moment where the user could be typing into a field the
     prefill was about to land in. Now there is: the lookup resolves a render or more later, and on
     a slow connection that can be seconds. A naive `setForm({ msg: preMsg })` on arrival would
     silently delete a message someone was halfway through writing -- a worse bug than the one being
     fixed, and one that would never reproduce on a fast local machine.
     Holding the response open makes that window wide enough to type into deliberately. */
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

  // The listing arrives -- the card appears, proving the prefill logic really did run and had the
  // opportunity to clobber the field.
  await expect(page.getByRole('link', { name: /Enquiring about/i })).toBeVisible();
  await expect(msg).toHaveValue('I can only view on weekends.');
});

test('an unknown ref leaves the page as the plain support page rather than breaking it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // A well-formed id that resolves to nothing: the lookup must fail closed. The old code reached
  // the same state by accident (a miss in localStorage looked identical to no `?ref=` at all); the
  // new code has to reach it on purpose, because a rejected promise is now in the path.
  await page.goto('/contact?ref=00000000-0000-4000-8000-000000000000');

  await expect(page.locator('.glass-card', { hasText: 'Contact owner directly' })).toHaveCount(0);
  // The positive anchor: the support page itself still rendered. Without this the assertion above
  // would pass just as happily on a blank screen.
  await expect(page.getByRole('button', { name: 'Send enquiry', exact: true })).toBeVisible();
  await expect(page.locator('textarea').first()).toHaveValue('');
  expect(errors).toEqual([]);
});
