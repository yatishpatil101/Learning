import { expect, test, ACTORS } from '../fixtures/live.js';
import { signedInAs, authHeaders, API } from '../helpers/liveAuth.js';

// Two years back on the 1st, so `monthsPaid` is large, stable and never straddles a month end.
const LEASE_START = (() => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 2);
  return `${d.getUTCFullYear()}-01-01`;
})();

const RENT = 23500;
const DEPOSIT = 141000;
const ADDRESS = 'Zztest 4 Sunrise Residency, Baner';

// Creates the rental through the API and removes it afterwards, whatever the test did.
async function withRental(request, run) {
    // Unknown rent history must not render as a false ₹0 claim.
  const headers = await authHeaders(ACTORS.tenant, { request });
  const created = await request.post(`${API}/me/rentals`, {
    headers,
    data: {
      address: ADDRESS,
      monthlyRent: RENT,
      deposit: DEPOSIT,
      leaseStart: LEASE_START,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const rental = await created.json();
  try {
    await run(rental, headers);
  } finally {
    await request.delete(`${API}/me/rentals/${rental.id}`, { headers });
  }
}

test.describe('Rent Wallet — live', () => {
  test('with no rental declared, the wallet asks for one rather than showing zeroes', async ({ page, request }) => {
    const headers = await authHeaders(ACTORS.tenant, { request });
    const existing = await request.get(`${API}/me/rentals`, { headers }).then((r) => r.json());
    test.skip(existing.length > 0, 'a rental already exists for this actor; the empty state cannot be observed');

    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

    await expect(page.getByText('Add the home you rent')).toBeVisible({ timeout: 15000 });
    // This affordance navigates tenants without rentals to the rent catalogue.
    await expect(page.getByRole('link', { name: /Browse rentals/ })).toBeVisible();
  });

  test('a declared rental: the totals are the server’s derivation, the figures are self-declared, the tools read it, and it can be edited', async ({ page, request }) => {
    test.slow();
    await withRental(request, async (rental, headers) => {
      const open = async () => {
        await signedInAs(page, ACTORS.tenant);
        await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });
      };

      await test.step('the totals on screen are the server’s derivation', async () => {
        // The server derives these three from `leaseStart`.
        const months = rental.monthsPaid;
        expect(months, 'a two-year-old lease should have accrued instalments').toBeGreaterThan(20);
        expect(rental.totalPaid).toBe(months * RENT);

        const fresh = await request.get(`${API}/me/rentals`, { headers }).then((r) => r.json());
        const mine = fresh.find((r) => r.id === rental.id);
        expect(mine.totalPaid, 'the list and the create response must agree').toBe(rental.totalPaid);

        await open();

        await expect(page.getByText('Total recorded')).toBeVisible({ timeout: 15000 });
        // Match `fmtINR`; lakh values render as compact "₹7.76 L" strings.
        const lakhs = `₹${(rental.totalPaid / 100000).toFixed(2).replace(/\.00$/, '')} L`;
        expect(rental.totalPaid, 'this fixture must be past a lakh for the format above to hold').toBeGreaterThanOrEqual(100000);
        await expect(page.getByText(lakhs, { exact: false }).first()).toBeVisible();
        // The month count is printed unabbreviated beside it, so it pins the derivation exactly.
        await expect(page.getByText(`${months} months`, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(ADDRESS, { exact: false })).toBeVisible();
      });

      await test.step('the figures are self-declared and the Rent Passport stays sealed', async () => {
        await expect(page.getByText(/Draazy does not collect this rent and has not verified it/)).toBeVisible();

        await expect(page.getByRole('heading', { name: 'Rent Passport' })).toBeVisible();
        // `exact` because the sealed card also carries the prose "…— coming soon"; a substring match fails strict mode.
        await expect(page.getByText('Coming soon', { exact: true })).toBeVisible();
        // The old download button was the forgery vector; it must not have survived the rework.
        await expect(page.getByRole('button', { name: /Download report/ })).toHaveCount(0);
      });

      await test.step('the deposit tracker and HRA saver read the declared rental', async () => {
        await expect(page.getByText('Deposit locked')).toBeVisible();

        await expect(page.getByRole('heading', { name: 'HRA Tax Saver' })).toBeVisible();
        await page.locator('input[type="number"]').first().fill('600000');
        await expect(page.getByText('HRA exemption (Section 10(13A))')).toBeVisible();
        await expect(page.getByText('Estimated tax you save')).toBeVisible();
      });

      await test.step('the rental can be edited from the wallet itself', async () => {
        await open();

        await expect(page.getByText(ADDRESS, { exact: false })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: /^Edit$/ }).first().click();

        const rentField = page.getByLabel(/Monthly rent/);
        await rentField.fill(String(RENT + 1500));
        await page.getByRole('button', { name: /^Save$/ }).click();

        // API assertion proves persistence; toast and re-render only prove client state.
        await expect
          .poll(async () => {
            const rows = await request.get(`${API}/me/rentals`, { headers }).then((r) => r.json());
            return rows.find((r) => r.id === rental.id)?.monthlyRent;
          }, { timeout: 15000 })
          .toBe(RENT + 1500);
      });
    });
  });});
