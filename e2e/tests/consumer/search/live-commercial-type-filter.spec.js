import { test, expect } from '@playwright/test';

/* Commercial Type sub-filter on the Listings page (now a dropdown):
   - appears ONLY when the "Commercial" property type is selected
   - offers the same options as the "Post a property" flow
   - actually filters results to the chosen commercial subtype
   - renders a removable active-filter chip
   - is available on both the Buy and Rent tabs
   - seed data exists for every commercial subtype

   Property Type and Commercial Type are now themed MultiSelect dropdowns, so we
   drive them by opening the trigger + clicking a role=option, and assert the
   outcome through the presentation-agnostic active-filter chips. All dropdown
   interactions are scoped to the DESKTOP sidebar (the mobile drawer is mounted
   off-screen and appears first in the DOM). */

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
const trigger = (page, name) => filters(page).getByRole('button', { name, exact: true });

async function closeMenus(page) {
  await filters(page).getByRole('heading', { name: 'Filters' }).click();
}
async function openDropdown(page, name) {
  await trigger(page, name).click();
}
async function pick(page, name, optionName) {
  await openDropdown(page, name);
  await page.getByRole('option', { name: optionName, exact: true }).click();
  await closeMenus(page);
}

/* Assert the whole result set is this subtype, and non-empty.

   Not `count()` + a `nth(i)` loop: the results grid renders from a deferred value, so the
   pre-filter set is still on screen for a beat after the pick. That loop samples the stale
   list (`n` = the wider commercial count) and then reads it index by index while React
   swaps it underneath — a card that existed at count time is gone by the time `nth(1)` is
   read. Both assertions below auto-retry over the live set, so they can only agree once the
   filtered list has actually landed; there is no snapshot to go stale. */
async function expectOnly(page, label) {
  await expect(cards(page).filter({ hasNotText: label })).toHaveCount(0);
  await expect(cards(page)).not.toHaveCount(0);
}

test('Commercial Type sub-filter is hidden until Commercial is selected', async ({ page }) => {
  await page.goto(`${BASE}/listings`);
  await expect(trigger(page, 'Property type')).toBeVisible();
  await expect(trigger(page, 'Commercial type')).toHaveCount(0);
});

test('Selecting Commercial reveals the sub-filter with all post-property options', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=commercial`);
  await expect(trigger(page, 'Commercial type')).toBeVisible();
  await openDropdown(page, 'Commercial type');
  for (const [, label] of SUBTYPES) {
    await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
  }
  await closeMenus(page);
});

test('Deselecting Commercial hides the sub-filter again', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=commercial`);
  await expect(trigger(page, 'Commercial type')).toBeVisible();
  // Toggle "Commercial" off inside the Property Type dropdown.
  await pick(page, 'Property type', 'Commercial');
  await expect(trigger(page, 'Commercial type')).toHaveCount(0);
});

for (const [, label] of SUBTYPES) {
  test(`Commercial subtype "${label}" filters results (Buy) + shows a chip`, async ({ page }) => {
    await page.goto(`${BASE}/listings?type=commercial`);
    await pick(page, 'Commercial type', label);

    // Active-filter chip appears and is removable.
    await expect(page.getByRole('button', { name: new RegExp('Remove filter ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeVisible();

    // Results are limited to the chosen subtype (seed has one buy unit each);
    // every rendered card's title must be this subtype's label.
    await expectOnly(page, label);
  });
}

test('Commercial Type sub-filter also works on the Rent tab', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=commercial&deal=rent`);
  await expect(trigger(page, 'Commercial type')).toBeVisible();

  await pick(page, 'Commercial type', 'Warehouse / Godown');
  await expectOnly(page, 'Warehouse / Godown');
});

test('Removing the Commercial Type chip restores the full commercial list', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=commercial`);
  await cards(page).first().waitFor({ timeout: 10000 });
  const total = await cards(page).count();

  await pick(page, 'Commercial type', 'Office Space');
  const filtered = await cards(page).count();
  expect(filtered).toBeLessThanOrEqual(total);

  await page.getByRole('button', { name: /Remove filter Office Space/i }).click();
  await expect.poll(async () => cards(page).count()).toBe(total);
});
