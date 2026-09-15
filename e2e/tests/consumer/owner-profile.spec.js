/* The public owner profile against the live API. Most of this spec is about absence: the fields
 * that must not reach the wire, and the rows that must not reach the rail. */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** Meera Deshpande — seeded, verified, and holds live listings. */
const OWNER_ID = '3ad0171b-3206-53e2-b6dc-732bf4e1b44c';

/**
 * Isha Mehta - seeded, **not** verified, with eleven all-verified listings; each owner is the
 * other's counter-example, so a badge read off a constant cannot pass both.
 */
const UNVERIFIED_OWNER_ID = 'b05422ba-0a55-5136-ba68-d202e83e29b0';

/** One page big enough to hold anything one seeded owner has, so `totalElements` and rows agree. */
const WHOLE_CATALOGUE = 200;

/** The seven fields the card is capped to. Anything else on the wire is a leak. */
const CARD_FIELDS = ['id', 'name', 'mobile', 'verified', 'city', 'memberSince', 'listingCount'];

test('the seller card is public and carries exactly seven fields', async () => {
  /* Bare, with no Authorization header. A visitor reaches this page from a listing, before there is
     any reason to sign in. */
  const res = await fetch(`${API}/owners/${OWNER_ID}`);
  expect(res.status, 'the seller card is public').toBe(200);

  const card = await res.json();
  /* Sorted key comparison rather than a field-by-field check: the interesting failure here is an
     *extra* key, and no per-field assertion can see one. */
  expect([...Object.keys(card)].sort()).toEqual([...CARD_FIELDS].sort());
  expect(card.id).toBe(OWNER_ID);
  expect(typeof card.name).toBe('string');
  expect(card.name.length).toBeGreaterThan(0);
});

test('nothing operational about the account is on the wire', async () => {
  const card = await (await fetch(`${API}/owners/${OWNER_ID}`)).json();

  /* Named one by one, since a key-count assertion goes green the moment one absent field is traded
     for another. `lastActive` is worse than an email on a public page: it is a presence indicator
     for a private individual who never agreed to publish one. */
  for (const leak of ['email', 'role', 'team', 'status', 'lastActive', 'flagged', 'flaggedAt',
    'identityVerified', 'passwordHash', 'hideNumber', 'verifiedContactOnly', 'archived']) {
    expect(card[leak], `${leak} must not reach a stranger`).toBeUndefined();
  }
});

test('the mobile is masked, and there is no way to unmask it', async () => {
  const anon = await (await fetch(`${API}/owners/${OWNER_ID}`)).json();

  /* Both directions. Asserting only "it is masked" would pass against a response that helpfully
     carried the raw number alongside it. */
  expect(anon.mobile).toMatch(/^\d\dX{5}\d\d\d$/);
  expect(anon.mobile).not.toMatch(/^\d{10}$/);

  /* A real token, not an anonymous request: an approved contact request against *any* of this
     owner's listings once revealed the number, turning a per-listing grant into a per-person one.
     An anonymous 200 would only prove the route is public. */
  const buyer = await authHeaders(ACTORS.buyer);
  const asBuyer = await (await fetch(`${API}/owners/${OWNER_ID}`, { headers: buyer })).json();
  expect(asBuyer.mobile, 'a signed-in buyer sees the same mask').toBe(anon.mobile);
});

test('member since is a year, not a timestamp', async () => {
  const card = await (await fetch(`${API}/owners/${OWNER_ID}`)).json();

  /* The page renders four characters. Sending the instant would publish the minute somebody signed
     up, which the reader gains nothing from and a correlator gains a handle from. */
  expect(typeof card.memberSince).toBe('number');
  expect(card.memberSince).toBeGreaterThan(2000);
  expect(card.memberSince).toBeLessThanOrEqual(new Date().getFullYear());
});

test('the listing count agrees with the search endpoint and hides what is not public', async () => {
  const card = await (await fetch(`${API}/owners/${OWNER_ID}`)).json();

  /* Cross-checked against a different endpoint's answer rather than against the rail below it. The
     rail is built from the same facet, so agreeing with it would prove only that one number was
     copied twice. */
  const page = await (await fetch(`${API}/properties?owner=${OWNER_ID}&size=1`)).json();
  expect(card.listingCount).toBe(page.totalElements);

  /* And the floor still applies. Every row the facet returns is approved and unarchived — asked of
     the rows themselves, because "the count is N" would also hold if the facet returned N of the
     wrong rows. */
  const all = await (await fetch(`${API}/properties?owner=${OWNER_ID}&size=${WHOLE_CATALOGUE}`)).json();
  expect(all.content.length).toBeGreaterThan(0);
  for (const row of all.content) {
    expect(row.status, `${row.title} is public stock`).toBe('approved');
  }
});

