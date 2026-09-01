import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

const createdListingIds = new Set();
let actorSequence = 0;

async function api(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function ownerWithListing() {
  const base = uniqueMobile();
  const mobile = `${base.slice(0, -1)}${actorSequence++ % 10}`;
  const headers = await authHeaders(mobile);
  const named = await api('PATCH', '/auth/me', headers, { name: `Zztest Finance Owner ${Date.now()}` });
  expect(named.status, 'naming the finance owner').toBe(200);

  const created = await api('POST', '/me/listings', headers, {
    title: `Zztest finance listing ${Date.now()}`,
    deal: 'rent', propertyType: 'Flat', price: 28000, city: 'Pune', locality: 'Baner', bhk: 2, area: 900,
  });
  expect(created.status, 'creating the finance listing').toBe(201);
  createdListingIds.add(created.body.id);
  const approved = await api('PATCH', `/properties/${created.body.id}/status`, await authHeaders(ACTORS.admin), { status: 'approved' });
  expect(approved.status, 'approving the finance listing').toBe(200);
  return { mobile, headers, listing: created.body };
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListingIds) {
    const rejected = await api('PATCH', `/properties/${id}/status`, adminHeaders, {
      status: 'rejected', reason: 'Zztest cleanup - owner finance fixture',
    });
    expect(rejected.status, `cleaning up finance listing ${id}`).toBe(200);
  }
  createdListingIds.clear();
});

test('owner finance transaction drives the API summary and the dashboard expense breakdown', async ({ page }) => {
  const owner = await ownerWithListing();
  const income = await api('POST', `/me/finances/${owner.listing.id}/transactions`, owner.headers, {
    type: 'income', category: 'Rent received', amount: 28000, date: '2026-08-01', recurring: 'none', note: 'August rent',
  });
  expect(income.status, 'creating the server-owned income row').toBe(201);
  const expense = await api('POST', `/me/finances/${owner.listing.id}/transactions`, owner.headers, {
    type: 'expense', category: 'Repairs', amount: 4000, date: '2026-08-02', recurring: 'none', note: 'Plumbing repair',
  });
  expect(expense.status, 'creating the server-owned expense row').toBe(201);

  const summary = await api('GET', `/me/finances/${owner.listing.id}/summary?period=all`, owner.headers);
  expect(summary.status, 'reading the server finance summary').toBe(200);
  expect(summary.body).toMatchObject({ income: 28000, expense: 4000, net: 24000 });

  await signedInAs(page, owner.mobile);
  const transactionsRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/me/finances/${owner.listing.id}/transactions`
    && response.request().method() === 'GET' && response.status() === 200,
  );
  await page.goto('/dashboard#finances');
  await transactionsRead;

  await expect(page.getByText('Rent received — August rent')).toBeVisible();
  await expect(page.getByText('Repairs — Plumbing repair')).toBeVisible();
  await page.getByRole('tab', { name: /Insights/i }).click();
  await expect(page.getByText('Expense breakdown', { exact: true })).toBeVisible();
  await expect(page.locator('canvas').last()).toBeVisible();
});
