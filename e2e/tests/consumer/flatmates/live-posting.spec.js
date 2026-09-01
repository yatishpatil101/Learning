import { test, expect } from '@playwright/test';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

/* Supply side: getting a post into the right place.

   Posting used to present three sibling CTAs and ask the user to classify themselves against our
   storage model before seeing a form. One entry point now asks the only question they can always
   answer — "do you have a place?" — and routes from the answer, mirroring the two browse tabs.

   ## Why this is a live spec even though it never touches the API

   Every assertion here is about routing and modal state, so on the face of it the provider makes
   no difference and the mock twin was as good. It made one difference that mattered: the mock
   spec established its user by writing `localStorage.puneNestUser`, which is not a session. The
   two branches that depend on being signed in were therefore proving that the *fake* passed the
   guard, and the guest branch — the only one whose whole point is that the guard fires — was the
   only one being asked a real question. Under a real session the signed-in branches now traverse
   `ProtectedRoute` the way a visitor does.

   Accounts are minted per test rather than reused from the fixture registry. Nothing here reads
   another spec's rows, and posting is a state transition on the account, so a seeded actor would
   be the wrong subject twice over. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* The board's lazy chunk resolves well after `load`, and every test below starts by pressing
   something inside it. "Move in now" is a static control rather than a rendered row, so waiting on
   it survives an empty feed — which matters here, because none of these tests seed one. */
const openBoard = async (page, query = '') => {
  await page.goto(`${BASE}/flatmates${query}`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20000 });
};

/* "Just me" also appears as a share-intent control on room cards, so every chooser assertion is
   scoped to the modal rather than the whole page — unscoped, it resolves to several elements. */
const chooser = (page) => page.locator('.sf-modal');

const openChooser = async (page) => {
  await page.getByRole('button', { name: /^Post$/ }).first().click();
  await expect(page.getByText('What are you posting?')).toBeVisible();
};

test.describe('Flatmates posting (live)', () => {
  test('one Post CTA opens the chooser', async ({ page }) => {
    await openBoard(page);
    await openChooser(page);

    await expect(chooser(page).getByRole('button', { name: /I have a place/ })).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: /I'm still looking for a place/ })).toBeVisible();
  });

  test('"no place yet" asks who is looking, and can go back', async ({ page }) => {
    await openBoard(page);
    await openChooser(page);
    await chooser(page).getByRole('button', { name: /I'm still looking for a place/ }).click();

    await expect(page.getByText("Who's looking?")).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: /Just me/ })).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: /We're already a group/ })).toBeVisible();

    // The fork must be reversible — a wrong turn shouldn't cost the modal.
    await chooser(page).getByRole('button', { name: /^Back$/ }).click();
    await expect(page.getByText('What are you posting?')).toBeVisible();
  });

  test('a guest is sent to sign-in, and told where to come back to', async ({ page }) => {
    await openBoard(page);
    await openChooser(page);
    await chooser(page).getByRole('button', { name: /I'm still looking for a place/ }).click();
    await chooser(page).getByRole('button', { name: /Just me/ }).click();

    // Posting needs a mobile-verified sign-in; identity is a badge, not a gate. The `next=` half is
    // the part worth pinning: a redirect that drops it strands the poster on their account page
    // having forgotten what they came to do, which reads as a working sign-in.
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    await expect(page.getByRole('button', { name: /^Post$/ })).toHaveCount(0);
  });

  test('"I have a place" routes a signed-in user to the room flow', async ({ page }) => {
    await signedInAsNew(page);
    await openBoard(page);
    await openChooser(page);
    await chooser(page).getByRole('button', { name: /I have a place/ }).click();

    // A room is a property with a flatmate flag, so it goes through the listing wizard rather than
    // a second form that would have to learn the same fields.
    await expect(page).toHaveURL(/\/list-property\?flatmate=1/);
  });

  test('"just me" opens the request form for a signed-in user', async ({ page }) => {
    await signedInAsNew(page);
    await openBoard(page);
    await openChooser(page);
    await chooser(page).getByRole('button', { name: /I'm still looking for a place/ }).click();
    await chooser(page).getByRole('button', { name: /Just me/ }).click();

    await expect(page.getByText('Post your flatmate request')).toBeVisible();
    // Same press, opposite outcome to the guest test above: the fork is the session, not the copy.
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('the hero CTA uses the same chooser as the tab row', async ({ page }) => {
    await openBoard(page);
    // A person WITH a spare room needs an entry point without first discovering a tab, so the hero
    // must not be request-only.
    await page.locator('.glass').getByRole('button', { name: /^Post$/ }).first().click();
    await expect(page.getByText('What are you posting?')).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: /I have a place/ })).toBeVisible();
  });

  test('?post=1 deep link opens the request form directly', async ({ page }) => {
    await signedInAsNew(page);
    await openBoard(page, '?post=1');

    // Straight to the form: the deep link is what an alert email links to, so making the reader
    // walk the chooser again would be asking a question they already answered.
    await expect(page.getByText('Post your flatmate request')).toBeVisible();
    await expect(page.getByText('What are you posting?')).toHaveCount(0);
  });

  test('the ?post=1 deep link does not carry a guest past the sign-in guard', async ({ page }) => {
    // The pair above is what makes this worth asserting rather than assuming. The guard fires on a
    // chooser *press*, and this link skips the chooser — so a guard implemented at the button
    // would let the link through while every other test stayed green. That is also the route most
    // likely to be pasted into a group chat, i.e. reached by exactly the people who are not signed
    // in. Same URL as the test above, opposite session, opposite outcome.
    await openBoard(page, '?post=1');

    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByText('Post your flatmate request')).toHaveCount(0);
  });
});
