import { ACTORS, expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListing } from '../../../helpers/moderation.js';

async function publishPlot(request) {
  const headers = await authHeaders(uniqueMobile());
  const res = await request.post(`${API}/me/listings`, {
    headers,
    data: {
      title: `Zztest seo url ${Date.now()}`,
      deal: 'buy',
      propertyType: 'Open Plot',
      price: 6500000,
      locality: 'Wagholi',
      city: 'Pune',
      area: 12,
      areaUnit: 'guntha',
      landUse: 'residential',
      facing: 'East',
      formDetails: { plotZone: 'Residential', openSides: '2', roadWidth: '30' },
      images: await uploadedListingPhotos(headers),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { id } = await res.json();
  const approved = await approveListing(request, id, await authHeaders(ACTORS.admin));
  expect(approved.status(), await approved.text()).toBeLessThan(300);
  return id;
}

test('a listing is linked, titled and canonical at its descriptive URL, and a stale name still opens it', async ({ page, request }) => {
  const id = await publishPlot(request);
  const path = `/property/open-plot-for-sale-wagholi-${id}`;

  await page.goto('/listings?deal=buy&type=plot&landuse=residential');
  await expect(page.locator(`a[href="${path}"]`).first()).toBeVisible();

  await page.goto(`/property/renamed-long-ago-${id}`);
  await expect(page).toHaveTitle(/^Open Plot for Sale in Wagholi, Pune: ₹65 L \| Draazy$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://draazy.com${path}`);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test('a seeded listing keeps its hand-set slug as its canonical', async ({ page }) => {
  await page.goto('/property/p5013');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/property/p5013');
});

test('robots lists the listing and society sitemaps', async ({ page }) => {
  const robots = await (await page.request.get('/robots.txt')).text();
  expect(robots).toMatch(/^Sitemap: https:\/\/draazy\.com\/sitemaps\/properties\.xml\r?$/m);
  expect(robots).toMatch(/^Sitemap: https:\/\/draazy\.com\/sitemaps\/societies\.xml\r?$/m);
});
