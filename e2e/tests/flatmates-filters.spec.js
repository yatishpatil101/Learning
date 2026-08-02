import { test, expect } from '@playwright/test';
import { pickDate } from '../helpers/datePicker.helper.js';

/* Tab-aware filter controls: a filter must only appear on the tab it actually
   narrows. "Move-in" applies to flatmates & rooms (posts carry a move-in date);
   "Sharing" (group size) applies only to groups. Previously both rendered on
   every tab, so selecting them on the wrong tab silently did nothing. */

const BASE = 'http://localhost:5173';

const visibleLabel = (page, text) => page.locator('label:visible', { hasText: text });

test('flatmates tab shows Move-in and hides the Sharing filter', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(0);
});

test('rooms tab shows Move-in and hides the Sharing filter', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(0);
});

test('groups tab shows the Sharing filter and hides Move-in', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(1);
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(0);
});

test('switching Groupsâ†’Flatmates swaps the tab-specific filters', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(1);

  await page.getByRole('button', { name: /Flatmates/i }).first().click();
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  // The groups-only Sharing control is gone; the flatmates Move-in control is back.
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(0);
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
});

/* Lifestyle is a cross-tab filter driven by the `tags` field â€” the real
   flatmate dealbreakers (non-smoker, veg, pet-friendly). It must be present on
   every tab and actually narrow the result set. */
test('Lifestyle filter appears on all tabs', async ({ page }) => {
  for (const view of ['flatmates', 'rooms', 'groups']) {
    await page.goto(`${BASE}/flatmates?view=${view}`);
    await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
    await expect(visibleLabel(page, 'Lifestyle')).toHaveCount(1);
  }
});

test('selecting a Lifestyle habit narrows the results', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  const before = await page.locator('.sf-card').count();

  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Non-smoker', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  const after = await page.locator('.sf-card').count();

  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});

/* Move-in is a two-value control: an "Immediate" chip and a "By date" calendar
   picker (no dropdown). "Immediate" shows only now-available posts; picking a
   date widens that to everything available on or before it. */
test('Move-in "Immediate" chip shows only immediately-available posts', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  const before = await page.locator('.sf-card').count();

  const immediate = page.getByRole('button', { name: 'Immediate', exact: true });
  await immediate.click();
  await expect(immediate).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  const after = await page.locator('.sf-card').count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);

  // Toggling it off restores the full set.
  await immediate.click();
  await expect(immediate).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);
  expect(await page.locator('.sf-card').count()).toBe(before);
});

test('Move-in "By date" widens results beyond Immediate', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await page.getByRole('button', { name: 'Immediate', exact: true }).click();
  await page.waitForTimeout(300);
  const immediateCount = await page.locator('.sf-card').count();

  // A date ~20 days out includes now + within-15-day posts, so the set grows.
  const d = new Date();
  d.setDate(d.getDate() + 20);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await pickDate(page, '[aria-label="Move-in by date"]:visible', iso);
  await page.waitForTimeout(300);

  const dateCount = await page.locator('.sf-card').count();
  expect(dateCount).toBeGreaterThan(immediateCount);
  // Selecting a date releases the Immediate chip (mutually exclusive).
  await expect(page.getByRole('button', { name: 'Immediate', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

