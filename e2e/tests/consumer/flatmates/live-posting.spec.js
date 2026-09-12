import { test, expect } from '@playwright/test';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

// Real sessions exercise posting guards; each test mints its own actor because posting changes account state.

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// A static control proves the lazy board mounted even when no fixture supplies feed rows.
const openBoard = async (page, query = '') => {
  await page.goto(`${BASE}/flatmates${query}`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20000 });
};

// Scope chooser controls to the dialog because room cards repeat their labels.
const sheet = (page) => page.getByRole('dialog', { name: /What do you want to post/ });
const whoSheet = (page) => page.getByRole('dialog', { name: /Who's looking/ });

// This anchored button locator spans breakpoints without matching chooser copy or the desktop link.
const openSheet = async (page) => {
  await page.getByRole('button', { name: /^Post( Property)?$/ }).first().click();
  await expect(sheet(page)).toBeVisible();
};

test.describe('Flatmates posting (live)', () => {
  test('the page posting CTA opens the shared posting sheet', async ({ page }) => {
    await openBoard(page);
    await openSheet(page);

    await expect(sheet(page).getByRole('button', { name: /A property to rent out or sell/ })).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: /A room in my place/ })).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: /I'm looking for a place/ })).toBeVisible();
  });

  test('the bottom-bar + opens the same sheet from a route that is not /flatmates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/listings`);

    await page.getByRole('button', { name: /Post Property/i }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: /I'm looking for a place/ })).toBeVisible();
  });

  test('"looking for a place" asks who is looking, and can go back', async ({ page }) => {
    await openBoard(page);
    await openSheet(page);
    await sheet(page).getByRole('button', { name: /I'm looking for a place/ }).click();

    await expect(whoSheet(page).getByRole('button', { name: /Just me/ })).toBeVisible();
    await expect(whoSheet(page).getByRole('button', { name: /We're already a group/ })).toBeVisible();

    await whoSheet(page).getByRole('button', { name: /^Back$/ }).click();
    await expect(sheet(page)).toBeVisible();
  });

  test('closing the sheet mid-fork reopens it at the first question', async ({ page }) => {
    // Shared sheet state must reset on close so an abandoned branch does not reopen mid-flow.
    await openBoard(page);
    await openSheet(page);
    await sheet(page).getByRole('button', { name: /I'm looking for a place/ }).click();
    await whoSheet(page).getByRole('button', { name: /^Close/ }).click();

    await openSheet(page);
    await expect(sheet(page).getByRole('button', { name: /A property to rent out or sell/ })).toBeVisible();
  });

  test('a guest is sent to sign-in, and told where to come back to', async ({ page }) => {
    await openBoard(page);
    await openSheet(page);
    await sheet(page).getByRole('button', { name: /I'm looking for a place/ }).click();
    await whoSheet(page).getByRole('button', { name: /Just me/ }).click();

    // Preserve `next` so authentication returns the poster to the selected branch.
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=.*post%3Dsolo/);
  });

  test('"a room in my place" routes a signed-in user to the room flow', async ({ page }) => {
    await signedInAsNew(page);
    await openBoard(page);
    await openSheet(page);
    await sheet(page).getByRole('button', { name: /A room in my place/ }).click();

    await expect(page).toHaveURL(/\/list-property\?flatmate=1/);
  });

  test('"a property" routes a signed-in user to the plain listing wizard', async ({ page }) => {
    await signedInAsNew(page);
    await openBoard(page);
    await openSheet(page);
    await sheet(page).getByRole('button', { name: /A property to rent out or sell/ }).click();

    await expect(page).toHaveURL(/\/list-property$/);
  });

  test('"just me" opens the request form for a signed-in user, and clears the intent', async ({ page }) => {
    await signedInAsNew(page);
    await openBoard(page);
    await openSheet(page);
    await sheet(page).getByRole('button', { name: /I'm looking for a place/ }).click();
    await whoSheet(page).getByRole('button', { name: /Just me/ }).click();

    await expect(page.getByText('Post your flatmate request')).toBeVisible();
    await expect(page).not.toHaveURL(/\/signin/);
    // Remove this one-shot instruction so reloads and shared URLs do not reopen the form.
    await expect(page).not.toHaveURL(/post=/);
  });

  test('"already a group" opens the group builder for a signed-in user', async ({ page }) => {
    await signedInAsNew(page);
    await openBoard(page);
    await openSheet(page);
    await sheet(page).getByRole('button', { name: /I'm looking for a place/ }).click();
    await whoSheet(page).getByRole('button', { name: /We're already a group/ }).click();

    await expect(page.getByText('Create a flatmate group')).toBeVisible();
    await expect(page).not.toHaveURL(/post=/);
  });

  test('?post=1 deep link opens the request form directly', async ({ page }) => {
    await signedInAsNew(page);
    await openBoard(page, '?post=1');

    // Legacy `1` remains a direct, shareable seeker-form route.
    await expect(page.getByText('Post your flatmate request')).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
  });

  test('the ?post=1 deep link does not carry a guest past the sign-in guard', async ({ page }) => {
    // Skip `openBoard`: the guard can redirect before the lazy board mounts.
    await page.goto(`${BASE}/flatmates?post=1`);

    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByText('Post your flatmate request')).toHaveCount(0);

    // Assert `next` because this deep-link guard builds its redirect independently of the sheet.
    await expect(page).toHaveURL(/next=%2Fflatmates%3Fpost%3D1/);
  });
});
