import { test, expect } from '@playwright/test';
import { seedConsent, uniqueMobile } from '../../../helpers/liveAuth.js';
import { mintPickableSociety } from '../../../helpers/liveSociety.js';
import { pickGoogleSociety } from '../../../helpers/places.js';

/* A signed-out visitor can bind a society that already exists for the picked Google place;
   only minting a new one needs an account. */

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function watchMints(page) {
  const mints = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/societies') mints.push(r.postDataJSON());
  });
  return mints;
}

test.beforeEach(async ({ page }) => {
  await seedConsent(page);
});

test('a guest picking a place that is already a society lands on its hub without signing in', async ({ page }) => {
  const name = `Zz Guest Known ${uniq()}`;
  const slug = await mintPickableSociety(uniqueMobile(), name);
  const mints = watchMints(page);

  await page.goto('/societies');
  await pickGoogleSociety(page, name, { keepsValue: false });

  await expect(page).toHaveURL(new RegExp(`/society/${slug}$`));
  await expect(page.getByText('Already on Draazy — taking you there')).toBeVisible();
  expect(mints, 'finding an existing society must not mint another').toEqual([]);
});

test('a guest picking a place nobody has added is sent to sign in, and nothing is minted', async ({ page }) => {
  const mints = watchMints(page);

  await page.goto('/societies');
  await pickGoogleSociety(page, `Zz Guest New ${uniq()}`, { keepsValue: false });

  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByText('Sign in to join the community').first()).toBeVisible();
  expect(mints, 'a signed-out pick must not reach POST /societies').toEqual([]);
});
