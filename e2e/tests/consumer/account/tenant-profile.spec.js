import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

async function newTenant(page, request, name) {
  const mobile = await signedInAsNew(page);
  const headers = await authHeaders(mobile);
  const named = await request.patch(`${API}/auth/me`, { headers, data: { name } });
  expect(named.status()).toBe(200);
  return { mobile, headers };
}

async function openProfile(page) {
  const loaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/me/tenant-profile' && response.request().method() === 'GET',
  );
  await page.goto('/tenant-profile');
  expect((await loaded).status(), 'loading the tenant profile').toBe(200);
  await expect(page.locator('#tp-name')).toBeVisible();
}

test.describe('Tenant profile — live API', () => {
  test('saves a tenant profile on the server and rehydrates it after reload', async ({ page, request }) => {
    await newTenant(page, request, 'Live Tenant Profile');
    await openProfile(page);

    await page.locator('#tp-occ').fill('Engineer');
    await page.locator('#tp-income').fill('90000');
    await page.locator('#tp-landlord').fill('Former landlord');
    await page.locator('#tp-about').fill('Reliable tenant with a predictable work schedule.');

    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/me/tenant-profile'
      && response.request().method() === 'PUT'
      && response.status() === 200,
    );
    await page.getByRole('button', { name: /Save profile/i }).click();
    const body = await (await saved).json();
    expect(body).toMatchObject({ name: 'Live Tenant Profile', occupation: 'Engineer', income: 90000 });

    await expect(page.getByRole('button', { name: /Browse rentals/i })).toBeVisible();
    await expect(page.getByText('₹90,000/mo')).toBeVisible();

    await page.reload();
    await expect(page.locator('#tp-occ')).toHaveValue('Engineer');
    await expect(page.locator('#tp-income')).toHaveValue('90,000');
    await expect(page.locator('#tp-about')).toHaveValue('Reliable tenant with a predictable work schedule.');
  });

  test('blocks an empty name before issuing a destructive profile replacement', async ({ page, request }) => {
    const tenant = await newTenant(page, request, 'Live Empty Name');
    const seeded = await request.put(`${API}/me/tenant-profile`, {
      headers: tenant.headers,
      data: { name: 'Persisted Tenant', occupation: 'Engineer' },
    });
    expect(seeded.status()).toBe(200);
    await openProfile(page);

    let saves = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/me/tenant-profile' && request.method() === 'PUT') saves += 1;
    });
    await page.locator('#tp-name').fill('');
    await page.getByRole('button', { name: /Save profile/i }).click();

    await expect(page.getByText(/please enter your name/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Browse rentals/i })).toHaveCount(0);
    expect(saves, 'empty-name validation must not replace the profile').toBe(0);

    const stored = await request.get(`${API}/me/tenant-profile`, { headers: tenant.headers });
    expect(stored.status()).toBe(200);
    expect(await stored.json()).toMatchObject({ name: 'Persisted Tenant', occupation: 'Engineer' });
  });

  test('shows the published score checklist as fields are completed', async ({ page, request }) => {
    await newTenant(page, request, 'Live Checklist');
    await openProfile(page);

    await expect(page.getByText('Boost your score')).toBeVisible();
    await expect(page.getByText('+20%')).toBeVisible();
    await page.locator('#tp-occ').fill('Engineer');
    await expect(page.getByText('+20%')).toHaveCount(0);
  });
});
