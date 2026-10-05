import { test, expect } from '@playwright/test';
import { signedInAs, apiLogin, grantIdentityBadge, uniqueMobile } from '../../../helpers/liveAuth.js';
import { postAsSolo, postAsGroup, postHavingPlace } from '../../../helpers/app.js';
// Opening each form proves the badge is optional; server-backed accounts make “unverified” meaningful.
const BASE = process.env.BASE_URL || 'http://localhost:5173';

let unverified;

test.beforeAll(async () => {
  unverified = uniqueMobile();
  await apiLogin(unverified); // `POST /auth/login` auto-registers an unknown mobile.
});
// A static control proves the lazy board mounted even when its feed is empty.
const openBoard = async (page) => {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20000 });
};

const verifiedOnServer = async (mobile) => (await apiLogin(mobile)).user.verified;

test.describe('Flatmates supply is badge-not-gate (live)', () => {
  test('an account the server calls unverified is never stopped in front of any posting form', async ({ page }) => {
    test.slow();
    // Strict `false` rejects an omitted field; the badge test verifies this server read can become true.
    expect(await verifiedOnServer(unverified)).toBe(false);
    await signedInAs(page, unverified);

    await test.step('an account the server calls unverified still opens the group form', async () => {
      await openBoard(page);
      await postAsGroup(page);

      await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible();
    });

    await test.step('the same unverified account is routed into the room flow, not stopped in front of it', async () => {
      await openBoard(page);
      await postHavingPlace(page);

      await expect(page).toHaveURL(/\/list-property\?flatmate=1/);
    });

    await test.step('the badge is offered, not demanded - the seeker form opens without it', async () => {
      await openBoard(page);
      await postAsSolo(page);

      await expect(page.getByText('Post your flatmate request')).toBeVisible();

      await expect(page.getByRole('button', { name: /Verify identity/i }).first()).toBeVisible();
    });
  });
  test('earning the badge changes nothing about access - which is what makes it a badge', async ({ page }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    expect(await verifiedOnServer(mobile)).toBe(false);

    await grantIdentityBadge(mobile);
    expect(await verifiedOnServer(mobile)).toBe(true);
    // The paired route confirms both badge states retain the same access.
    await signedInAs(page, mobile);
    await openBoard(page);
    await postAsGroup(page);
    await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible();
  });
});
