// @ts-check
/* LIVE: manual rent receipts — a server-side immutable snapshot with a durable id, proved at the
   endpoints. Managed-property receipts for rent collected off-platform; 422s in `ManagedRentReceiptTest`. */
import { test, expect } from '@playwright/test';
import { trackErrors } from '../helpers/console.js';
import { signedInAs, signedInAsNew, authHeaders, API } from '../helpers/liveAuth.js';
import { pickPlaceholderLocality } from '../helpers/locality.js';
import { ensureLocalityStats } from '../helpers/localityStats.js';

const RENT = 31500;
const TENANT = 'Rohit More';

/** `[mobile, managedId]` for everything this spec created, so `afterAll` can put the database back. */
const created = [];

/* The month the status card is about, in IST: the server's window rule and the panel both read IST. */
const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);

/** How a ledger row prints that month — the same `Intl` short form `ymLabel` produces. */
const monthLabel = (ym) => {
  const [y, m] = ym.split('-');
  const short = new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(Number(y), Number(m) - 1, 1));
  return `${short} ${y}`;
};

/** Drive the Rent-o-meter to a saved property and return its id, taken from the passport URL. */
async function estimateAndSave(page, mobile) {
  await page.goto('/dashboard#owner-hub');
  await ensureLocalityStats('Baner');
  await pickPlaceholderLocality(page, 'Baner');
  await page.getByRole('button', { name: /Estimate now/i }).click();
  await expect(page.getByText(/Estimated monthly rent/i)).toBeVisible();

  const posted = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/me/managed-properties'
      && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: /Save as my property/i }).click();
  expect((await posted).status()).toBe(201);

  await page.waitForURL(/\/owner-hub\/property\//, { timeout: 20000 });
  const id = new URL(page.url()).pathname.split('/').pop();
  created.push([mobile, id]);
  return id;
}

/** Fill the rent-tracking setup form and switch the property to rented. */
async function startTracking(page) {
  await page.getByLabel(/Tenant name/i).fill(TENANT);
  await page.getByLabel(/Monthly rent/i).fill(String(RENT));
  await page.getByRole('button', { name: /Start tracking/i }).click();
  await expect(page.getByText(/Recent months/i)).toBeVisible({ timeout: 20000 });
}

/** A brand-new owner with one rented managed property. Isolated so no other spec's rows leak in. */
async function ownerWithRentedFlat(page) {
  const mobile = await signedInAsNew(page);
  const id = await estimateAndSave(page, mobile);
  await startTracking(page);
  return { mobile, id };
}

const receiptsUrl = (id) => `${API}/me/managed-properties/${id}/rent-receipts`;

test.describe('LIVE: manual rent receipts against the real API', () => {
  let errors;
  let apiFails;

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    apiFails = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) apiFails.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
  });

  test.afterEach(() => {
    expect(errors, `failed API calls: ${apiFails.join(', ') || 'none'}`).toEqual([]);
  });

  /* Delete via the API so cleanup doesn't depend on the screen it cleans up; receipts cascade with the parent. */
  test.afterAll(async () => {
    for (const [mobile, id] of created) {
      await fetch(`${API}/me/managed-properties/${id}`, {
        method: 'DELETE',
        headers: await authHeaders(mobile),
      });
    }
    created.length = 0;
  });

  test('marking a month received writes a server receipt that a second browser sees', async ({ page, browser }) => {
    const { mobile, id } = await ownerWithRentedFlat(page);
    const ym = thisMonth();

    // The positive anchor for the absence assertion below: the account genuinely has a rented flat
    // and a rent figure, so a receipt *could* exist. It does not yet.
    const before = await fetch(`${receiptsUrl(id)}?months=6`, { headers: await authHeaders(mobile) });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual([]);
    await expect(page.getByText('Received this month')).toBeHidden();

    const posted = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/me/managed-properties/${id}/rent-receipts`
        && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page.getByRole('button', { name: /^Mark received$/ }).first().click();
    expect((await posted).status()).toBe(201);
    await expect(page.getByText('Received this month')).toBeVisible();

    // Re-read from outside the page. A receipt that only exists in the tab that made it is the
    // exact failure this port was for.
    const res = await fetch(`${receiptsUrl(id)}?months=6`, { headers: await authHeaders(mobile) });
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].rentMonth).toBe(ym);
    // Derived by the server from the owned property, never accepted from the browser: the request
    // body carries `rentMonth` alone, so these fields prove the snapshot was taken server-side.
    expect(rows[0].amount).toBe(RENT);
    expect(rows[0].tenantName).toBe(TENANT);
    expect(rows[0].propertyAddress).toMatch(/Pune/);
    // A durable id, not a per-download `RCPT<timestamp>` — this is what a tenant quotes back.
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/i);

    // The whole point: a different browser, same account.
    const other = await browser.newContext();
    try {
      const page2 = await other.newPage();
      await signedInAs(page2, mobile);
      await page2.goto(`/owner-hub/property/${id}`);
      await expect(page2.getByText('Received this month')).toBeVisible({ timeout: 20000 });
      // Named by month, not just "Receipt": six ledger rows would otherwise offer six identical
      // accessible names for six different documents, and the wrong one is the wrong tax record.
      await expect(page2.getByRole('button', { name: monthLabel(ym), exact: false })).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test('a month can only be receipted once, and the second attempt is a deterministic 409', async ({ page }) => {
    const { mobile, id } = await ownerWithRentedFlat(page);
    const ym = thisMonth();

    const posted = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/me/managed-properties/${id}/rent-receipts`
        && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page.getByRole('button', { name: /^Mark received$/ }).first().click();
    expect((await posted).status()).toBe(201);
    await expect(page.getByText('Received this month')).toBeVisible();
    const first = await (await fetch(`${receiptsUrl(id)}?months=6`, { headers: await authHeaders(mobile) })).json();
    expect(first).toHaveLength(1);

    /* Driven over HTTP since the UI makes it unreachable; proves a racing or retried write is refused. */
    const again = await fetch(receiptsUrl(id), {
      method: 'POST',
      headers: await authHeaders(mobile),
      body: JSON.stringify({ rentMonth: ym }),
    });
    expect(again.status).toBe(409);

    const after = await (await fetch(`${receiptsUrl(id)}?months=6`, { headers: await authHeaders(mobile) })).json();
    expect(after).toHaveLength(1);
    // Same document, not a re-issue: a fresh id would leave the tenant's copy stale.
    expect(after[0].id).toBe(first[0].id);
  });
});
