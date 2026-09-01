import { test, expect } from '@playwright/test';

/* Home "Flatmates" tile has two CTAs that must route to the right place:
   - "Find a flatmate"      -> the Team up view (browse PEOPLE, no address yet).
   - "Post your requirement" -> the post-your-requirement form. Guests are routed
     to sign-in first; signed-in users get the post form opened directly.

   The tab vocabulary is `move-in` / `team-up`, not the older `rooms` / `flatmates`
   (tech-debt D83). `flatmates/model.js` documents the rename: the page splits on
   "is there an address yet?", which is a question a seeker can always answer, rather
   than on the supply record type. `?view=flatmates` still resolves — `TAB_ALIAS`
   keeps the legacy values working for old deep links — but the CTA names the
   current one, and this spec asserts the current one. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
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
  await expect(page).toHaveURL(/\/flatmates\?view=team-up/);
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
  await expect(page).toHaveURL(/\/flatmates\?post=1/);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });
});
