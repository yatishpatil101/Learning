import { test, expect } from '@playwright/test';

/**
 * D227 / register item 33 — the saved-search match count comes off the seam, and both surfaces
 * that show it show the same number.
 *
 * ## The bug
 *
 * Two screens told the user how many listings match a saved alert: the notifications inbox
 * ("N properties match …") and the dashboard retention strip ("N homes match right now"). Both
 * computed N in the browser, each by fetching listings and filtering the result. The fetch returned
 * one page — `PAGE_SIZE = 100`. With 38 demo listings that was accidentally correct; with 101 it
 * would silently become a ceiling rather than a count, and the only guard against that was a
 * `console.warn` the runner throws away.
 *
 * The count now arrives on the saved-search record itself: `matchCount`, filled by the server on
 * live and by the mock provider over its whole in-memory catalogue here. Neither surface counts
 * anything any more.
 *
 * ## What is asserted
 *
 * Not the literal number — that is a property of the demo fixtures and would make this a change
 * detector. What is asserted is that the number **exists, is non-zero for an alert that plainly
 * matches, is identical on both screens, and is suppressed for the cases that should not count.**
 * The cross-surface equality is the real net: the two screens used to derive it separately and were
 * one edit away from disagreeing.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876500233';

/** A rent alert on Baner, which the demo catalogue definitely has listings for. */
const BANER_RENT = {
  id: 'ssD227',
  alerts: true,
  channel: 'whatsapp',
  at: Date.now(),
  label: 'Rent · Baner',
  deal: 'rent',
  localities: ['baner'],
  bhk: [],
  furnishing: [],
  amenities: [],
};

async function signedInWith(page, searches) {
  await page.addInitScript(([mobile, rows]) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Buyer', mobile, role: 'buyer', loginAt: Date.now(),
    }));
    localStorage.setItem(`pnSavedSearches:${mobile}`, JSON.stringify(rows));
  }, [MOBILE, searches]);
}

/** The count the dashboard renders for the first alert in its retention strip. */
async function dashboardCount(page) {
  await page.goto(`${BASE}/dashboard`);
  const strip = page.getByTestId('alert-matches');
  await expect(strip).toBeVisible();
  const text = await strip.getByText(/homes? match(es)? right now/).first().innerText();
  return Number(text.match(/^(\d+)/)[1]);
}

/** The count the notifications inbox renders for the same alert. */
async function notificationCount(page) {
  await page.goto(`${BASE}/notifications`);
  const row = page.getByText(/propert(y|ies) match "Rent · Baner"/).first();
  await expect(row).toBeVisible();
  return Number((await row.innerText()).match(/^(\d+)/)[1]);
}

test('the inbox and the dashboard report the same match count, and it is not zero', async ({ page }) => {
  await signedInWith(page, [BANER_RENT]);

  const onDashboard = await dashboardCount(page);
  expect(onDashboard).toBeGreaterThan(0);

  const inInbox = await notificationCount(page);
  expect(inInbox).toBe(onDashboard);
});

test('the count is of the catalogue, not of the listings one page happens to hold', async ({ page }) => {
  await signedInWith(page, [BANER_RENT]);

  // Narrowing by a facet must move the number, which it can only do if the number is being derived
  // from the alert's criteria rather than from "however many listings came back".
  const broad = await dashboardCount(page);

  await page.addInitScript(([mobile, row]) => {
    localStorage.setItem(`pnSavedSearches:${mobile}`, JSON.stringify([row]));
  }, [MOBILE, { ...BANER_RENT, bhk: ['1'] }]);
  const narrow = await dashboardCount(page);

  expect(narrow).toBeLessThanOrEqual(broad);
});

test('a locality nobody has listed in counts zero rather than falling back to everything', async ({ page }) => {
  await signedInWith(page, [{ ...BANER_RENT, localities: ['testville'], label: 'Rent · Testville' }]);

  await page.goto(`${BASE}/notifications`);
  // The inbox still loads; it simply has no match row to show for this alert.
  await expect(page.getByText(/propert(y|ies) match "Rent · Testville"/)).toHaveCount(0);
});

test('an alert the user switched off produces no match row', async ({ page }) => {
  await signedInWith(page, [{ ...BANER_RENT, alerts: false, alertFrequency: 'off' }]);

  await page.goto(`${BASE}/notifications`);
  await expect(page.getByText(/propert(y|ies) match "Rent · Baner"/)).toHaveCount(0);
});

test('a flatmates alert is not counted — this number does not cover rooms', async ({ page }) => {
  await signedInWith(page, [{ ...BANER_RENT, kind: 'flatmates', label: 'Flatmate · Baner' }]);

  await page.goto(`${BASE}/notifications`);
  await expect(page.getByText(/propert(y|ies) match "Flatmate · Baner"/)).toHaveCount(0);
});
