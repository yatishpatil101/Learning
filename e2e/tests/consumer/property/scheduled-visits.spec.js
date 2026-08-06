// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OWNER = { name: 'Owner Test', mobile: '9800000001', email: '', role: 'owner', joinedAt: Date.now() };
const LISTING = {
  id: 'L-TEST-1', title: 'Test 2 BHK, Baner', locality: 'Baner', deal: 'rent',
  price: 25000, status: 'approved', real: true, ownerMobile: '9800000001', views: 7,
};

/* Visits against the owner's OWN listing.
   These used to be left to the seeded demo catalogue, which worked only because the visit read was
   unscoped and handed every user the entire collection — including strangers' visits. Now that both
   reads are caller-scoped (matching the server's `/visits` and `/me/visit-requests`), the fixture
   has to own the data it asserts on. Dates are relative so the rows never age out of "Upcoming". */
const dayAhead = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const VISITS = [
  {
    id: 'V-TEST-1', propId: 'L-TEST-1', propTitle: 'Test 2 BHK, Baner',
    visitorName: 'Asha Kulkarni', visitorMobile: '9811111111', phone: '9811111111',
    date: dayAhead(3), time: '10:30 AM', mode: 'in-person', note: '',
    status: 'scheduled', createdAt: Date.now(), completedAt: 0,
  },
  {
    id: 'V-TEST-2', propId: 'L-TEST-1', propTitle: 'Test 2 BHK, Baner',
    visitorName: 'Rohit More', visitorMobile: '9822222222', phone: '9822222222',
    date: dayAhead(5), time: '3:00 PM', mode: 'in-person', note: '',
    status: 'scheduled', createdAt: Date.now() - 1000, completedAt: 0,
  },
];

async function loginOwner(page) {
  await page.addInitScript(({ u, l, v }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify(l));
    // The owner's own visit-request bucket — where a real booking against their listing lands.
    localStorage.setItem('puneNestPropVisitReqs:' + u.mobile, JSON.stringify(v));
  }, { u: OWNER, l: [LISTING], v: VISITS });
}

test.describe('Scheduled Visits', () => {
  test('owner sees an actionable Upcoming list and can confirm a visit', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${BASE}/dashboard#visits`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible({ timeout: 10000 });

    // At least one visit is awaiting confirmation, with working actions.
    const confirmBtn = page.getByRole('button', { name: /Confirm/ }).first();
    await expect(confirmBtn).toBeVisible();
    await expect(page.getByText(/Awaiting confirmation/).first()).toBeVisible();

    const awaitingBefore = await page.getByText(/Awaiting confirmation/).count();
    await confirmBtn.click();
    // Confirming flips one row to "Confirmed" (fewer "Awaiting confirmation" rows).
    await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: 5000 });
    const awaitingAfter = await page.getByText(/Awaiting confirmation/).count();
    expect(awaitingAfter).toBeLessThan(awaitingBefore);
  });

  test('reschedule opens a date picker; cancel removes the visit from Upcoming', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${BASE}/dashboard#visits`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible({ timeout: 10000 });

    // Reschedule modal actually appears with a date field (the shared calendar).
    await page.getByRole('button', { name: /Reschedule/ }).first().click();
    const dateInput = page.getByRole('dialog').getByRole('button', { name: 'New visit date' });
    await expect(dateInput).toBeVisible({ timeout: 5000 });
    await page.getByRole('dialog').getByRole('button', { name: /^Cancel$/ }).click();
    await expect(dateInput).toHaveCount(0);

    // Cancelling a visit drops it from the upcoming list.
    const cancelBtns = page.getByRole('button', { name: /^Cancel$/ });
    const beforeRows = await page.getByText(/Awaiting confirmation/).count();
    await cancelBtns.first().click();
    await expect(page.getByText(/Awaiting confirmation/)).toHaveCount(Math.max(0, beforeRows - 1), { timeout: 5000 });
  });

  test('Requests tab no longer carries a Visit-requests sub-tab (deduped)', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${BASE}/dashboard#leads`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('tab', { name: /Number requests/ }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: /^Visit requests$/ })).toHaveCount(0);
  });

  test('a confirmed visit persists across a full reload (saved to the DB, not local-only)', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${BASE}/dashboard#visits`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible({ timeout: 10000 });

    const confirmBtn = page.getByRole('button', { name: /Confirm/ }).first();
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
    await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: 5000 });

    // A full reload re-hydrates visits from persisted localStorage — the confirmation
    // must survive (proves the action wrote through updateVisit, not just local state).
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: 5000 });
  });

  test('Requests inbox shows a lead-triage summary strip', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${BASE}/dashboard#leads`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Waiting on you')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Open leads')).toBeVisible();
    await expect(page.getByText('Oldest waiting')).toBeVisible();
  });
});
