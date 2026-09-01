// @ts-check
/**
 * Whose society the hub is showing — live.
 *
 * `useSocietyHub` used to resolve its building out of `data/societies.js`, the 348 curated and
 * MahaRERA rows bundled into the JavaScript. A slug the bundle did not carry fell through to
 * `genericSociety()`: a fabricated row with the slug title-cased for a name, the slug reused as a
 * locality, `registration: false`, `conveyance: false` and no specification at all.
 *
 * That fallback exists for a real case — somebody types a URL for a building nobody has ever
 * added — but it was catching a case it was never meant to. Every society **minted through the
 * API** is absent from the bundle by construction, so ops could confirm a building, residents could
 * join it and owners could list flats in it, and its page would still open as a stub with the wrong
 * name and the wrong locality. The building existed everywhere except on its own page.
 *
 * The two tests below are the two halves of that. The first uses a seeded society that is in the
 * database and demonstrably **not** in the bundle — `greenfield-residency-baner` appears zero times
 * in `data/societies.js` — which is the exact state the defect lived in. The second mints one
 * during the run, so the row cannot have been in any bundle, any fixture or any browser.
 *
 * Both assert the page against the row read back **over HTTP, outside the browser**, rather than
 * against a literal. A hard-coded 'Greenfield Residency' would also pass against a page that
 * happened to print the right string for the wrong reason; comparing against what the server just
 * said is the only version that cannot.
 *
 * ## What makes these fail if the read regresses
 *
 * `name` alone is a weak discriminator for a minted society, because its slug is derived from its
 * name and title-casing the slug nearly reproduces it. The **locality** is the strong one:
 * `genericSociety` sets `localitySlug` to the society's own slug, so the breadcrumb points at
 * `/locality/zz-live-…`, a locality that does not exist. The server says `wakad`. Those two can
 * never coincide.
 */
import { expect, test } from '../../../fixtures/live.js';
import { API, signedInAsNew } from '../../../helpers/liveAuth.js';
import { mintSociety } from '../../../helpers/liveSociety.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/**
 * A society seeded into the database and absent from the bundled catalogue.
 *
 * Seeded by `R__zz_dev_demo_data.sql` as the confirmed community society: `source: 'community'`,
 * `verified_at` set, and — deliberately — `registration` and `conveyance` both still false, because
 * confirming that a building exists is not a statement about its paperwork. Title-casing its slug
 * gives "Greenfield Residency Baner", which is not its name, so the stub and the real row are
 * distinguishable on the heading alone.
 */
const DB_ONLY = 'greenfield-residency-baner';

/** The hub, open and painted. The h1 is the society's name, so waiting on it waits on the read. */
async function openHub(page, slug) {
  await page.goto(`${BASE}/society/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
}

test('a society the bundled catalogue has never heard of opens as itself, not as a stub', async ({ page, request }) => {
  // The row, from outside the browser. Everything below is compared against this.
  const res = await request.get(`${API}/societies/${DB_ONLY}`);
  expect(res.status()).toBe(200);
  const row = await res.json();
  expect(row.slug).toBe(DB_ONLY);
  expect(row.localitySlug).not.toBe(DB_ONLY); // the premise: locality and slug differ, so they can disagree

  await openHub(page, DB_ONLY);

  // The name the server holds, not the slug with its capitals fixed.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(row.name);

  /* The breadcrumb's locality link. This is the assertion the old code could not pass under any
     reading: `genericSociety` puts the *slug* in `localitySlug`, so the link pointed at
     `/locality/greenfield-residency-baner` — a locality page for a building. */
  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: /./ });
  await expect(crumb.nth(1)).toHaveAttribute('href', `/locality/${row.localitySlug}`);

  /* And the badge, which is a fact the server owns: this row carries `verifiedAt`. The stub carries
     nothing, so it can never wear one — which means this line also fails if the hub goes back to
     deciding verification from `registration && conveyance`, both of which are false here. */
  expect(row.verifiedAt).not.toBeNull();
  await expect(page.getByText('Society Verified').first()).toBeVisible();
});

test('a society minted during this run opens as itself', async ({ page, request }) => {
  const author = await signedInAsNew(page);
  const slug = await mintSociety(request, author, 'identity');

  /* Minted seconds ago, so it cannot be in the bundle, in a fixture, or in this browser's storage.
     This is the state every society created after the seed is permanently in. */
  const res = await request.get(`${API}/societies/${slug}`);
  expect(res.status()).toBe(200);
  const row = await res.json();

  await openHub(page, slug);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(row.name);

  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: /./ });
  await expect(crumb.nth(1)).toHaveAttribute('href', `/locality/${row.localitySlug}`);
  // Not the fallback's idea of a locality, which is the society itself.
  await expect(crumb.nth(1)).not.toHaveAttribute('href', `/locality/${slug}`);

  /* Nobody has confirmed it, and the page says so rather than inventing specs — the honest branch
     is still reachable, it is just no longer where every real society lands. */
  await expect(page.getByText('Society Verified')).toHaveCount(0);
});

test('a slug no society has still renders the honest placeholder', async ({ page, request }) => {
  /* The fallback's real job, kept nailed down. Now that a missing society is a 404 from the seam
     rather than a miss against a bundled array, this is the branch most likely to be lost — a
     provider that let the 404 throw would leave this page blank or crashed instead of honest. */
  const slug = `zz-no-such-society-${Date.now().toString(36)}`;
  const res = await request.get(`${API}/societies/${slug}`);
  expect(res.status()).toBe(404);

  await openHub(page, slug);
  await expect(page.getByText('Society Verified')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
