import { test, expect } from '@playwright/test';
import { pickDate } from '../../../helpers/datePicker.helper.js';

// Filters appear only on the intent tab they can narrow; aliases are covered by discovery tests.

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const visibleLabel = (page, text) => page.locator('label:visible', { hasText: text });
const MOVE_IN_TAB = /Move in now/i;
const TEAM_UP_TAB = /Team up/i;

// Open the collapsed grid because its controls are absent until it expands.
const openFilters = async (page) => {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
};

const openTab = async (page, name) => {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name }).first().click();
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await openFilters(page);
};

test('Move in now shows Move-in and hides the people-only Sharing filter', async ({ page }) => {
  await openTab(page, MOVE_IN_TAB);
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(0);
});

test('Team up shows Sharing alongside Move-in', async ({ page }) => {
  await openTab(page, TEAM_UP_TAB);
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(1);
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
});

test('switching Team up to Move in now drops the people-only Sharing filter', async ({ page }) => {
  await openTab(page, TEAM_UP_TAB);
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(1);

  await page.getByRole('button', { name: MOVE_IN_TAB }).first().click();
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(0);
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
});

test('Lifestyle filter appears on both tabs', async ({ page }) => {
  for (const tab of [MOVE_IN_TAB, TEAM_UP_TAB]) {
    await openTab(page, tab);
    await expect(visibleLabel(page, 'Lifestyle')).toHaveCount(1);
  }
});

test('selecting a Lifestyle habit narrows the results', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await openFilters(page);
  const before = await page.locator('.sf-card').count();

  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Non-smoker', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The response rebuilds cards after `aria-pressed`; the retry makes the following count settled.
  await expect(page.locator('.sf-card')).not.toHaveCount(before);
  const after = await page.locator('.sf-card').count();

  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});

test('Move-in "Immediate" chip shows only immediately-available posts', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await openFilters(page);
  const before = await page.locator('.sf-card').count();

  const immediate = page.getByRole('button', { name: 'Immediate', exact: true });
  await immediate.click();
  await expect(immediate).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sf-card')).not.toHaveCount(before);
  const after = await page.locator('.sf-card').count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);

  await immediate.click();
  await expect(immediate).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sf-card')).toHaveCount(before);
});

test('Move-in "By date" widens results beyond Immediate', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await openFilters(page);
  const before = await page.locator('.sf-card').count();

  await page.getByRole('button', { name: 'Immediate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Immediate', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Wait for server-backed cards rather than reading the stale list after the chip changes.
  await expect(page.locator('.sf-card')).not.toHaveCount(before);
  const immediateCount = await page.locator('.sf-card').count();
  // Both bounds reject filters that match every row or no populated date.
  expect(immediateCount).toBeGreaterThan(0);
  expect(immediateCount).toBeLessThan(before);

  const d = new Date();
  d.setDate(d.getDate() + 20);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await pickDate(page, '[aria-label="Move-in by date"]:visible', iso);
  await expect(page.getByRole('button', { name: 'Immediate', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sf-card')).not.toHaveCount(immediateCount);

  const dateCount = await page.locator('.sf-card').count();
  expect(dateCount).toBeGreaterThan(immediateCount);
});

test('the desktop filter panel starts collapsed so inventory clears the fold', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await expect(page.getByRole('button', { name: /^Filters/ })).toHaveAttribute('aria-expanded', 'false');

  // Compare with the viewport so translated copy cannot hide the first result below the fold.
  const card = await page.locator('.sf-card').first().boundingBox();
  expect(card.y, `first result card must peek above the fold (y=${Math.round(card.y)}, viewport=820)`).toBeLessThan(820);
});

test('a narrowing deep link opens the panel, so the filter is never hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.goto(`${BASE}/flatmates?loc=Baner`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  const toggle = page.getByRole('button', { name: /^Filters/ });
  await expect(toggle, 'a pre-applied filter must reveal itself').toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toContainText('1');
  await expect(visibleLabel(page, 'Locality')).toHaveCount(1);
});

