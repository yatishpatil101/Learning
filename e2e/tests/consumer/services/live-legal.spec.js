/**
 * LIVE conversion of `consumer/services/legal.spec.js`.
 *
 * The live-only boundary is not the calculator's deliberately client-side Maharashtra
 * arithmetic: it is the post-submit contract. A legal enquiry must create both an ops ticket
 * owned by the Legal desk and a tracker request of type `legal` that links to that ticket.
 * `live-service-landing-ticket` proves that contract for Packers; this page has a different
 * `team` and `flowType`, so it needs its own proof. The calculator tests retain the mock's
 * useful customer-facing coverage and also exercise the themed dropdowns users really see.
 */
import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, authHeaders, signIn } from '../../../helpers/liveAuth.js';
import { appReady } from '../../../helpers/app.js';

const SERVICE_OPTION = 'Stamp Duty & Registration Charges';
const choose = async (page, field, option) => {
  await page.locator(`[data-err="${field}"] .dz-dropdown__trigger`).click();
  await page.getByRole('option', { name: option }).click();
};

const chooseCalculator = async (page, calculator, index, option) => {
  await calculator.locator('.dz-dropdown__trigger').nth(index).click();
  await page.getByRole('option', { name: option }).click();
};

const ticketIds = async (page, headers) => {
  const response = await page.request.get(`${API}/tickets?team=legal&size=100`, { headers });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return new Set((body.content || []).map((ticket) => ticket.id));
};

test.describe('LIVE: Property Legal', () => {
  test('renders a Pune municipal calculation and applies the female-owner concession', async ({ page, consoleErrors }) => {
    await page.goto('/services/property-legal');
    await appReady(page);

    const calculator = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Estimate your stamp duty & registration' }) });
    const total = calculator.locator('.gradient-text');
    await expect(total).toHaveText('₹4,80,000');
    await expect(calculator.getByText('Stamp duty (6%)')).toBeVisible();
    await expect(calculator.getByText('₹4.5 L')).toBeVisible();
    await expect(calculator.getByText('₹30,000')).toBeVisible();

    await chooseCalculator(page, calculator, 1, 'Female (sole owner)');
    await expect(total).toHaveText('₹4,05,000');
    await expect(calculator.getByText('Stamp duty (5%)')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('changing location changes the rate without changing the capped registration fee', async ({ page }) => {
    await page.goto('/services/property-legal');
    await appReady(page);

    const calculator = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Estimate your stamp duty & registration' }) });
    await chooseCalculator(page, calculator, 0, 'Gram Panchayat (rural)');
    await expect(calculator.locator('.gradient-text')).toHaveText('₹3,30,000');
    await expect(calculator.getByText('Stamp duty (4%)')).toBeVisible();
    await expect(calculator.getByText('₹30,000')).toBeVisible();
  });

  test('a signed-out request preserves the exact legal destination in its sign-in handoff', async ({ page }) => {
    await page.goto('/services/property-legal');
    await appReady(page);

    await page.locator('#quote').getByRole('button', { name: 'Request Assistance' }).click();
    await expect(page).toHaveURL(/\/signin\?reason=service/);
    await expect(page).toHaveURL(/next=.*property-legal/);
  });

  test('a legal enquiry reaches the Legal desk and its tracker request names the linked ticket', async ({ page }) => {
    const desk = await authHeaders(STAFF.legal);
    const beforeIds = await ticketIds(page, desk);

    await signIn(page, ACTORS.tenant);
    await page.goto('/services/property-legal');
    await appReady(page);
    await choose(page, 'service', SERVICE_OPTION);
    await page.locator('#quote').getByRole('button', { name: 'Request Assistance' }).click();
    await expect(page.getByRole('heading', { name: 'Request received!' })).toBeVisible();

    let lead = null;
    await expect.poll(async () => {
      const response = await page.request.get(`${API}/tickets?team=legal&size=100`, { headers: desk });
      const body = await response.json();
      lead = (body.content || []).find((ticket) => !beforeIds.has(ticket.id));
      return lead ? 1 : 0;
    }, { timeout: 15_000 }).toBe(1);
    expect(lead.team).toBe('legal');
    expect(lead.subject).toBe(SERVICE_OPTION);

    const mine = await authHeaders(ACTORS.tenant);
    let tracked = null;
    await expect.poll(async () => {
      const response = await page.request.get(`${API}/service-requests?type=legal`, { headers: mine });
      const body = await response.json();
      tracked = (body.content || []).find((request) => request.ticketId === lead.id);
      return tracked ? 1 : 0;
    }, { timeout: 15_000 }).toBe(1);
    expect(tracked.type).toBe('legal');
    expect(tracked.ticketId).toBe(lead.id);
    await expect(page.getByRole('heading', { name: 'Your legal & registration requests' })).toBeVisible();
    await expect(page.getByText('Property & Legal', { exact: true })).toBeVisible();
    await expect(page.getByText(tracked.id.slice(0, 10), { exact: false })).toBeVisible();
  });
});