test('the owner facet narrows to one person', async () => {
  const mine = await (await fetch(`${API}/properties?owner=${OWNER_ID}&size=${WHOLE_CATALOGUE}`)).json();
  const everything = await (await fetch(`${API}/properties?size=${WHOLE_CATALOGUE}`)).json();

  /* Both directions in one read: the facet returns strictly fewer rows than the unfiltered
     catalogue, and every row it does return is one of this owner's. Only the first would pass
     against a facet that was silently dropped on a catalogue of one. */
  expect(mine.content.length).toBeLessThan(everything.content.length);
  const mineIds = new Set(mine.content.map((r) => r.id));
  expect(mineIds.size).toBe(mine.content.length);
});

test('unknown, malformed and non-existent owners are all the same not-found', async () => {
  /* All three together because the claim is precisely that they are indistinguishable. A malformed
     id answering 400 would tell an enumerator their guess was badly formatted rather than wrong. */
  const unknown = await fetch(`${API}/owners/00000000-0000-4000-8000-000000000000`);
  expect(unknown.status).toBe(404);

  const malformed = await fetch(`${API}/owners/u1`);
  expect(malformed.status, 'a mock-style id is not a bad request, it is a stranger').toBe(404);

  /* And the same value in the facet is an empty page rather than a 500 — a stale or hand-edited URL
     is a request for somebody who does not exist, and "nothing listed" is the honest answer. */
  const facet = await fetch(`${API}/properties?owner=u1`);
  expect(facet.status).toBe(200);
  expect((await facet.json()).content).toHaveLength(0);
});

