import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* The Property Alerts feature:
   - Listings "no results" → "Create a property alert" card (NotifyMeCard).
   - Submitting it always feeds the admin demand-gap (anonymous or signed-in).
   - Since D85, a *managed* alert (dashboard Alerts tab) can only be created by a
     signed-in user; an anonymous submit still records the demand signal but then
     routes the visitor to sign in rather than writing a local alert they can't manage.
   A fake ?loc= slug guarantees zero results deterministically. */

test('anonymous alert submit captures the demand signal then routes to sign-in (D85)', async ({ page }) => {
  // ?ptype=flat pre-selects the Flat property type. It is *not* carried into the demand signal --
  // that used to be asserted here, and stopped being true when demand moved server-side: the
  // demand table stores a locality, a deal and a BHK, and no property type. The parameter is left
  // in place because it is also what forces the empty state this test needs.
  await page.goto(`${BASE}/listings?deal=rent&ptype=flat&loc=Testville`);

  // The redesigned alert card appears in the empty state.
  await expect(page.getByText('Nothing here yet? Get there first.')).toBeVisible();
  const createBtn = page.getByRole('button', { name: /Create alert/i });
  await expect(createBtn).toBeVisible();

  // Choose SMS channel, provide a mobile, submit.
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  await page.getByLabel('Mobile number for alerts').fill('9876500077');
  await createBtn.click();

  // D85: anonymous visitors can no longer self-serve a managed alert — they are routed
  // to sign in (the demand signal is captured before the redirect).
  await page.waitForURL(/\/signin\?reason=alerts/);

  // The admin Supply-Gap tab still surfaces this as a demand signal for the locality. Testville is
  // not a locality PuneNest knows, which is exactly the row this report exists to produce: real
  // demand against zero supply.
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
  await page.goto(`${BASE}/admin/analytics?tab=supply-gap`);
  await page.getByRole('tab', { name: 'Supply Gap' }).click();
  await expect(page.getByRole('heading', { name: /Demand Alerts by Locality/i })).toBeVisible();
  await expect(page.getByText(/Top: testville/i)).toBeVisible();
});

test('signed-in alert submit confirms with a link to manage alerts (D85)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Buyer', mobile: '9876500077', role: 'buyer', loginAt: Date.now() }));
  });
  await page.goto(`${BASE}/listings?deal=rent&ptype=flat&loc=Testville`);

  await expect(page.getByText('Nothing here yet? Get there first.')).toBeVisible();
  const createBtn = page.getByRole('button', { name: /Create alert/i });
  await expect(createBtn).toBeVisible();
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  await createBtn.click();

  // Signed-in visitors self-serve a managed alert and stay on the page.
  await expect(page.getByText(/first in line/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Manage my alerts/i })).toBeVisible();
});

test('dashboard Alerts tab lists, retunes and deletes saved alerts', async ({ page }) => {
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

  // The cadence picker replaced the on/off Switch (D84) — a row with `alerts: true` and no stored
  // frequency reads as the server's default rather than as an empty select.
  const freq = page.getByTestId('alert-frequency').first();
  await expect(freq).toHaveValue('daily');

  // Turn it off through the picker.
  await freq.selectOption('off');
  await expect(freq).toHaveValue('off');

  /* The point of D84: the two cadences the old boolean Switch could not express must
     survive a full off → on round trip in *stored* state, not merely in the select's
     value. `alerts` stays as a derived mirror so older readers keep working. */
  for (const cadence of ['instant', 'weekly']) {
    await freq.selectOption(cadence);
    await expect(freq).toHaveValue(cadence);
    await expect.poll(async () => page.evaluate(
      () => JSON.parse(localStorage.getItem('pnSavedSearches:9876500088') || '[]')[0],
    )).toMatchObject({ alertFrequency: cadence, alerts: true });
    await freq.selectOption('off');
    await expect(freq).toHaveValue('off');
  }

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
