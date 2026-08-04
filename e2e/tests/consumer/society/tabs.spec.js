import { test, expect } from '@playwright/test';

// Society Hub — tabbed detail view. The long society page is grouped into a sticky
// tab bar (Overview / Homes / Reviews & Q&A / Community / Location), mirroring the
// Property detail page, with the active tab synced to a ?tab= URL param. Empty tabs
// (no listings / generic society) are hidden. The action/trust sidebar persists across
// all tabs. Seed society: verified "Skyline Heights, Baner" (has 1 listing + coords).

const BASE = 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';

async function goto(page, path) {
  await page.goto(`${BASE}${path}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });
}

test('society hub renders a sticky tab bar and defaults to the Overview panel', async ({ page }) => {
  await goto(page, `/society/${SLUG}`);
  await expect(page.getByRole('tablist', { name: /Society sections/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');

  // Overview content shows; other panels' signature headings are not mounted.
  await expect(page.getByRole('heading', { name: 'About this society' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Community insights' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Location & connectivity/ })).toHaveCount(0);
});

test('clicking each tab swaps the panel and toggles aria-selected', async ({ page }) => {
  await goto(page, `/society/${SLUG}`);

  await page.getByRole('tab', { name: /Reviews & Q&A/ }).click();
  await expect(page.getByRole('tab', { name: /Reviews & Q&A/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('heading', { name: 'Resident ratings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ask residents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'About this society' })).toHaveCount(0);

  await page.getByRole('tab', { name: /Community/ }).click();
  await expect(page.getByRole('heading', { name: 'Events & notices' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Community insights' })).toBeVisible();

  await page.getByRole('tab', { name: /Location/ }).click();
  await expect(page.getByRole('heading', { name: /Location & connectivity/ })).toBeVisible();

  await page.getByRole('tab', { name: /Homes/ }).click();
  await expect(page.getByRole('heading', { name: 'Homes in this society' })).toBeVisible();
});

test('the Homes tab carries a listing-count badge for a society with homes', async ({ page }) => {
  await goto(page, `/society/${SLUG}`);
  // Skyline seeds at least one listing → the Homes tab shows a numeric count.
  await expect(page.getByRole('tab', { name: /Homes\s*\d+/ })).toBeVisible();
});

test('Homes and Location tabs are hidden for a generic society with no listings', async ({ page }) => {
  await goto(page, `/society/zzz-unknown-society-baner`);
  await expect(page.getByRole('tab', { name: /Overview/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Reviews & Q&A/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Community/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Homes/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Location/ })).toHaveCount(0);
});

test('deep link ?tab=location lands directly on the Location panel', async ({ page }) => {
  await goto(page, `/society/${SLUG}?tab=location`);
  await expect(page.getByRole('tab', { name: /Location/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /Location & connectivity/ })).toBeVisible();
});

test('an unknown ?tab= value falls back to Overview', async ({ page }) => {
  await goto(page, `/society/${SLUG}?tab=bogus`);
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'About this society' })).toBeVisible();
});

test('selecting a tab writes ?tab= to the URL and drops it back on Overview', async ({ page }) => {
  await goto(page, `/society/${SLUG}`);
  expect(new URL(page.url()).searchParams.get('tab')).toBeNull();

  await page.getByRole('tab', { name: /Community/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('community');

  await page.getByRole('tab', { name: /Overview/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBeNull();
});

test('the resident/verify sidebar persists across every tab', async ({ page }) => {
  await goto(page, `/society/${SLUG}`);
  const sidebar = page.getByRole('heading', { name: /Live here\?/ });
  for (const name of [/Overview/, /Homes/, /Reviews & Q&A/, /Community/, /Location/]) {
    await page.getByRole('tab', { name }).click();
    await expect(sidebar).toBeVisible();
  }
});
