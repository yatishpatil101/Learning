// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const OWNER = { name: 'Owner Test', mobile: '9800000001', email: '', role: 'owner', joinedAt: Date.now() };

async function loginAsOwner(page) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
  }, OWNER);
}

async function estimateAndSave(page) {
  await page.goto(`${BASE}/dashboard#owner-hub`);
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Estimate now/i }).click();
  await expect(page.getByText(/Estimated monthly rent/i)).toBeVisible();
  await page.getByRole('button', { name: /Save as my property/i }).click();
  await page.waitForURL(/\/owner-hub\/property\//, { timeout: 8000 });
}

test.describe('Owner Hub — the owner wedge', () => {
  test('redirects to sign in when logged out (AC1)', async ({ page }) => {
    await page.goto(`${BASE}/owner-hub`);
    await expect(page).toHaveURL(/\/signin/);
  });

  test('renders for a signed-in owner (AC1)', async ({ page }) => {
    await loginAsOwner(page);
    await page.goto(`${BASE}/dashboard#owner-hub`);
    await expect(page.getByRole('heading', { name: /Your property, working for you/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rent-o-meter' })).toBeVisible();
  });

  test('legacy /owner-hub redirects to the dashboard tab (AC1)', async ({ page }) => {
    await loginAsOwner(page);
    await page.goto(`${BASE}/owner-hub`);
    await expect(page).toHaveURL(/\/dashboard#owner-hub/);
    await expect(page.getByRole('heading', { name: /Your property, working for you/i })).toBeVisible();
  });

  test('Rent-o-meter shows a rent estimate and the sale side (AC2)', async ({ page }) => {
    await loginAsOwner(page);
    await page.goto(`${BASE}/dashboard#owner-hub`);
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Estimate now/i }).click();
    await expect(page.getByText(/Estimated monthly rent/i)).toBeVisible();
    await expect(page.getByText(/^Range/)).toBeVisible();
    await expect(page.getByText('The other side')).toBeVisible();
    // Guard the fade-in regression: the result renders inside a `.fade-in`
    // container that stays at opacity:0 until `.visible` is applied. isVisible()
    // ignores opacity, so assert the container is actually opaque (shown).
    const opacity = await page.locator('.fade-in').filter({ hasText: /Estimated monthly rent/i }).first()
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeGreaterThan(0.9);
  });

  test('Save as my property creates a private property, absent from public search (AC3)', async ({ page }) => {
    await loginAsOwner(page);
    await estimateAndSave(page);

    const managed = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestManagedProps:9800000001') || '[]'));
    expect(managed.length).toBe(1);
    expect(managed[0].visibility).toBe('private');
    expect(managed[0].status).toBe('managed');

    // Not leaked into the public catalog.
    const inPublic = await page.evaluate((id) => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
      return (db.listings || []).some((l) => l.id === id);
    }, managed[0].id);
    expect(inPublic).toBe(false);
  });

  test('Passport accepts a document and lifts completeness (AC4)', async ({ page }) => {
    await loginAsOwner(page);
    await estimateAndSave(page);

    await expect(page.getByText('Passport completeness')).toBeVisible();
    await page.setInputFiles('input[type="file"]', {
      name: 'sale-deed.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    });
    await expect(page.getByText('sale-deed.pdf')).toBeVisible();
    const docs = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestDocs:9800000001') || '{}'));
    const anyDocs = Object.values(docs).some((arr) => Array.isArray(arr) && arr.length > 0);
    expect(anyDocs).toBe(true);
  });

  test('Rent tracking: set rent then mark received (AC5)', async ({ page }) => {
    await loginAsOwner(page);
    await estimateAndSave(page);

    await page.getByPlaceholder('e.g. Rohit More').fill('Rohit More');
    await page.getByPlaceholder('e.g. 28000').fill('28000');
    await page.getByRole('button', { name: /Start tracking/i }).click();

    // Current month shows a due/overdue state with a Mark received action.
    await page.getByRole('button', { name: /^Mark received$/i }).first().click();
    await expect(page.getByText(/paid|Received this month/i).first()).toBeVisible();
  });

  test('Publish moves the property into the pending-review listing flow (AC6)', async ({ page }) => {
    await loginAsOwner(page);
    await estimateAndSave(page);

    await page.getByRole('button', { name: /Publish as listing/i }).click();
    await expect(page.getByText('Listed to buyers')).toBeVisible();

    const managed = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestManagedProps:9800000001') || '[]'));
    expect(managed[0].status).toBe('published');
    const listingId = managed[0].publishedListingId;
    expect(listingId).toBeTruthy();

    const listing = await page.evaluate((id) => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
      return (db.listings || []).find((l) => l.id === id) || null;
    }, listingId);
    expect(listing).toBeTruthy();
    expect(listing.status).toBe('pending');
    expect(listing.visibility).toBe('public');
  });
});

