import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

/* Home "Flatmates" tile has two CTAs that must route to the right place:
   - "Find a flatmate"       -> the Team up view (browse PEOPLE, no address yet).
   - "Post your requirement" -> the post-your-requirement form. Guests are routed
     to sign-in first; signed-in users get the post form opened directly.

   The tab vocabulary is `move-in` / `team-up`, not the older `rooms` / `flatmates`
   (tech-debt D83). `flatmates/model.js` documents the rename: the page splits on
   "is there an address yet?", which is a question a seeker can always answer, rather
   than on the supply record type. `?view=flatmates` still resolves — `TAB_ALIAS`
   keeps the legacy values working for old deep links — but the CTA names the
   current one, and this spec asserts the current one.

   ## Why the live port matters for the third test

   The guest branch is client-side routing and proved the same thing under either backend. The
   signed-in branch did not: the mock version wrote `draazyUser` into localStorage, which is a key
   the live app never reads. Against the real API that user does not exist — `AuthContext` stays
   loading, `/auth/me` answers 401, and "Post your requirement" would take the *guest* path to
   `/signin` while the spec claimed to be asserting the signed-in one. So the mock test could only
   ever have proved the fork reads *some* client state, not that it reads the session. Here the
   session is a real JWT, so the fork is being asked the question it is actually for.

   It also pins the fork's *shape*. Two CTAs that both land on `/flatmates` would satisfy a reader
   that skipped the auth check entirely, which is why the guest test asserts `/signin` rather than
   merely "not the post form", and why the signed-in one asserts the rendered heading as well as the
   query string: `?post=1` in the URL is set by the click, but the form opening is set by the page. */

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
  /* A freshly registered account rather than a seeded actor: this asserts what an *account* sees,
     not what a particular person's data looks like, so the weakest possible session is the honest
     fixture. It is also the adversarial one — a new registration holds no listings, no badge and no
     flatmate history, so a form that opened only for an established user would fail here. */
  await signedInAsNew(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Post your requirement' }).click();
  await expect(page).toHaveURL(/\/flatmates\?post=1/);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 15_000 });
  // And specifically not the guest branch, which is the failure this whole test exists to catch:
  // a session the app cannot see routes here silently and looks like a routing bug, not an auth one.
  await expect(page).not.toHaveURL(/\/signin/);
});
