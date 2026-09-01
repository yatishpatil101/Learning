// @ts-check
/**
 * The tenant Rent Wallet against the live API.
 *
 * ## What this replaces, and why the old spec could not simply be edited
 *
 * The previous version of this file tested a wallet fed by `GET /me/rent-payments` — a ledger of
 * rent the tenant had paid *through PuneNest*. Its most valuable assertion was that a **failed**
 * charge must not be counted as rent received: three separate pieces of logic (`rentSummary`'s
 * lifetime total, `rentPassport.onTime`, and the literal "On time" the PDF printed against every
 * row) had all been true only because the local store held nothing but successes.
 *
 * V127 withdrew that rail. There are no payment rows to mis-count any more, so those assertions
 * have nothing left to protect and are not ported. The wallet is now fed by `GET /me/rentals`: one
 * record the tenant writes about a home they rent **somewhere else**, from which the server derives
 * `monthsPaid`, `totalPaid` and `fyPaid`.
 *
 * ## What is worth asserting instead
 *
 * The risk moved rather than disappeared. It is now that a self-declared figure gets presented as
 * though PuneNest had verified it — the same class of defect as labelling a failed charge settled,
 * one layer up. So two things are load-bearing here:
 *
 *  1. **The totals are the server's, not the browser's.** `RentalTotals` derives them from
 *     `leaseStart`; the client must never recompute, or the two will drift and only one of them is
 *     right. The spec therefore fetches `/me/rentals` and compares it to the screen.
 *  2. **The disclaimer and the sealed Rent Passport are both present.** A Passport built from typed
 *     input is a forgery with a logo on it. It stays locked until real rent moves, and the card
 *     must say so rather than quietly rendering nothing.
 *
 * The fixture is created by the spec rather than seeded, because `tenant_rentals` is deliberately
 * left unseeded — a rental nobody declared is exactly the thing that should not appear.
 */
import { expect, test, ACTORS } from '../fixtures/live.js';
import { signedInAs, authHeaders } from '../helpers/liveAuth.js';

const API = 'http://localhost:8081/api';

/** Two years back on the 1st, so `monthsPaid` is large, stable and never straddles a month end. */
const LEASE_START = (() => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 2);
  return `${d.getUTCFullYear()}-01-01`;
})();

const RENT = 23500;
const DEPOSIT = 141000;
const ADDRESS = 'Zztest 4 Sunrise Residency, Baner';

