// @ts-check
import { test, expect } from '@playwright/test';
import { API, apiLogin, uploadedListingPhotos, signedInAsNew } from '../../../helpers/liveAuth.js';
import { SOCIETY_PLACEHOLDER, active, fillOwner, fillProperty, fillTenant, fillTerms, fillWitnesses, payAndSubmit } from '../../../helpers/rentAgreementWizard.js';
// Settlement stays out of reach — only the signature-verified webhook moves the request to `new` —
// so the paid half is owned by `ServiceRequestFlowTest.PaidGate` on the backend.
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const PAY_PENDING = "We couldn't confirm your payment yet";
const SUBMITTED = 'Request submitted!';
const LOCKED = 'Your request is already submitted';
/** File a rent agreement over HTTP, the way the wizard does, without driving the wizard. */
async function fileUnpaidRequest(mobile) {
  const { accessToken } = await apiLogin(mobile, { api: API });
  const res = await fetch(`${API}/service-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      type: 'rent-agreement',
      details: { ownerName: 'Anita Verma', property: 'B-1204, Skyline Heights', rent: '30000', deposit: '150000', _state: { prop: { gramPanchayat: false } } },
    }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), accessToken };
}
/* One listing belonging to the caller. It has to be *theirs*: the wizard resolves `?listing=` against
   `myListings`, so a flat this account does not own prefills nothing and leaves `propertyId` unset. */

async function createOwnListing(token) {
  const res = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: '2BHK in Baner',
      deal: 'rent',
      propertyType: 'apartment',
      price: 30000,
      bhk: 2,
      locality: 'Baner',
      city: 'Pune',
      floor: 4,
      images: await uploadedListingPhotos(token),
    }),
  });
  if (res.status >= 400) throw new Error(`POST /me/listings → ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}
/** Read this owner's requests from outside the browser. */
async function ownRequests(accessToken) {
  const res = await fetch(`${API}/service-requests?size=50`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => ({}));
  return body.content || [];
}

test.describe('Rent Agreement — the priced desk, live', () => {
  test('submitting the wizard files a request the SERVER priced and parked, and the owner is told payment is outstanding rather than that it is done', async ({ page }) => {
    /* The longest journey in the suite — four wizard steps, a review submit, and the post-checkout
       status poll. Triple the budget rather than trimming the flow. */
    test.slow();
    const mobile = await signedInAsNew(page, { api: API });
    const { accessToken: ownerToken } = await apiLogin(mobile, { api: API });
    const propertyId = await createOwnListing(ownerToken);
    expect(propertyId, 'a listing of this owner to open the wizard from').toBeTruthy();
    await page.goto(`${BASE}/services/rent-agreement?listing=${propertyId}`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page);
    await fillTenant(page);
    await fillTerms(page, { deposit: '1,50,000' });
    await fillWitnesses(page);

    const review = active(page);
    await review.getByRole('checkbox').check();
    await expect(review.getByRole('button', { name: /Pay ₹[\d,]+ & Submit/ })).toBeVisible();
    await expect(review.getByText('Your request reaches our team only after payment.')).toBeVisible();
    const consents = [];
    page.on('request', (r) => { if (/tenant-consents/.test(r.url())) consents.push(r.url()); });
    /* Matched on method plus an exact path tail, because `recordServiceRequestIdentities` posts
       moments later and would otherwise win the race. */
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests$/.test(new URL(r.url()).pathname),
    );
    /* Payment opens only after every party's identity and every required paper is on file, so the
       session comes from `/checkout`, not from the create. */
    const checkout = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/[^/]+\/checkout$/.test(new URL(r.url()).pathname),
    );
    await payAndSubmit(page);

    const res = await created;
    expect(res.status(), 'the server accepted the rent agreement').toBe(201);
    const sent = res.request().postDataJSON().details;
    expect(sent.deposit, 'a grouped deposit reaches the server as the number typed, not 0').toBe(150000);
    expect(sent.nrDeposit, 'the non-refundable deposit is sent, not left for the server to guess').toBe(0);
    expect(sent._state.terms.deposit, 'the form copy agrees with the summary').toBe('150000');
    expect(sent._state.terms.depositPayments, 'how the deposit was paid reaches the server for the IGR form').toEqual([
      { mode: 'upi', ref: '612345678901', amount: '150000', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    ]);
    const body = await res.json();
    /* `amount` is asserted as a positive number rather than a literal, so the spec does not fail
       the day Ops edits a fee — what matters is that a price was applied at all. */

    expect(body.status, 'a priced desk parks the request until it is paid for').toBe('awaiting-payment');
    expect(Number(body.amount), 'the server priced it').toBeGreaterThan(0);
    expect(body.paymentSessionId || null, 'no session before the papers are in').toBeNull();
    const opened = await checkout;
    expect(opened.status(), 'checkout opened once the request was complete').toBe(200);
    expect(opened.request().postDataJSON(), 'the declaration ticked on review is named, so the server can record it')
      .toEqual({ declaration: 'ra-decl-2026-09' });
    expect(String((await opened.json()).paymentSessionId), 'a checkout session was minted').toMatch(/^mock_session_/);
    expect(body.propertyId, 'the wizard bound the request to the listing it was opened from').toBe(propertyId);

    const { accessToken } = await apiLogin(mobile, { api: API });
    const rows = await ownRequests(accessToken);
    const ours = rows.find((r) => r.id === body.id);
    expect(ours, 'the request is readable from a second connection').toBeTruthy();
    expect(ours.type).toBe('rent-agreement');
    expect(ours.status).toBe('awaiting-payment');
    /* The positive wait comes first on purpose: `toHaveCount(0)` is satisfied instantly by a page
       that has not finished rendering, so a negative asserted first would pass vacuously. */

    await expect(page.getByText(PAY_PENDING)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /Complete payment/ })).toBeVisible();
    await expect(page.getByText(SUBMITTED)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /Confirm tenant/ })).toHaveCount(0);
    expect(consents, 'no tenant OTP step').toEqual([]);
    /* Matched on the real file name rather than a non-empty `documents[]`, because a length check
       would also be satisfied by a placeholder. */

    const settled = (await ownRequests(accessToken)).find((r) => r.id === body.id);
    const names = (settled.documents || []).map((d) => d.name || d.fileName || '').join(',');
    for (const n of ['owner-doc-0', 'owner-doc-3', 'tenant-doc-0', 'tenant-doc-2', 'tenant-doc-3']) {
      expect(names, `${n} reached the request`).toContain(n);
    }

    const resumed = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/[^/]+\/checkout$/.test(new URL(r.url()).pathname),
    );
    await page.getByRole('button', { name: /Complete payment/ }).click();
    const again = await resumed;
    expect(again.status(), 'the open order is resumed, not refused').toBe(200);
    expect(String((await again.json()).paymentSessionId), 'a fresh session for the same order').toMatch(/^mock_session_/);
  });

  test('an owner returning with an unpaid request in flight gets the locked panel, not a fresh form', async ({ page }) => {
    /* `awaiting_payment` counts as active, so an unpaid request locks the wizard exactly as a paid
       one does. Seeded over HTTP so the subject is what the page does with a server-held request. */
    const mobile = await signedInAsNew(page, { api: API });
    const filed = await fileUnpaidRequest(mobile);
    expect(filed.status).toBe(201);

    await test.step('the server, not the wizard, refuses a second unpaid request', async () => {
      const second = await fileUnpaidRequest(mobile);
      expect(second.status, 'the server refuses a second unpaid request for the same desk').toBe(409);
      expect(String(second.body.message)).toMatch(/already have an unpaid rent-agreement request/i);
      const rows = await ownRequests(filed.accessToken);
      expect(rows.filter((r) => r.type === 'rent-agreement')).toHaveLength(1);
    });

    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await expect(page.getByText(LOCKED)).toBeVisible({ timeout: 20000 });
    await expect(page.getByPlaceholder(SOCIETY_PLACEHOLDER)).toHaveCount(0);
    // Starting a new agreement reveals a fresh, blank wizard for a different property.
    await page.getByRole('button', { name: /Start a new agreement/ }).click();
    const propInput = active(page).getByPlaceholder(SOCIETY_PLACEHOLDER);
    await expect(propInput).toBeVisible();
    await expect(propInput).toHaveValue('');
  });
});
