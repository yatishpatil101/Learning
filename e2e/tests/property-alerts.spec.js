import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

/* The Property Alerts feature:
   - Listings "no results" → "Create a property alert" card (NotifyMeCard).
   - Creating it feeds BOTH the user's dashboard Alerts tab AND the admin demand-gap.
   A fake ?loc= slug guarantees zero results deterministically. */

test('empty search shows the alert card and creating one confirms + feeds admin demand-gap', async ({ page }) => {
  // Anonymous user is fine — addDemandAlert does not require login.
  // ?ptype=flat pre-selects the Flat property type so it is carried into the alert.
  await page.goto(`${BASE}/listings?deal=rent&ptype=flat&loc=Testville`);

  // The redesigned alert card appears in the empty state.
  await expect(page.getByText('Nothing here yet? Get there first.')).toBeVisible();
  const createBtn = page.getByRole('button', { name: /Create alert/i });
  await expect(createBtn).toBeVisible();

  // Choose SMS channel, provide a mobile, submit.
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  await page.getByLabel('Mobile number for alerts').fill('9876500077');
  await createBtn.click();

  // Confirmation state with a link to manage alerts.
  await expect(page.getByText(/first in line/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Manage my alerts/i })).toBeVisible();

  // The admin Supply-Gap tab surfaces this as a demand signal for the locality,
  // including the requested property type (topType).
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
  await page.goto(`${BASE}/admin/analytics?tab=supply-gap`);
  await page.getByRole('tab', { name: 'Supply Gap' }).click();
  await expect(page.getByRole('heading', { name: /Demand Alerts by Locality/i })).toBeVisible();
  await expect(page.getByText(/Top: testville/i)).toBeVisible();
  const demandCard = page.locator('div.rounded-xl', { has: page.getByRole('heading', { name: /Demand Alerts by Locality/i }) });
  await expect(demandCard.getByText('Flat', { exact: true })).toBeVisible();
});

test('dashboard Alerts tab lists, toggles and deletes saved alerts', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Buyer', mobile: '9876500088', role: 'buyer', loginAt: Date.now() }));
    localStorage.setItem('pnSavedSearches:9876500088', JSON.stringify([
      { id: 'ssTEST', alerts: true, channel: 'whatsapp', at: Date.now(), newCount: 2, label: 'Flat · 2 BHK · Rent · Baner', deal: 'rent', types: ['flat'], localities: ['baner'], bhk: ['2'], furnishing: ['furnished'], amenities: [], budget: [0, 50000000], rent: [10000, 30000] },
    ]));
  });

  await page.goto(`${BASE}/dashboard#alerts`);

  // The alert is listed with its full criteria (incl. property type + furnishing) + new-match badge.
  await expect(page.getByText('Flat · 2 BHK · Rent · Baner')).toBeVisible();
  await expect(page.getByText('Flat', { exact: true })).toBeVisible();
  await expect(page.getByText('Furnished', { exact: true })).toBeVisible();
  await expect(page.getByText('2 new')).toBeVisible();
  await expect(page.getByText('Alerts on')).toBeVisible();

  // Toggle it off.
  await page.getByRole('switch').first().click();
  await expect(page.getByText('Alerts off')).toBeVisible();

  // Delete it → empty state.
  await page.getByRole('button', { name: /Delete alert/i }).click();
  await expect(page.getByText('No alerts yet')).toBeVisible();
});

test('dashboard exposes the Alerts surface in navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Buyer', mobile: '9876500099', role: 'buyer', loginAt: Date.now() }));
  });
  await page.goto(`${BASE}/dashboard`);
  // Alerts now live inside the consolidated "Saved & Activity" tab.
  await expect(page.getByRole('button', { name: 'Saved & Activity', exact: true }).first()).toBeVisible();
});
