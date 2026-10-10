import { ACTORS, expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListing } from '../../../helpers/moderation.js';

async function publishFlat(request, locality, bhk) {
  const headers = await authHeaders(uniqueMobile());
  const res = await request.post(`${API}/me/listings`, {
    headers,
    data: {
      title: `Zztest landing ${Date.now()}`,
      deal: 'rent',
      propertyType: 'apartment',
      bhk,
      price: 25000,
      locality,
      city: 'Pune',
      images: await uploadedListingPhotos(headers),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { id } = await res.json();
  const approved = await approveListing(request, id, await authHeaders(ACTORS.admin));
  expect(approved.status(), await approved.text()).toBeLessThan(300);
  return id;
}

const total = async (request, url) => (await (await request.get(`${API}${url}`)).json()).totalElements;

test('a rent landing page lists its homes, links the guide and the equivalent search, and is canonical', async ({ page, request }) => {
  const ids = [];
  for (let i = 0; i < 3; i += 1) ids.push(await publishFlat(request, 'Kothrud', 2));

  await page.goto('/rent/kothrud/2-bhk');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2 BHK flats for rent in Kothrud, Pune');
  await expect(page).toHaveTitle('2 BHK flats for rent in Kothrud, Pune | Draazy');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/rent/kothrud/2-bhk');
  for (const id of ids) await expect(page.locator(`a[href^="/property/"][href$="${id}"]`).first()).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('a[href="/locality/kothrud"]').first()).toBeVisible();
  await expect(page.locator('a[href="/buy/kothrud/2-bhk"]')).toBeVisible();
  await expect(page.locator('a[href="/rent/kothrud/3-bhk"]')).toBeVisible();
  await expect(page.locator('a[href^="/listings?deal=rent&loc=kothrud&bhks=2"]')).toBeVisible();
});

test('a landing page is noindex exactly when it has fewer open listings than its threshold', async ({ page, request }) => {
  const open = await total(request, '/properties?deal=buy&localities=hinjawadi&bhks=4&size=1');
  await page.goto('/buy/hinjawadi/4-bhk');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('4 BHK flats for sale in Hinjawadi, Pune');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(open >= 3 ? 0 : 1);
  if (open < 3) await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});

test('the city pages render', async ({ page }) => {
  await page.goto('/rent/pune');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flats and homes for rent in Pune');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/rent/pune');
  await page.goto('/buy/pune');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flats and homes for sale in Pune');
});

test('an unknown area or BHK is not found', async ({ page }) => {
  for (const path of ['/rent/nowhere', '/buy/baner/5-bhk', '/rent/baner/studio', '/rent/pune/2-bhk']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  }
});

test('a flatmate locality page is canonical and indexed only with three live posts', async ({ page, request }) => {
  const live = await total(request, '/flatmates/feed?tab=move-in&locality=Baner&size=1');
  await page.goto('/flatmates/baner');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flats and rooms to share in Baner, Pune');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/flatmates/baner');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(live >= 3 ? 0 : 1);
  await expect(page.locator('a[href="/locality/baner"]')).toBeVisible();
});

test('the women-only flatmate page renders and an unknown flatmate area is not found', async ({ page }) => {
  await page.goto('/flatmates/women-only-pune');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Women-only flats and rooms to share in Pune');
  await page.goto('/flatmates/nowhere');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
});

test('the flatmates board and a post detail route still work beside the landing pages', async ({ page }) => {
  await page.goto('/flatmates');
  await expect(page.getByRole('button', { name: 'Map' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Flats and rooms to share in/ })).toHaveCount(0);
  await page.goto('/flatmates/room/does-not-exist');
  await expect(page.getByText('This post isn’t available.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Flats and rooms to share in/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/flatmates\/room\/does-not-exist$/);
});
