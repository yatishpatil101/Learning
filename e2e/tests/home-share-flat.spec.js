import { test, expect } from '@playwright/test';

/* Home "Share a Flat" tile has two CTAs that must route to the right place:
   - "Find a flatmate"      -> the Share-a-Flat finder (flatmates browse view).
   - "Post your requirement" -> the post-your-requirement form. Guests are routed
     to sign-in first; signed-in users get the post form opened directly. */

const BASE = 'http://localhost:5173';
const MOBILE = '9811122233';

async function seedUser(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Share Tester', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

test('"Find a flatmate" routes to the flatmate finder', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Find a flatmate' }).click();
  await expect(page).toHaveURL(/\/share-flat\?view=flatmates/);
});

test('"Post your requirement" (guest) routes to sign-in', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Post your requirement' }).click();
  await expect(page).toHaveURL(/\/signin/);
});

test('"Post your requirement" (signed-in) opens the post form directly', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Post your requirement' }).click();
  await expect(page).toHaveURL(/\/share-flat\?post=1/);
  await expect(page.getByRole('heading', { name: /Post your flat-share request/i })).toBeVisible({ timeout: 10000 });
});
