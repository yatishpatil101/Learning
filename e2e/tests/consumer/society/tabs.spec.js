import { test, expect } from '@playwright/test';
import { ensureSocietyReviews } from '../../../helpers/liveSociety.js';

// Sticky tab bar (Overview / Homes / Reviews & Q&A / Location) synced to `?tab=`; empty tabs are hidden and Reviews appears from 3 reviews.
// Seed society: "Skyline Heights, Baner" (1 listing + coords).

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';

async function goto(page, path) {
  await page.goto(`${BASE}${path}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });
}

test('society hub renders a sticky tab bar, swaps panels per tab, shows the Homes count and keeps the sidebar on every tab', async ({ page, request }) => {
  await ensureSocietyReviews(request, SLUG, 3);
  await goto(page, `/society/${SLUG}`);

  await test.step('society hub renders a sticky tab bar and defaults to the Overview panel', async () => {
    await expect(page.getByRole('tablist', { name: /Society sections/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');

    // Overview content shows; other panels' signature headings are not mounted.
    await expect(page.getByRole('heading', { name: 'About this society' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Location & connectivity/ })).toHaveCount(0);
  });

  await test.step('the tab bar is exactly Overview, Homes, Reviews and Location — no Community', async () => {
    await expect(page.getByRole('tab')).toHaveText([/Overview/, /Homes\s*\d+/, /Reviews & Q&A/, /Location/]);
    await expect(page.getByRole('tab', { name: /Community/ })).toHaveCount(0);
  });

  await test.step('the Homes tab carries a listing-count badge for a society with homes', async () => {
    // Skyline seeds at least one listing → the Homes tab shows a numeric count.
    await expect(page.getByRole('tab', { name: /Homes\s*\d+/ })).toBeVisible();
  });

  await test.step('clicking each tab swaps the panel and toggles aria-selected', async () => {
    await page.getByRole('tab', { name: /Reviews & Q&A/ }).click();
    await expect(page.getByRole('tab', { name: /Reviews & Q&A/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('heading', { name: 'Ratings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About this society' })).toHaveCount(0);

    await page.getByRole('tab', { name: /Location/ }).click();
    await expect(page.getByRole('heading', { name: /Location & connectivity/ })).toBeVisible();

    await page.getByRole('tab', { name: /Homes/ }).click();
    await expect(page.getByRole('heading', { name: 'Homes in this society' })).toBeVisible();
  });

  await test.step('the follow sidebar persists across every tab', async () => {
    const sidebar = page.getByRole('heading', { name: /Stay updated/ });
    for (const name of [/Overview/, /Homes/, /Reviews & Q&A/, /Location/]) {
      await page.getByRole('tab', { name }).click();
      await expect(sidebar).toBeVisible();
    }
  });
});

test('Homes, Location and Reviews tabs are hidden for a generic society with no listings or reviews', async ({ page }) => {
  await goto(page, `/society/zzz-unknown-society-baner`);
  await expect(page.getByRole('tab', { name: /Overview/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Reviews & Q&A/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Community/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Homes/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Location/ })).toHaveCount(0);
});

test('the ?tab= param deep-links to a panel, falls back to Overview when unknown, and follows tab selection', async ({ page }) => {
  await test.step('deep link ?tab=location lands directly on the Location panel', async () => {
    await goto(page, `/society/${SLUG}?tab=location`);
    await expect(page.getByRole('tab', { name: /Location/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: /Location & connectivity/ })).toBeVisible();
  });

  await test.step('an unknown ?tab= value — including the removed community one — falls back to Overview', async () => {
    for (const bogus of ['bogus', 'community']) {
      await goto(page, `/society/${SLUG}?tab=${bogus}`);
      await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { name: 'About this society' })).toBeVisible();
    }
  });

  await test.step('selecting a tab writes ?tab= to the URL and drops it back on Overview', async () => {
    await goto(page, `/society/${SLUG}`);
    expect(new URL(page.url()).searchParams.get('tab')).toBeNull();

    await page.getByRole('tab', { name: /Location/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('location');

    await page.getByRole('tab', { name: /Overview/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBeNull();
  });
});
