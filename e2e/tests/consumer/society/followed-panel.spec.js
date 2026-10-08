import { expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { mintSociety } from '../../../helpers/liveSociety.js';

/* Each followed society's row description must come from the server's record (read back over HTTP for a society minted this run),
 * not a slug-derived stub; `follows.spec.js` already covers membership. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/** Mint, follow, then sign the browser in, in that order: every `authHeaders` login rotates the refresh-token family, so a later API login signs the page out. */
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

test('a followed society is described from the server record, not merely listed', async ({ page, request }) => {
  /* Minted through the API rather than through the wizard UI: the wizard's own mint is proven
     elsewhere, and going through it here would make a failure ambiguous between the two. */
  const { slug, row } = await followedSocietyFor(page, request, 'followpanel');

  expect(row.localitySlug, 'a real society is not its own locality').not.toBe(slug);
  expect(row.name).toBeTruthy();

  /* The panel lives on the dashboard's Alerts tab, not its landing pane. */
  await page.goto(`${BASE}/dashboard#alerts`);

  const card = page.locator('.rounded-2xl').filter({
    has: page.getByRole('link', { name: row.name, exact: true }),
  }).first();
  await expect(card, 'the followed society should appear under its own name').toBeVisible({ timeout: 30_000 });

  /* The locality chip is the strong assertion: the stub derives the name from the slug,
     so names can nearly coincide but the locality cannot. */
  await expect(card.getByText(titleCase(row.localitySlug), { exact: false }).first()).toBeVisible();
  await expect(card.getByText(titleCase(slug), { exact: false })).toHaveCount(0);

  /* And the link still goes to the society, so the row is usable and not merely correct. */
  await expect(card.getByRole('link', { name: row.name, exact: true }))
    .toHaveAttribute('href', `/society/${slug}`);
});

test('the panel draws no managed tag and the society record carries no claim state', async ({ page, request }) => {
  /* The record must not carry `claimStatus` and the row must not draw a "Managed" tag, which would claim a committee runs the building. */
  const { row } = await followedSocietyFor(page, request, 'followclaim');
  expect(row, 'claim state left the society record').not.toHaveProperty('claimStatus');

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
