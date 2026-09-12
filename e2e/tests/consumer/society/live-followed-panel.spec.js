import { expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { mintSociety } from '../../../helpers/liveSociety.js';

/* What the dashboard's followed-societies panel says each followed society *is*.
 *
 * `consumer/society/live-follows.spec.js` already proves the panel lists the right *slugs* — that a
 * follow made on the directory reaches this panel, that the count tile agrees with it, and that an
 * unfollow removes the row. Every one of those assertions is about membership, and all of them
 * passed while the row itself was wrong.
 *
 * The description beside each slug came from `resolveSociety`, a lookup into the 348 curated and
 * MahaRERA rows compiled into `data/societies.js`. Societies minted through the API are absent from
 * that bundle by construction, so a building the user went and followed deliberately rendered with
 * the slug title-cased for a name, no locality chip and no managed tag: the least informative row
 * on the panel belonged to the society they cared most about. Nothing errored and nothing looked
 * broken — it looked like a building nobody had filled in.
 *
 * So the subject here is only the *contents* of a row, checked against the record read back over
 * HTTP from outside the browser, for a society this build could not have known about at compile
 * time. The society is minted during the run: it cannot be in the bundle, and its name is unique to
 * this run, so a passing assertion cannot be a coincidence with a seeded row.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/**
 * Mint a society, follow it, and sign the browser in — **in that order**, on a throwaway account.
 *
 * The order is not stylistic. `authHeaders` logs in over HTTP to get a token, and every login
 * rotates the account's refresh-token family; doing that *after* the browser has a session leaves
 * the page holding a token the server has since superseded, and it signs itself out on the next
 * call. The visible symptom is an empty follow list on a dashboard that looks perfectly healthy —
 * "No societies followed yet" for a follow the server accepted with a 204, which reads as a bug in
 * the panel. So all the API work finishes before the browser is given a session, and the browser's
 * is the last session issued.
 *
 * @returns the minted slug and the row the server holds for it, read back over HTTP.
 */
async function followedSocietyFor(page, request, label) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const slug = await mintSociety(request, mobile, label);

  const follow = await request.put(`${API}/me/societies/${slug}/follow`, { headers });
  expect(follow.status(), 'the follow should have been accepted').toBe(204);

  /* Read before the page is opened, so the expectation cannot be a copy of what the page drew. */
  const res = await request.get(`${API}/societies/${slug}`);
  expect(res.status()).toBe(200);
  const row = await res.json();

  await signedInAs(page, mobile);
  return { slug, row };
}

test('a followed society the bundle has never heard of is described, not merely listed', async ({ page, request }) => {
  /* Minted through the API rather than through the wizard UI: the wizard's own mint is proven
     elsewhere, and going through it here would make a failure ambiguous between the two. */
  const { slug, row } = await followedSocietyFor(page, request, 'followpanel');

  /* The premise. If a minted society ever did land in the bundle this spec would go on passing
     while proving nothing, so the discriminator is asserted rather than assumed: the stub reuses
     the society's own slug as its locality, and a real row does not. */
  expect(row.localitySlug, 'a real society is not its own locality').not.toBe(slug);
  expect(row.name).toBeTruthy();

  /* The panel lives on the dashboard's Alerts tab, not its landing pane. */
  await page.goto(`${BASE}/dashboard#alerts`);

  const card = page.locator('.rounded-2xl').filter({
    has: page.getByRole('link', { name: row.name, exact: true }),
  }).first();
  await expect(card, 'the followed society should appear under its own name').toBeVisible({ timeout: 30_000 });

  /* The locality chip is the assertion that carries the port. The name alone is too weak: the stub
     derives it from the slug, and `mintSociety` names societies *after* the slug they produce, so a
     title-cased slug and the real name can be one character apart. The locality cannot coincide —
     the stub can only ever put the slug there. */
  await expect(card.getByText(titleCase(row.localitySlug), { exact: false }).first()).toBeVisible();
  await expect(card.getByText(titleCase(slug), { exact: false })).toHaveCount(0);

  /* And the link still goes to the society, so the row is usable and not merely correct. */
  await expect(card.getByRole('link', { name: row.name, exact: true }))
    .toHaveAttribute('href', `/society/${slug}`);
});

test('the panel does not invent a managed tag for a society nobody has claimed', async ({ page, request }) => {
  /* The other field the row draws, and the one with teeth: "Managed" claims a committee is running
     this building on Draazy. A freshly minted society is `unclaimed`, and the tag must be absent
     — a panel that read `claimStatus` off the wrong record, or off a stub where the field does not
     exist at all, could produce it from nothing. The status is read back over HTTP rather than
     assumed, so the test fails loudly if a mint's meaning ever changes. */
  const { row } = await followedSocietyFor(page, request, 'followclaim');
  expect(row.claimStatus, 'a society nobody has claimed').toBe('unclaimed');

  await page.goto(`${BASE}/dashboard#alerts`);
  const card = page.locator('.rounded-2xl').filter({
    has: page.getByRole('link', { name: row.name, exact: true }),
  }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('Managed', { exact: true })).toHaveCount(0);
});

/** The panel's own transform, duplicated so the expectation is independent of the code under test. */
function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
