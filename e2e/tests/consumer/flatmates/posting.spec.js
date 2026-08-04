import { test, expect } from '@playwright/test';
import { openFlatmates, seed, SEEKER } from '../../../helpers/app.js';

/* Supply side: getting a post into the right place.

   Posting used to present three sibling CTAs and ask the user to classify
   themselves against our storage model before seeing a form. One entry point now
   asks the only question they can always answer — "do you have a place?" — and
   routes from the answer, mirroring the two browse tabs. */

test.describe('Flatmates posting', () => {
  // "Just me" also appears as a share-intent control on room cards, so every
  // chooser assertion is scoped to the modal rather than the whole page.
  const chooser = (page) => page.locator('.sf-modal');

  test('one Post CTA opens the chooser', async ({ page }) => {
    await openFlatmates(page);
    await page.getByRole('button', { name: /^Post$/ }).first().click();

    await expect(page.getByText('What are you posting?')).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: /I have a place/ })).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: /I'm still looking for a place/ })).toBeVisible();
  });

  test('"no place yet" asks who is looking, and can go back', async ({ page }) => {
    await openFlatmates(page);
    await page.getByRole('button', { name: /^Post$/ }).first().click();
    await chooser(page).getByRole('button', { name: /I'm still looking for a place/ }).click();

    await expect(page.getByText("Who's looking?")).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: /Just me/ })).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: /We're already a group/ })).toBeVisible();

    // The fork must be reversible — a wrong turn shouldn't cost the modal.
    await chooser(page).getByRole('button', { name: /^Back$/ }).click();
    await expect(page.getByText('What are you posting?')).toBeVisible();
  });

  test('a guest is sent to sign-in rather than a form', async ({ page }) => {
    await openFlatmates(page);
    await page.getByRole('button', { name: /^Post$/ }).first().click();
    await chooser(page).getByRole('button', { name: /I'm still looking for a place/ }).click();
    await chooser(page).getByRole('button', { name: /Just me/ }).click();

    // Posting needs an L1 mobile-verified sign-in; identity is a badge, not a gate.
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
  });

  test('"I have a place" routes a signed-in user to the room flow', async ({ page }) => {
    await seed(page, { user: SEEKER });
    await openFlatmates(page);
    await page.getByRole('button', { name: /^Post$/ }).first().click();
    await chooser(page).getByRole('button', { name: /I have a place/ }).click();

    await expect(page).toHaveURL(/\/list-property\?flatmate=1/);
  });

  test('"just me" opens the request form for a signed-in user', async ({ page }) => {
    await seed(page, { user: SEEKER });
    await openFlatmates(page);
    await page.getByRole('button', { name: /^Post$/ }).first().click();
    await chooser(page).getByRole('button', { name: /I'm still looking for a place/ }).click();
    await chooser(page).getByRole('button', { name: /Just me/ }).click();

    await expect(page.getByText('Post your flatmate request')).toBeVisible();
  });

  test('the hero CTA uses the same chooser as the tab row', async ({ page }) => {
    await openFlatmates(page);
    // A person WITH a spare room needs an entry point without first discovering
    // a tab, so the hero must not be request-only.
    await page.locator('.glass').getByRole('button', { name: /^Post$/ }).first().click();
    await expect(page.getByText('What are you posting?')).toBeVisible();
  });

  test('?post=1 deep link opens the request form directly', async ({ page }) => {
    await seed(page, { user: SEEKER });
    await openFlatmates(page, '?post=1');
    await expect(page.getByText('Post your flatmate request')).toBeVisible();
  });
});
