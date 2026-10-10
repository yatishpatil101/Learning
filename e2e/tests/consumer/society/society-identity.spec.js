// @ts-check
/** The hub opens a society as the row the API holds, never a slug-built stub; the breadcrumb locality link
 * discriminates (stub: /locality/<society slug>, real row: its locality). */
import { expect, test } from '../../../fixtures/live.js';
import { API, signedInAsNew } from '../../../helpers/liveAuth.js';
import { mintSociety } from '../../../helpers/liveSociety.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/** A demo-seed society with no builder or specification: its slug and its name differ. */
const DB_ONLY = 'greenfield-residency-baner';

/** The hub, open and painted. The h1 is the society's name, so waiting on it waits on the read. */
async function openHub(page, slug) {
  await page.goto(`${BASE}/society/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
}

test('a seeded society opens as itself, not as a stub', async ({ page, request }) => {
  // The row, from outside the browser. Everything below is compared against this.
  const res = await request.get(`${API}/societies/${DB_ONLY}`);
  expect(res.status()).toBe(200);
  const row = await res.json();
  expect(row.slug).toBe(DB_ONLY);
  expect(row.localitySlug).not.toBe(DB_ONLY); // the premise: locality and slug differ, so they can disagree

  await openHub(page, DB_ONLY);

  // The name the server holds, not the slug with its capitals fixed.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(row.name);

  /* A slug-built stub puts the society slug in `localitySlug`, linking to a locality page for a building. */
  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: /./ });
  await expect(crumb.nth(2)).toHaveAttribute('href', `/locality/${row.localitySlug}`);

});

test('a society minted during this run opens as itself', async ({ page, request }) => {
  const author = await signedInAsNew(page);
  const slug = await mintSociety(request, author, 'identity');

  const res = await request.get(`${API}/societies/${slug}`);
  expect(res.status()).toBe(200);
  const row = await res.json();

  await openHub(page, slug);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(row.name);

  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: /./ });
  await expect(crumb.nth(2)).toHaveAttribute('href', `/locality/${row.localitySlug}`);
  // Not the fallback's idea of a locality, which is the society itself.
  await expect(crumb.nth(2)).not.toHaveAttribute('href', `/locality/${slug}`);

  await expect(page.getByText('Society Verified')).toHaveCount(0);
});
