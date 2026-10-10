import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

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
  const named = await api('PATCH', '/auth/me', headers, { name: 'Zztest Finance Owner' });
  expect(named.status, 'naming the finance owner').toBe(200);

  const created = await api('POST', '/me/listings', headers, {
    title: `Zztest finance listing ${Date.now()}`,
    deal: 'rent', propertyType: 'Flat', price: 28000, city: 'Pune', locality: 'Baner', bhk: 2, area: 900,
    images: await uploadedListingPhotos(headers),
  });
  expect(created.status, 'creating the finance listing').toBe(201);
  createdListingIds.add(created.body.id);
  const approved = await approveListingWithFetch(created.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status, 'approving the finance listing').toBe(200);
  return { mobile, headers, listing: created.body };
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListingIds) {
    const rejected = await rejectListingWithFetch(id, adminHeaders, {
      reason: 'Zztest cleanup - owner finance fixture',
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

test('saving or removing a transaction moves the figures on screen without re-reading the ledger', async ({ page }) => {
  const owner = await ownerWithListing();
  await signedInAs(page, owner.mobile);
  const calls = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith(`/api/me/finances/${owner.listing.id}/`)) calls.push(`${request.method()} ${path.split('/').slice(5).join('/')}`);
  });
  const summaryRead = page.waitForResponse((response) => response.url().includes('/summary') && response.status() === 200);
  await page.goto('/dashboard#finances');
  await summaryRead;
  await expect(page.getByText('No transactions yet').first()).toBeVisible();
  await page.waitForTimeout(1000);
  const loaded = calls.length;

  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Rent received' }).click();
  await dialog.locator('#tx-amount').fill('12000');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Transaction added')).toBeVisible();
  await expect(page.getByText('Rent received').first()).toBeVisible();
  await expect(page.getByText('₹12,000').filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(1000);
  expect(calls.slice(loaded)).toEqual(['POST transactions']);

  const stored = await api('GET', `/me/finances/${owner.listing.id}/summary?period=all`, owner.headers);
  expect(stored.body).toMatchObject({ income: 12000, expense: 0, net: 12000 });

  await page.getByRole('button', { name: 'Remove transaction' }).first().click();
  await expect(page.getByText('Transaction removed')).toBeVisible();
  await expect(page.getByText('No transactions yet').first()).toBeVisible();
  await page.waitForTimeout(1000);
  expect(calls.slice(loaded).map((c) => c.replace(/\/[0-9a-f-]{36}$/, ''))).toEqual(['POST transactions', 'DELETE transactions']);
  const emptied = await api('GET', `/me/finances/${owner.listing.id}/summary?period=all`, owner.headers);
  expect(emptied.body).toMatchObject({ income: 0, expense: 0, net: 0 });
});
