// @ts-check
import { test, expect } from '@playwright/test';
import { pickDate } from '../../../helpers/datePicker.helper.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
/* `id` is the account id the visit store keys its buckets on (src/lib/store/visits.js, D30). A
   session seeded straight into localStorage carries whatever id the fixture gives it, so stating
   one here is what lets the bucket below be named deterministically. */
const OWNER = { id: 'U-TEST-OWNER', name: 'Owner Test', mobile: '9800000001', email: '', role: 'owner', joinedAt: Date.now() };
const LISTING = {
  id: 'L-TEST-1', title: 'Test 2 BHK, Baner', locality: 'Baner', deal: 'rent',
  price: 25000, status: 'approved', real: true, ownerId: 'U-TEST-OWNER', ownerMobile: '9800000001', views: 7,
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
    localStorage.setItem('puneNestPropVisitReqs:' + u.id, JSON.stringify(v));
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

  test('completing a reschedule moves the visit to the new slot and resets it to scheduled (D87)', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${BASE}/dashboard#visits`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible({ timeout: 10000 });

    // Confirm the first visit so the reschedule has a status to reset: a moved slot returns to
    // "scheduled" (Awaiting confirmation) because the other party has not agreed to the new time.
    await page.getByRole('button', { name: /Confirm/ }).first().click();
    await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /Reschedule/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'New visit date' })).toBeVisible({ timeout: 5000 });

    // A fresh date 9 days out — clear of the seeded 3/5-day rows and never "Today"/"Tomorrow",
    // so the row renders the absolute date we can assert on.
    const target = new Date();
    target.setDate(target.getDate() + 9);
    const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    await pickDate(page, '[aria-label="New visit date"]', iso);
    await dialog.getByRole('button', { name: 'Save new slot' }).click();
    await expect(page.getByText('Visit rescheduled')).toBeVisible({ timeout: 5000 });

    // Both of the seam's effects land through rescheduleVisit: the row shows the moved date, and it
    // is back to "Awaiting confirmation" (no row is Confirmed any longer). The row renders
    // `weekday, month day` (e.g. "Tue, Aug 18"); match either word order so the assertion holds
    // regardless of the runner's default locale.
    const mon = target.toLocaleDateString('en-US', { month: 'short' });
    const day = target.getDate();
    const dateRe = new RegExp(`${mon} ${day}\\b|\\b${day} ${mon}`);
    await expect(page.getByText(dateRe).first()).toBeVisible({ timeout: 5000 });
    // Confirming took one row out of "Awaiting confirmation" (2 → 1); the reschedule reset it, so
    // both rows are awaiting again — proof the seam moved the status back to scheduled.
    expect(await page.getByText(/Awaiting confirmation/).count()).toBe(2);
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

  /* D5 (global number-privacy policy): a buyer never receives the owner's phone number — approval
     unlocks in-app messaging, not the digits. A buyer viewing a visit they booked must therefore
     see NO WhatsApp handoff on the visit card (the buyer→owner channel is in-app chat). Regression
     guard: the mock's buyer-side read carries the owner's raw mobile on the row, so the protection
     lives entirely in VisitsTab suppressing the handoff for a non-owner viewer. */
  test('a buyer viewing their booked visit gets no WhatsApp handoff to the owner (D5)', async ({ page }) => {
    const BUYER = { id: 'U-TEST-BUYER', name: 'Buyer Test', mobile: '9833333333', email: '', role: 'seeker', joinedAt: Date.now() };
    // A visit the buyer booked. Stored in the buyer's own request bucket keyed by their account id —
    // where the mock's `listVisits` finds "visits I booked" without needing the owner catalogue.
    const booked = [{
      id: 'V-BUYER-1', propId: 'L-TEST-1', propTitle: 'Test 2 BHK, Baner',
      visitorName: 'Buyer Test', visitorMobile: BUYER.mobile, phone: BUYER.mobile,
      date: dayAhead(3), time: '10:30 AM', mode: 'in-person', note: '',
      status: 'scheduled', createdAt: Date.now(), completedAt: 0,
    }];
    await page.addInitScript(({ u, v }) => {
      localStorage.setItem('puneNestUser', JSON.stringify(u));
      localStorage.setItem('puneNestUsers', JSON.stringify([u]));
      localStorage.setItem('puneNestPropVisitReqs:' + u.id, JSON.stringify(v));
    }, { u: BUYER, v: booked });

    await page.goto(`${BASE}/dashboard#visits`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /upcoming visits/i }).first()).toBeVisible({ timeout: 10000 });

    // The booked visit is on the buyer's Upcoming list (assertion is non-vacuous)…
    await expect(page.getByText('Test 2 BHK, Baner').first()).toBeVisible();
    // …but a seeker gets no WhatsApp handoff at all — the owner channel is in-app messaging.
    await expect(page.getByRole('link', { name: /WhatsApp/i })).toHaveCount(0);
    await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
  });

  /* The mirror of the test above, and the reason it needed writing: the owner→visitor direction is
     the one handoff D5 keeps, so it has to actually render. `VisitsTab` used to read `v.customer`
     and `v.mobile`, which no provider publishes (the seam's names are `visitorName`/`visitorMobile`)
     — so the owner saw a nameless row and the `isFullMobile` guard silently swallowed the undefined
     number, suppressing the button. It failed *safe*, which is exactly why nothing caught it: the
     buyer-side test above passes either way. This asserts the positive case. */
  test('the owner sees the visitor by name and can WhatsApp them (visitorName/visitorMobile)', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${BASE}/dashboard#visits`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Upcoming visits/i }).first()).toBeVisible({ timeout: 10000 });

    // The visitor's name is rendered, not a blank or the "there" fallback.
    await expect(page.getByText('Asha Kulkarni').first()).toBeVisible();

    // …and the handoff points at that visitor's real number, not the owner's own.
    const wa = page.locator('a[href*="wa.me/919811111111"]');
    await expect(wa.first()).toBeVisible();
    await expect(wa.first()).toHaveAttribute('aria-label', /Asha Kulkarni/);
  });
});
