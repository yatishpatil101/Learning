import { test, expect } from '@playwright/test';
import { API, seedConsent } from '../../../helpers/liveAuth.js';

const RERA_LISTING = 'p5013';
const NO_RERA_LISTING = 'p5000';
const MAP_LISTING = 'p5150';

const get = async (path) => {
  const res = await fetch(`${API}${path}`);
  expect(res.ok, `GET ${path} answered ${res.status}`).toBe(true);
  return res.json();
};

const markerLabel = (price) => (price >= 1e7
  ? '₹' + (price / 1e7).toFixed(2) + 'Cr'
  : '₹' + Math.round(price / 1e5) + 'L');

test.beforeEach(async ({ page }) => {
  await seedConsent(page);
});

test('the RERA registration is the API reraId and opens MahaRERA verification, and a listing without one makes no RERA claim', async ({ page }) => {
  test.slow();

  await test.step('RERA registration uses the API reraId and opens MahaRERA verification', async () => {
    const detail = await get(`/properties/${RERA_LISTING}`);
    expect(detail.reraId, `${RERA_LISTING} must carry a real RERA id on the wire`).toMatch(/^P\d{11}$/);

    await page.goto(`/property/${RERA_LISTING}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });

    const linkName = new RegExp(`MahaRERA:\\s*${detail.reraId}`);
    const headerLink = page.locator('main').getByRole('link', { name: linkName }).first();
    await expect(headerLink).toBeVisible();
    await expect(headerLink).toHaveAttribute('href', 'https://maharera.maharashtra.gov.in/');
    await expect(headerLink).toHaveAttribute('target', '_blank');
    await expect(headerLink).toHaveAttribute('rel', /noopener/);
    await expect(page.locator('main')).not.toContainText(/RERA approved/i);

    await page.getByRole('tab', { name: /Verification & Docs/i }).click();
    await expect(page.locator('main').getByRole('link', { name: linkName })).toHaveCount(2);
  });

  await test.step('a listing without reraId renders no RERA registration claim', async () => {
    const detail = await get(`/properties/${NO_RERA_LISTING}`);
    expect(detail.reraId ?? null, `${NO_RERA_LISTING} must not carry a RERA id on the wire`).toBeNull();

    await page.goto(`/property/${NO_RERA_LISTING}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });
    await page.getByRole('tab', { name: /Verification & Docs/i }).click();

    await expect(page.locator('main')).not.toContainText(/MahaRERA|RERA registered|RERA approved|\bRERA\b/i);
  });
});

test('listing cards and map drawer avoid fabricated Draazy verification and connectivity copy', async ({ page }) => {
  const detail = await get(`/properties/${RERA_LISTING}`);
  expect(detail.ownerVerified).toBe(true);
  const rows = (await get('/properties?deal=buy&localities=baner&size=100')).content;
  const cardRow = rows.find((p) => p.slug === RERA_LISTING);
  expect(cardRow?.ownerVerified).toBe(true);

  await page.goto('/listings?deal=buy&loc=baner', { waitUntil: 'domcontentloaded' });
  const card = page.locator(`a[href="/property/${RERA_LISTING}"]`).first();
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card.locator('[aria-label*="ID verified owner"]')).toHaveCount(1);
  await expect(card).not.toContainText('Verified Draazy');

  const fixture = rows.find((p) => p.slug === MAP_LISTING);
  expect(fixture, `${MAP_LISTING} must be present in Baner map stock`).toBeTruthy();
  expect(fixture.lat).toBeTruthy();
  expect(fixture.lng).toBeTruthy();
  const label = markerLabel(fixture.price);
  expect(rows.filter((p) => markerLabel(p.price) === label).map((p) => p.slug)).toEqual([MAP_LISTING]);

  await page.goto('/listings?deal=buy&view=map&loc=baner', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/listings\?[^#]*view=map[^#]*loc=baner/);
  await page.locator('.price-marker', { hasText: label }).first().click();
  const drawer = page.locator('.dz-mdp');
  await expect(drawer).toBeVisible({ timeout: 20000 });
  await expect(drawer.locator('.dz-mdp-full')).toHaveAttribute('href', `/property/${MAP_LISTING}`);
  await expect(drawer).not.toContainText('Verified Draazy');
  await expect(drawer).not.toContainText(/great connectivity to Pune's IT hubs|schools and hospitals/i);
});
