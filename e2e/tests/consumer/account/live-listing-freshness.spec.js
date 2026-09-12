import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs } from '../../../helpers/liveAuth.js';

async function api(method, path, headers) {
  const response = await fetch(`${API}${path}`, { method, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('an owner reactivates a dormant listing through the dashboard and the API persists its freshness', async ({ page }) => {
  const headers = await authHeaders(ACTORS.owner);
  const before = await api('GET', '/me/listings?size=50', headers);
  expect(before.status, 'reading the owner inventory').toBe(200);
  const dormant = before.body.content.find((listing) => listing.freshness === 'dormant');
  expect(dormant, 'the seeded owner has a dormant listing that the reactivation gate alone excludes').toBeTruthy();

  await signedInAs(page, ACTORS.owner);
  const listingRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/me/listings'
    && response.request().method() === 'GET'
    && response.status() === 200,
  );
  await page.goto('/dashboard#listings');
  await listingRead;

  const confirmAll = page.getByRole('button', { name: /Confirm all available/i });
  await expect(confirmAll).toBeVisible();

  const confirmed = page.waitForResponse((response) =>
    /^\/api\/me\/listings\/[^/]+\/confirm-available$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST',
  );
  await confirmAll.click();
  expect((await confirmed).status(), 'reactivating is accepted by the owner-scoped endpoint').toBe(200);

  const after = await api('GET', `/me/listings/${dormant.id}`, headers);
  expect(after.status, 're-reading the owner listing after reactivation').toBe(200);
  expect(after.body.freshness).toBe('active');
  expect(after.body.lastConfirmedAt, 'the server records the confirmation instant').toBeTruthy();

  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirm all available/i })).toHaveCount(0);
});
