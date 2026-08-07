import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Accessibility regression coverage for the hero locality search (bug #2).
   The suggestion list is a WAI-ARIA combobox+listbox: the input exposes
   role="combobox" with aria-controls/aria-autocomplete/aria-expanded, the
   popup is role="listbox" with role="option" children, and Arrow keys drive
   aria-activedescendant while Enter commits the highlighted option. */


test('locality search exposes the combobox contract', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('input[role="combobox"][aria-label="Search localities, societies or landmarks"]');
  await expect(input).toHaveAttribute('aria-autocomplete', 'list');
  await expect(input).toHaveAttribute('aria-controls', 'loc-listbox');
  await expect(input).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(input).toHaveAttribute('aria-expanded', 'false');

  await input.click();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const listbox = page.locator('#loc-listbox[role="listbox"]');
  await expect(listbox).toBeVisible();
  expect(await listbox.locator('[role="option"]').count()).toBeGreaterThan(0);
});

test('arrow keys move aria-activedescendant and Enter commits the option', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('/');
  const input = page.locator('input[role="combobox"]');
  await input.click();

  // Down highlights option 0; down again -> option 1; up wraps back to 0.
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'loc-opt-0');
  await expect(page.locator('#loc-opt-0')).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'loc-opt-1');
  await expect(page.locator('#loc-opt-0')).toHaveAttribute('aria-selected', 'false');
  await input.press('ArrowUp');
  await expect(input).toHaveAttribute('aria-activedescendant', 'loc-opt-0');

  // Enter adds the highlighted locality as a chip.
  const label = (await page.locator('#loc-opt-0').innerText()).trim().split('\n')[0].trim();
  await input.press('Enter');
  await expect(page.locator('.loc-chip', { hasText: label })).toBeVisible();

  // Escape closes the list without clearing the chip.
  await input.click();
  await input.press('Escape');
  await expect(input).toHaveAttribute('aria-expanded', 'false');

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('ArrowUp from an unhighlighted list wraps to the last option', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('input[role="combobox"]');
  await input.click();
  const count = await page.locator('#loc-listbox [role="option"]').count();
  await input.press('ArrowUp');
  await expect(input).toHaveAttribute('aria-activedescendant', `loc-opt-${count - 1}`);
});

test('typing filters options and keyboard selection carries into the search URL', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('input[role="combobox"]');
  await input.click();
  await input.fill('Kot');
  await page.waitForTimeout(250);
  await input.press('ArrowDown');
  await input.press('Enter');
  await page.locator('button:has-text("Search")').last().click();
  await page.waitForURL(/\/listings/);
  expect(page.url()).toMatch(/loc=/);
});