/** Creates the rental through the API and removes it afterwards, whatever the test did. */
async function withRental(request, run) {
  const headers = await authHeaders(ACTORS.tenant, { request });
  const created = await request.post(`${API}/me/rentals`, {
    headers,
    data: {
      address: ADDRESS,
      landlordName: 'Zztest Landlord',
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
    // Soft delete; the row survives with `archived = true`, which is what the endpoint does.
    await request.delete(`${API}/me/rentals/${rental.id}`, { headers });
  }
}

test.describe('Rent Wallet — live', () => {
  test('with no rental declared, the wallet asks for one rather than showing zeroes', async ({ page, request }) => {
    /* The honest empty state. A wallet that rendered "₹0 paid this year" for a tenant who has told
       it nothing would be making a claim about their rent, not about its own ignorance. */
    const headers = await authHeaders(ACTORS.tenant, { request });
    const existing = await request.get(`${API}/me/rentals`, { headers }).then((r) => r.json());
    test.skip(existing.length > 0, 'a rental already exists for this actor; the empty state cannot be observed');

    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

    await expect(page.getByText('Add the home you rent')).toBeVisible({ timeout: 15000 });
    // A link, not a button: the second affordance leaves the dashboard for the rent catalogue,
    // so a tenant who has not declared a rental because they do not have one yet has somewhere
    // to go. Asserted by role so a `<button>` that only looks like a link would fail here.
    await expect(page.getByRole('link', { name: /Browse rentals/ })).toBeVisible();
  });

  test('the totals on screen are the server’s derivation, not a number the browser worked out', async ({ page, request }) => {
    await withRental(request, async (rental, headers) => {
      /* The server derives these three from `leaseStart`. Asserting the API's own arithmetic first
         makes the screen comparison meaningful: if the browser recomputed, the two would agree only
         by luck, and this fixture's two-year lease is long enough that any off-by-one shows. */
      const months = rental.monthsPaid;
      expect(months, 'a two-year-old lease should have accrued instalments').toBeGreaterThan(20);
      expect(rental.totalPaid).toBe(months * RENT);

      const fresh = await request.get(`${API}/me/rentals`, { headers }).then((r) => r.json());
      const mine = fresh.find((r) => r.id === rental.id);
      expect(mine.totalPaid, 'the list and the create response must agree').toBe(rental.totalPaid);

      await signedInAs(page, ACTORS.tenant);
      await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

      await expect(page.getByText('Total recorded')).toBeVisible({ timeout: 15000 });
      /* Matched through the same rule `fmtINR` applies, which is NOT plain Indian grouping: at or
         above a lakh it prints "₹7.76 L", so asserting `toLocaleString('en-IN')` here would look
         right and match nothing. The digits are still the server's — the browser only chose how
         to abbreviate them — so this remains a comparison against `rental.totalPaid`. */
      const lakhs = `₹${(rental.totalPaid / 100000).toFixed(2).replace(/\.00$/, '')} L`;
      expect(rental.totalPaid, 'this fixture must be past a lakh for the format above to hold').toBeGreaterThanOrEqual(100000);
      await expect(page.getByText(lakhs, { exact: false }).first()).toBeVisible();
      // The month count is printed unabbreviated beside it, so it pins the derivation exactly.
      await expect(page.getByText(`${months} months`, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(ADDRESS, { exact: false })).toBeVisible();
    });
  });

  test('the wallet says the figures are self-declared, and the Rent Passport stays sealed', async ({ page, request }) => {
    /* The assertion this file exists for. Both halves must hold together: the disclaimer without
       the seal would still leave a downloadable credential built from typed input, and the seal
       without the disclaimer would leave the KPI tiles reading as verified. */
    await withRental(request, async () => {
      await signedInAs(page, ACTORS.tenant);
      await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

      await expect(page.getByText(/PuneNest does not collect this rent and has not verified it/))
        .toBeVisible({ timeout: 15000 });

      await expect(page.getByRole('heading', { name: 'Rent Passport' })).toBeVisible();
      // `exact` because the sealed card also carries the prose "…— coming soon"; the badge is the
      // thing being asserted, and a substring match resolves to both and fails on strict mode.
      await expect(page.getByText('Coming soon', { exact: true })).toBeVisible();
      // The old download button was the forgery vector; it must not have survived the rework.
      await expect(page.getByRole('button', { name: /Download report/ })).toHaveCount(0);
    });
  });

  test('the deposit tracker and HRA saver read the declared rental', async ({ page, request }) => {
    await withRental(request, async () => {
      await signedInAs(page, ACTORS.tenant);
      await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

      await expect(page.getByText('Deposit locked')).toBeVisible({ timeout: 15000 });

      await expect(page.getByRole('heading', { name: 'HRA Tax Saver' })).toBeVisible();
      await page.locator('input[type="number"]').first().fill('600000');
      await expect(page.getByText('HRA exemption (Section 10(13A))')).toBeVisible();
      await expect(page.getByText('Estimated tax you save')).toBeVisible();
    });
  });

  test('a rental can be edited and removed from the wallet itself', async ({ page, request }) => {
    await withRental(request, async (rental, headers) => {
      await signedInAs(page, ACTORS.tenant);
      await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

      await expect(page.getByText(ADDRESS, { exact: false })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: /^Edit$/ }).first().click();

      const rentField = page.getByLabel(/Monthly rent/);
      await rentField.fill(String(RENT + 1500));
      await page.getByRole('button', { name: /^Save$/ }).click();

      /* Asserted against the API rather than the screen: the toast and the re-render both prove the
         client changed its mind, and neither proves the row did. */
      await expect
        .poll(async () => {
          const rows = await request.get(`${API}/me/rentals`, { headers }).then((r) => r.json());
          return rows.find((r) => r.id === rental.id)?.monthlyRent;
        }, { timeout: 15000 })
        .toBe(RENT + 1500);
    });
  });
});
