import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/* The in-page Buy/Rent deal toggle and the "Looking to share? Browse flatmates &
   rooms" ticker duplicate journeys that already live in the desktop navbar. That
   navbar collapses into a drawer below `lg`, so these two controls are the mobile
   stand-in for it — they must only render on mobile/tablet (`lg:hidden`) and stay
   hidden on the web/desktop view. */

const dealToggle = (page) => page.getByRole('radiogroup', { name: /Switch between renting and buying/i });
const shareTicker = (page) => page.getByRole('link', { name: /Browse flatmates & rooms/i });

test.describe('Listings — mobile-only deal toggle & share-flat ticker', () => {
  test('Desktop hides the deal toggle and the share-flat ticker', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/listings?deal=rent`);
    await expect(dealToggle(page)).toBeHidden();
    await expect(shareTicker(page)).toBeHidden();
  });

  test('Mobile keeps the deal toggle and the share-flat ticker', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/listings?deal=rent`);
    await expect(dealToggle(page)).toBeVisible();
    await expect(shareTicker(page)).toBeVisible();
  });
});
