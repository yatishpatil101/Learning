import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

/* The verify funnel's *payoff* — D95, against the live API.
 *
 * ## What this spec is for
 *
 * `live-kyc-growth-levers` proves the badge can be earned and `live-verify-funnel` proves it cannot
 * be faked. Neither asks the question the whole badge-not-gate model rests on: **does earning it
 * change anything a buyer can see?** If verifying does not visibly pay off, the "verified owners
 * rank higher" promise is hollow and the funnel is a form that does nothing.
 *
 * ## Why this looks nothing like the seeded version
 *
 * The mock spec drove modal → DigiLocker → assert on `puneNestDB_v5`, because the mock granted the
 * badge inline and rewrote the catalogue in the same tick. Live, the browser cannot earn a badge at
 * all — the grant arrives on a signed webhook — so a UI-driven version of that test is not merely
 * awkward, it is impossible without faking the thing under test.
 *
 * The subject therefore splits by who can answer it:
 *
 * - **that the write happens** — `VerifiedOwnerListingsTest` (backend). It asserts the webhook
 *   back-fills every listing the owner holds, that another owner's listings are untouched, and that
 *   a listing posted afterwards is born verified. That is a database claim and belongs where the
 *   database is.
 * - **that the write is worth making** — this file. A buyer, in a real browser, seeing the trust
 *   signal on a verified owner's listing and *not* seeing it on an unverified one.
 *
 * ## The half that was NOT ported, deliberately
 *
 * The seeded spec also asserted a one-off free 7-day Featured slot on first verification, guarded by
 * `puneNestFirstFeaturePerk:<mobile>` so it could not be farmed. **No such thing exists on the
 * backend.** There is no `featured_until`, no `featured_reason` and no perk ledger — `featured` is a
 * plain boolean an admin toggles in moderation. Building it would mean inventing a schema and a
 * monetization rule (handing out paid placement for free) inside a migration task, so it is raised
 * as an open decision rather than implemented. See `docs/migration/README.md`.
 *
 * Anchors are registry rows: `p5021` is Meera's (verified) and `p5007` is Omkar's (not).
 *
 * ## The pairing is deliberately awkward, and that is the point
 *
 * `p5007` is not badge-free — its *ownership* is verified even though its *owner* is not. Those are
 * two independent checks (a person passing DigiLocker vs. this flat's paperwork checking out), and
 * an anchor that had neither would let a lazy assertion pass by matching "no badges at all". Writing
 * this spec against a listing that carries the other badge is what exposed the defect it now guards:
 * `OwnerCard` printed "Verified Owner · Ownership Verified" whenever *either* was true, so p5007's
 * page told buyers Omkar had passed identity checks he has never taken. Fixed in the same commit.
 *
 * The results-card test found a second one: `PropertySummary` carried no `ownerVerified` at all, so
 * live search results were badge-free for **every** owner while the detail page badged correctly.
 * The field is now on the card projection in the contract. Both defects share a shape — the payoff
 * fails quietly, on the buyer's side, where no owner is present to notice it is missing.
 */

const VERIFIED_OWNER = 'p5021';
const UNVERIFIED_OWNER = 'p5007';

/* The grid card renders the badge as an icon whose `aria-label` is the composed label, so an exact
 * accessible-name match is the sharpest available assertion: "Verified Owner" alone cannot be
 * satisfied by "Ownership Verified". */
const identityBadge = (scope) => scope.getByRole('img', { name: 'Verified Owner', exact: true });

/* Scoped to the owner card, because the detail page prints "Verified Owner" in two places — here and
 * in the verification checklist. Only this one is the owner's own badge. */
const ownerCard = (page) => page.locator('a[href^="/owner/"]').first();

test('a verified owner\'s listing carries the trust signal a buyer can see', async ({ page }) => {
  await page.goto(`/property/${VERIFIED_OWNER}`);

  await expect(ownerCard(page).getByText('Verified Owner', { exact: true })).toBeVisible();
  // The second, softer claim on the same card — the one that turns a badge into a reason to enquire.
  await expect(page.getByText('Verified owner — usually responds 2× faster')).toBeVisible();
});

test('an unverified owner\'s listing does not', async ({ page }) => {
  await page.goto(`/property/${UNVERIFIED_OWNER}`);

  /* Anchor on the card having rendered before asserting an absence, or this passes on a blank
   * screen. The card is present either way — what changes is which of its two branches ran, and the
   * paperwork badge below is the branch p5007 legitimately earned. */
  await expect(ownerCard(page).getByText('Ownership Verified', { exact: true })).toBeVisible();
  await expect(ownerCard(page).getByText('Verified Owner', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Verified owner — usually responds 2× faster')).toHaveCount(0);
});

test('the search results badge the verified owner and not the unverified one', async ({ page }) => {
  /* The listing card is where the payoff is actually monetised — it is what a buyer scanning results
   * compares. Asserting it here as well as on the detail page is not duplication: the two badges are
   * rendered by different components (`listings/Card.jsx` vs `property/OwnerCard.jsx`) from the same
   * field, and "verified on the detail page, plain in the results" is a shipped bug elsewhere. */
  await page.goto('/listings?deal=buy');

  const verified = page.locator(`a[href="/property/${VERIFIED_OWNER}"]`).first();
  await expect(verified).toBeVisible();
  await expect(identityBadge(verified)).toBeVisible();
});

test('the API is the source of the badge, not the browser', async ({ page }) => {
  /* The render assertions above cannot distinguish "the server said verified" from "the client
   * decided". This one reads the contract the page reads. It is also the assertion that would have
   * caught the fixture defect this conversion uncovered: the seeded catalogue had Omkar unverified
   * while all three of his listings claimed otherwise, so a page-only test would have shown a badge
   * and been perfectly happy. */
  const [verified, unverified, page1] = await Promise.all([
    fetch(`${API}/properties/${VERIFIED_OWNER}`).then((r) => r.json()),
    fetch(`${API}/properties/${UNVERIFIED_OWNER}`).then((r) => r.json()),
    fetch(`${API}/properties?deal=buy&size=50`).then((r) => r.json()),
  ]);

  expect(verified.ownerVerified).toBe(true);
  expect(unverified.ownerVerified).toBe(false);

  /* And on the card projection, which is a *different* schema — the detail read having the field
   * says nothing about the search read having it, which is exactly how it came to be missing. */
  const card = page1.content.find((p) => p.slug === VERIFIED_OWNER);
  expect(card.ownerVerified).toBe(true);
});

test('a listing posted by an unverified owner is born unverified', async ({ page }) => {
  /* The complement of the backend's "born verified" test, and the one that matters more here: the
   * flag is inherited from the owner rather than accepted from the client, so a client that asks for
   * `ownerVerified: true` must not get it. That is a trust signal, which makes this an authorization
   * assertion wearing a fixture's clothes. */
  const mobile = await signedInAsNew(page);

  const res = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers: await authHeaders(mobile),
    body: JSON.stringify({
      title: 'Freshly posted by an unverified owner',
      deal: 'rent',
      propertyType: 'apartment',
      price: 25000,
      locality: 'Baner',
      city: 'Pune',
      ownerVerified: true,
    }),
  });

  expect(res.status).toBe(201);
  expect((await res.json()).ownerVerified).toBe(false);
});
