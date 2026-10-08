import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

/* Assert /signin for guests and the rendered heading (not just ?post=1) for signed-in users, so a fork
   that ignores auth cannot pass; the signed-in session is a real JWT. */

test('"Find a flatmate" routes to the flatmate finder', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Find a flatmate' }).click();
  // The view is the assertion, not just the route. "Find a flatmate" is the browse-people entry
  // point, and `move-in` — the other tab — is a different question with a different result set.
  await expect(page).toHaveURL(/\/flatmates\?view=team-up/);
});

test('"Post your requirement" (guest) routes to sign-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Post your requirement' }).click();
  await expect(page).toHaveURL(/\/signin/);
});

test('"Post your requirement" (signed-in) opens the post form directly', async ({ page }) => {
  /* Fresh account: no listings, badge or history, so a form that opens only for established users fails. */
  await signedInAsNew(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Post your requirement' }).click();
  await expect(page).toHaveURL(/\/flatmates\?post=1/);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 15_000 });
  // And specifically not the guest branch, which is the failure this whole test exists to catch:
  // a session the app cannot see routes here silently and looks like a routing bug, not an auth one.
  await expect(page).not.toHaveURL(/\/signin/);
});
