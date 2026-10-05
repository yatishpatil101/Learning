import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const SUBTYPES = [
  ['office', 'Office Space'],
  ['shop', 'Shop / Showroom'],
  ['retail', 'Retail / Mall Unit'],
  ['warehouse', 'Warehouse / Godown'],
  ['industrial', 'Industrial / Factory'],
  ['coworking', 'Co-working Space'],
];

const cards = (page) => page.locator('a[href^="/property/"]');
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const group = (page) => filters(page).locator('.fg-header').filter({ hasText: 'Commercial type' });
const subtypeLabel = (page, key) => filters(page).locator(`label[for$="ctype-${key}"]`);
const pick = (page, key) => subtypeLabel(page, key).click();

async function expectOnly(page, label) {
  await expect(cards(page).filter({ hasNotText: label })).toHaveCount(0);
  await expect(cards(page)).not.toHaveCount(0);
}

test('Commercial Type sub-filter shows only for Commercial, lists each subtype and hides on deselect', async ({ page }) => {
  await page.goto(`${BASE}/listings`);
  await expect(filters(page).locator('input[id$="type-commercial"]')).not.toBeChecked();
  await expect(group(page)).toHaveCount(0);

  await page.goto(`${BASE}/listings?type=commercial`);
  await expect(group(page)).toBeVisible();
  for (const [key, label] of SUBTYPES) {
    await expect(subtypeLabel(page, key)).toHaveText(label);
  }

  await filters(page).locator('label[for$="type-commercial"]').click();
  await expect(group(page)).toHaveCount(0);
});

for (const [key, label] of SUBTYPES) {
  test(`Commercial subtype "${label}" filters results (Buy) + shows a chip`, async ({ page }) => {
    await page.goto(`${BASE}/listings?type=commercial`);
    await pick(page, key);

    await expect(page.getByRole('button', { name: new RegExp('Remove filter ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeVisible();

    await expectOnly(page, label);
  });
}

test('Commercial subtypes are multi-select', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=commercial`);
  await pick(page, 'office');
  await pick(page, 'shop');
  await expect(page.getByRole('button', { name: /Remove filter Office Space/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove filter Shop \/ Showroom/i })).toBeVisible();

  await pick(page, 'office');
  await expect(page.getByRole('button', { name: /Remove filter Office Space/i })).toHaveCount(0);
  await expect(filters(page).locator('input[id$="ctype-shop"]')).toBeChecked();
});

test('Commercial Type sub-filter also works on the Rent tab', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=commercial&deal=rent`);
  await expect(group(page)).toBeVisible();

  await pick(page, 'warehouse');
  await expectOnly(page, 'Warehouse / Godown');
});

test('Removing the Commercial Type chip restores the full commercial list', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=commercial`);
  await cards(page).first().waitFor({ timeout: 10000 });
  const total = await cards(page).count();

  await pick(page, 'office');
  await expectOnly(page, 'Office Space');
  const filtered = await cards(page).count();
  expect(filtered).toBeLessThan(total);

  await page.getByRole('button', { name: /Remove filter Office Space/i }).click();
  await expect.poll(async () => cards(page).count()).toBe(total);
});
