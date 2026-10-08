/** Live society hub through the UI: signs a real person in, clicks the control a member clicks, and reads the result from the ops queue so a dialog that
 * closes without filing cannot pass. Needs backend :8081 (`local,e2e`); uses "Skyline Heights, Baner" except the report test, which mints its own. */
import { test, expect } from '@playwright/test';
import { signIn, authHeaders, uniqueMobile, API } from '../helpers/liveAuth.js';
import { mintSociety, seedSocietyReviews, mintPickableSociety, publishSocietyListing, retireListing } from '../helpers/liveSociety.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';

/* A staff account is the only way to read the moderation queue; 9000000000 is the seeded admin and
   is what every other back-office live spec uses. */
const ADMIN = '9000000000';

/** Land on the hub and wait for the heading, which only paints once the society read resolves. */
async function openHub(page, tab, slug = SLUG) {
  await page.goto(`${BASE}/society/${slug}${tab ? `?tab=${tab}` : ''}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
}

test('the retired /hub aggregate read is gone, while the society itself is still public', async ({ request }) => {
  const hub = await request.get(`${API}/societies/${SLUG}/hub`);
  expect(hub.status(), 'GET /societies/{slug}/hub must no longer serve the community hub').toBeGreaterThanOrEqual(400);
  expect(hub.status()).not.toBe(500);

  const society = await request.get(`${API}/societies/${SLUG}`);
  expect(society.status(), await society.text()).toBe(200);
  const body = await society.json();
  expect(body.slug).toBe(SLUG);
  for (const gone of ['verifiedAt', 'claimStatus', 'verified']) expect(body, `${gone} left the society response`).not.toHaveProperty(gone);
});

test('a signed-out visitor who follows a society is sent to a sign-in that names the society', async ({ page }) => {
  await openHub(page);
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(page).toHaveURL(/\/signin/, { timeout: 10000 });
  await expect(page.getByText('Sign in to follow or review this society')).toBeVisible();
});

test('the hub homes come from the society read, with no separate listings search', async ({ page }) => {
  const name = `Zz Homes ${Date.now().toString(36)} Heights`;
  const slug = await mintPickableSociety(uniqueMobile(), name);
  const id = await publishSocietyListing(slug, name);
  try {
    const searches = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/properties' && u.searchParams.has('society')) searches.push(r.url());
    });

    await openHub(page, undefined, slug);
    await expect(page.getByRole('tab', { name: /Homes/ })).toBeVisible();
    await page.getByRole('tab', { name: /Homes/ }).click();
    await expect(page.locator('main a[href^="/property/"]').first()).toBeVisible();
    expect(searches, 'homes must arrive on GET /societies/{slug}').toEqual([]);
  } finally {
    await retireListing(id);
  }
});

test('a slug no society holds is a thin page that cannot be followed or reviewed', async ({ page }) => {
  await openHub(page, undefined, `zz-no-such-society-${Date.now().toString(36)}`);
  await expect(page.getByRole('button', { name: /^Follow/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Location/ })).toHaveCount(0);
});

test('a failed society read shows an error panel with Retry, and Retry recovers', async ({ page }) => {
  const slug = await mintSociety(page.request, uniqueMobile(), 'hubretry');
  const url = new RegExp(`/api/societies/${slug}(\\?.*)?$`);
  await page.route(url, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    : route.continue()));

  await page.goto(`${BASE}/society/${slug}`);
  await expect(page.getByText("Couldn't load this society.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /^Follow/ })).toHaveCount(0);

  await page.unroute(url);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Couldn't load this society.")).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
});

test('a society review reported on the hub lands in the ops queue with its reason code', async ({ page, request }) => {
  const slug = await mintSociety(request, uniqueMobile(), 'hubreport');
  await seedSocietyReviews(request, slug, 3);
  const mobile = uniqueMobile();
  await signIn(page, mobile);

  await openHub(page, 'reviews', slug);
  await expect(page.getByRole('tab', { name: /Reviews/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Report review' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Report review' });
  await expect(dialog).toBeVisible();
  const details = `Looks scripted ${Date.now()}`;
  await dialog.getByRole('button', { name: /Abusive or offensive review/ }).click();
  await dialog.getByPlaceholder(/Add any details/i).fill(details);
  await dialog.getByRole('button', { name: 'Submit report' }).click();
  // Unscoped `toHaveCount(0)` can never pass however well the report worked.
  await expect(page.getByRole('dialog', { name: 'Report review' })).toHaveCount(0, { timeout: 10000 });

  const res = await request.get(`${API}/reports?targetType=review&status=open&size=100`, { headers: await authHeaders(ADMIN) });
  expect(res.status()).toBe(200);
  const mine = ((await res.json()).content || []).find((r) => (r.details || '').includes(details));
  expect(mine, 'the report filed through the hub is missing from the ops queue').toBeTruthy();
  expect(mine.reason).toBe('abuse');
  expect(mine.targetType).toBe('review');
});