test('there is no public directory of owners', async () => {
  /* `GET /owners` would be a downloadable list of the platform's landlords, worth far more to a
     scraper than to any visitor. No handler is mapped and the security matcher is single-segment,
     so nothing deeper is public either. */
  const res = await fetch(`${API}/owners`);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

test('the profile page is served by the API, not assembled in the browser', async ({ page }) => {
  /* Armed before the navigation, because the mock and the server render the same card and the only
     thing that distinguishes them is which request went out. */
  const cardCall = page.waitForRequest((r) => r.url().includes(`/owners/${OWNER_ID}`));
  const listCall = page.waitForRequest((r) => r.url().includes('/properties') && r.url().includes(`owner=${OWNER_ID}`));

  await page.goto(`/owner/${OWNER_ID}`);
  await cardCall;
  await listCall;

  /* A positive anchor, so this cannot pass by the page failing to load. */
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

/**
 * "No reviews yet" and "we could not fetch the reviews" are the two states the page must never
 * confuse: one is a statement about the owner, the other a statement about us.
 */
test('the owner reviews block is fed by the entity-review endpoint', async ({ page }) => {
  const reviewCall = page.waitForRequest((r) => r.url().includes(`/reviews/owner/${OWNER_ID}`));
  await page.goto(`/owner/${OWNER_ID}`);
  await reviewCall;

  /* Exactly one of the three states, and never the skeleton once the read has settled. The seed
     makes no promise about whether this owner has reviews, so the assertion is that the section
     resolved, not which way it resolved. */
  await expect(page.getByTestId('owner-reviews-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('owner-reviews-unavailable')).toHaveCount(0);
});

/**
 * The branch is unreachable from any fixture, so the failure is forced at the network rather than
 * by stubbing the service, keeping the page on the code path a real outage would take.
 */
test('when the reviews read fails the page says so instead of showing an empty list', async ({ page }) => {
  await page.route(`**/api/reviews/owner/${OWNER_ID}*`, (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.goto(`/owner/${OWNER_ID}`);

  await expect(page.getByTestId('owner-reviews-unavailable')).toBeVisible();
  /* And it must not also claim the owner has no reviews. Showing both would be the page telling the
     visitor something about the owner that it does not know. */
  await expect(page.getByTestId('owner-reviews-empty')).toHaveCount(0);
});

/**
 * These are about what a visitor sees rather than what the API sends: the regression they guard is
 * a rendering decision, since Call and WhatsApp on the profile turn a per-listing grant personal.
 */
test('the header renders the owner the API returned, with the trust badges and stat labels', async ({ page }) => {
  /* The name is read from the API rather than written into the spec, so a regenerated seed does not
     have to be chased through a literal here. */
  const card = await (await fetch(`${API}/owners/${OWNER_ID}`)).json();

  await page.goto(`/owner/${OWNER_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: card.name })).toBeVisible();

  await expect(page.getByText('Verified Owner').first()).toBeVisible();
  await expect(page.getByText('Zero Brokerage', { exact: true })).toBeVisible();
  /* A substring, not the whole line: `owner.roleLine` contains a U+00B7 middle dot, and a
     byte-exact matcher against a character that survives three encodings on the way into this file
     fails as a generic timeout that names nothing. */
  await expect(page.getByText('Direct dealing, no middlemen')).toBeVisible();

  await expect(page.getByText('Properties Listed')).toBeVisible();
  await expect(page.getByText('Member Since')).toBeVisible();
});

test('the listing rail and the About section render for a live owner', async ({ page }) => {
  await page.goto(`/owner/${OWNER_ID}`);

  await expect(page.getByRole('heading', { name: 'About the Owner' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Properties by this Owner' })).toBeVisible();

  /* Pinned to the count the facet actually reports rather than to "more than zero". The rail and
     the endpoint are the two things that must agree; `toBeGreaterThan(0)` would stay green if the
     rail silently rendered one card out of eight. */
  const facet = await (await fetch(`${API}/properties?owner=${OWNER_ID}&size=${WHOLE_CATALOGUE}`)).json();
  expect(facet.content.length, 'the fixture owner must hold public stock').toBeGreaterThan(0);
  const cards = page.locator('#owner-listings a[href^="/property/"]');
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(facet.content.length);
});

test('a visitor is routed to a listing and is never offered the number', async ({ page }) => {
  await page.goto(`/owner/${OWNER_ID}`);
  /* A positive readiness gate before any assertion of absence, or all four pass on an unmounted
     page. */
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  /* In-app chat is L1 and needs no number, so Message stays available to anyone. */
  await expect(page.getByRole('button', { name: 'Message' })).toBeVisible();

  /* Asked by role `link`, which is the role `Owner.jsx` actually uses — Call and WhatsApp are `tel:`
     and `wa.me` anchors, so a `button` assertion is green against the very markup it forbids. */
  await expect(page.getByRole('link', { name: 'Call' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveCount(0);
  /* And nothing anywhere offers to reveal it, whatever element it might be built from. */
  await expect(page.getByText('Request number', { exact: true })).toHaveCount(0);

  /* The number stays masked on screen. `maskPhone('98XXXXX210')` renders '+91 98••• •••10', so the
     server's mask and the page's mask compose rather than one undoing the other. */
  await expect(page.getByText(/^\+91 \d\d••• •••\d\d$/).first()).toBeVisible();

  /* The CTA points at the listings, where the gate actually lives. */
  const viaListing = page.getByRole('link', { name: 'Contact via a listing' }).first();
  await expect(viaListing).toBeVisible();
  await expect(viaListing).toHaveAttribute('href', '#owner-listings');
});

test('an unknown owner renders the not-found screen, not an empty profile', async ({ page }) => {
  /* The sibling contract test above asserts the API answers 404 for the same three shapes. This one
     asserts the *screen*, which is a separate claim: a 404 the page renders as a blank profile
     header is still a 404. */
  await page.goto('/owner/NOPE-does-not-exist');

  await expect(page.getByRole('heading', { name: 'Owner not found' })).toBeVisible();
  await expect(page.getByText('This profile may have been removed or the link is incorrect.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Browse listings/i })).toBeVisible();
});

test('the owner profile loads with no console errors', async ({ page, consoleErrors }) => {
  await page.goto(`/owner/${OWNER_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

/**
 * The three trust claims are tested together because a trust surface assembled from constants
 * renders identically for a seller who has earned each mark and one who has earned none.
 */

/** The header's stat tiles, as `{ label: value }`, read off the rendered page. */
async function statTiles(page) {
  const tiles = page.locator('#owner-header-stats > div');
  await expect(tiles.first()).toBeVisible();
  const pairs = await tiles.evaluateAll((els) =>
    els.map((el) => [el.children[1]?.textContent?.trim(), el.children[0]?.textContent?.trim()]));
  return Object.fromEntries(pairs);
}

/**
 * A locator rather than a snapshot, so the assertion retries: the profile and the listing rail are
 * independent reads, and a one-shot read can catch the window where the tile still shows an dash.
 */
const tileValue = (page, label) =>
  page.locator('#owner-header-stats > div').filter({ hasText: label }).locator('p').first();

/** What share of this owner's public stock the catalogue itself marks verified, as the page prints it. */
async function verifiedShare(ownerId) {
  const facet = await (await fetch(`${API}/properties?owner=${ownerId}&size=${WHOLE_CATALOGUE}`)).json();
  expect(facet.content.length, 'the fixture owner must hold public stock').toBeGreaterThan(0);
  const verified = facet.content.filter((r) => r.verified).length;
  return `${Math.round((verified / facet.content.length) * 100)}%`;
}

/** The "About the Owner" card, scoped by its own heading so the listing rail cannot answer for it. */
const about = (page) =>
  page.locator('div.glass-card').filter({ has: page.getByRole('heading', { name: 'About the Owner' }) });

test('the Verified Owner pill is shown only to owners the server calls verified', async ({ page }) => {
  /* Both arms read from the API rather than asserted as literals, so re-seeding cannot make this
     test quietly stop testing anything. The two `expect`s on the cards are the anti-vacuity guard:
     if the seed ever loses its unverified owner, this fails here naming the reason rather than
     going green on an absence that has become unreachable. */
  const yes = await (await fetch(`${API}/owners/${OWNER_ID}`)).json();
  const no = await (await fetch(`${API}/owners/${UNVERIFIED_OWNER_ID}`)).json();
  expect(yes.verified, `${OWNER_ID} is the verified fixture`).toBe(true);
  expect(no.verified, `${UNVERIFIED_OWNER_ID} is the unverified fixture`).toBe(false);

  await page.goto(`/owner/${OWNER_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: yes.name })).toBeVisible();
  await expect(page.getByTestId('owner-verified-pill')).toBeVisible();
  await expect(page.getByTestId('owner-verified-pill')).toHaveText(/Verified Owner/);
  /* The claim has a second home, and gating only the header would have changed nothing a visitor
     sees: the About block printed its own emerald "Verified Owner" badge unconditionally, in the
     same viewport the pill had just been withheld from. Asserted on both owners, scoped to the
     About card so the listing rail cannot answer for it. */
  await expect(about(page).getByText('Verified Owner', { exact: true })).toHaveCount(1);

  await page.goto(`/owner/${UNVERIFIED_OWNER_ID}`);
  /* The heading first, so the absence below is an absence on a painted page and not on an empty
     one — the failure mode every negative assertion in a browser has. */
  await expect(page.getByRole('heading', { level: 1, name: no.name })).toBeVisible();
  /* By test id rather than by text. The rail underneath renders listing cards that carry their own
     "Verified Owner" wording, so a text matcher would be answered by a card and report the header's
     pill as present on the very owner whose profile must not show one. */
  await expect(page.getByTestId('owner-verified-pill')).toHaveCount(0);
  await expect(about(page).getByText('Verified Owner', { exact: true })).toHaveCount(0);
  /* Anchored on a badge that survives on every profile, so the absence above cannot be satisfied by
     an About card whose badge row failed to render at all. */
  await expect(about(page).getByText('Number Protected', { exact: true })).toHaveCount(1);
});

test('the About block claims only what the server states about this seller', async ({ page }) => {
  /* "Ownership Verified" is absent for both owners because the server makes that claim only per
     listing: a verified identity is not verified title, and there is no owner-level field. */
  await page.goto(`/owner/${OWNER_ID}`);
  await expect(about(page)).toContainText('is a verified property owner');
  await expect(about(page).getByText('Ownership Verified', { exact: true })).toHaveCount(0);

  await page.goto(`/owner/${UNVERIFIED_OWNER_ID}`);
  await expect(about(page)).toBeVisible();
  await expect(about(page)).not.toContainText('verified property owner');
  await expect(about(page)).toContainText('lists directly on Draazy');
  await expect(about(page).getByText('Ownership Verified', { exact: true })).toHaveCount(0);
  /* Number Protected stays on both, and is asserted so the two absences above cannot be satisfied
     by an About block that failed to render its badge row at all. */
  await expect(about(page).getByText('Number Protected', { exact: true })).toHaveCount(1);
});

test('Verified Listings is this owner\'s own share, not a constant', async ({ page }) => {
  const mixed = await verifiedShare(OWNER_ID);
  const all = await verifiedShare(UNVERIFIED_OWNER_ID);

  /* The pair must actually differ, or a page still printing `100%` would pass both halves. The
     seed gives one owner some unverified stock and the other none; if that ever stops being true
     the test says so instead of silently becoming a tautology. */
  expect(mixed, 'the fixtures must disagree for this test to mean anything').not.toBe(all);
  expect(all).toBe('100%');

  await page.goto(`/owner/${OWNER_ID}`);
  await expect(tileValue(page, 'Verified Listings')).toHaveText(mixed);

  await page.goto(`/owner/${UNVERIFIED_OWNER_ID}`);
  await expect(tileValue(page, 'Verified Listings')).toHaveText(all);
});

test('the header states no response time, because nothing measures one', async ({ page }) => {
  await page.goto(`/owner/${OWNER_ID}`);
  const tiles = await statTiles(page);

  /* Absence of the label, not merely of the number. Rendering "Avg. Response Time —" would still
     tell the visitor the platform tracks this and happens not to know it for this seller, which is
     as untrue as `~2 hrs` was and is the shape a half-fix takes. */
  expect(Object.keys(tiles)).not.toContain('Avg. Response Time');
  expect(Object.values(tiles).join(' ')).not.toContain('hrs');

  /* And the tiles that remain are the ones the API can source. Asserted as the whole set rather
     than three `toContain`s, because the regression worth catching is a fourth tile appearing. */
  expect(Object.keys(tiles).sort()).toEqual(['Member Since', 'Properties Listed', 'Verified Listings']);
});

