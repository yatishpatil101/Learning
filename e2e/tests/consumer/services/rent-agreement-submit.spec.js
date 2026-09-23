// @ts-check
import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

// Settlement stays out of reach — only the signature-verified webhook moves the request to `new` —
// so the paid half is owned by `ServiceRequestFlowTest.PaidGate` on the backend.

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const PAY_PENDING = "We couldn't confirm your payment yet";
const SUBMITTED = 'Request submitted!';
const LOCKED = 'Your request is already submitted';

const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const active = (page) => page.locator('.step-panel.active');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=', 'base64');

/* The Property, Owner and Tenant panels share every placeholder, so a Next that silently refused to
   advance would only surface several steps later on an unrelated locator. */
const clickNext = async (page, expectStep) => {
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(
    page.locator('.step-dot').nth(expectStep),
    `wizard did not advance to step ${expectStep + 1}`,
  ).toHaveClass(/\bactive\b/);
};

async function fillProperty(page) {
  const p = active(page);
  await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
  await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
  await p.getByPlaceholder('e.g. Baner').fill('Baner');
  await p.getByPlaceholder('411045').fill('411045');
  await clickNext(page, 1);
}

async function fillOwner(page, { withDoc } = {}) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').fill('Anita Verma');
  await p.getByPlaceholder('ABCDE1234F').fill('ABCDE1234F');
  await p.getByPlaceholder('12-digit Aadhaar').fill('123412341234');
  await p.getByPlaceholder('10-digit mobile').fill('9811223344');
  await p.getByPlaceholder('Full permanent address').fill('12, MG Road, Pune 411001');
  if (withDoc) {
    await p.locator('input[type="file"]').first().setInputFiles({ name: 'owner-pan.png', mimeType: 'image/png', buffer: PNG });
    await expect(p.getByText('owner-pan.png')).toBeVisible();
  }
  await clickNext(page, 2);
}

async function fillTenant(page) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').fill('Rahul Nair');
  await p.getByPlaceholder('ABCDE1234F').fill('PQRSX6789K');
  await p.getByPlaceholder('12-digit Aadhaar').fill('999988887777');
  await p.getByPlaceholder('10-digit mobile').fill('9822334455');
  await p.getByPlaceholder('Full permanent address').fill('44, FC Road, Pune 411004');
  await clickNext(page, 3);
}

async function fillTerms(page) {
  const p = active(page);
  await p.locator('.dz-datefield').click();
  await page.locator('.dz-cal').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: todayIso(), exact: true }).first().click();
  await page.locator('.dz-cal').waitFor({ state: 'detached' });
  await p.getByPlaceholder('e.g. 25000').fill('30000');
  await p.getByPlaceholder('e.g. 100000').fill('150000');
  await clickNext(page, 4);
}

/** File a rent agreement over HTTP, the way the wizard does, without driving the wizard. */
async function fileUnpaidRequest(mobile) {
  const { accessToken } = await apiLogin(mobile, { api: API });
  const res = await fetch(`${API}/service-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      type: 'rent-agreement',
      details: { ownerName: 'Anita Verma', property: 'B-1204, Skyline Heights', rent: '30000', deposit: '150000' },
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
    /* `POST /service-requests/{id}/docs` refuses a request with no `propertyId` (409), so a cold
       `/services/rent-agreement` can never carry the papers the wizard demands. The wizard only
       resolves that id from the owner's *own* listings, which is why the flat is minted above
       rather than borrowed from the seed. */
    await page.goto(`${BASE}/services/rent-agreement?listing=${propertyId}`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page, { withDoc: true });
    await fillTenant(page);
    await fillTerms(page);
    await clickNext(page, 5); // witnesses -> review

    const review = active(page);
    await review.getByRole('checkbox').check();

    /* Armed before the click, and matched on method plus an exact path tail, because
       `recordServiceRequestIdentities` posts moments later and would otherwise win the race. */
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests$/.test(new URL(r.url()).pathname),
    );
    await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();

    const res = await created;
    expect(res.status(), 'the server accepted the rent agreement').toBe(201);
    const body = await res.json();

    /* `amount` is asserted as a positive number rather than a literal, so the spec does not fail
       the day Ops edits a fee — what matters is that a price was applied at all. */
    expect(body.status, 'a priced desk parks the request until it is paid for').toBe('awaiting-payment');
    expect(Number(body.amount), 'the server priced it').toBeGreaterThan(0);
    expect(String(body.paymentSessionId), 'a checkout session was minted').toMatch(/^mock_session_/);
    expect(body.propertyId, 'the wizard bound the request to the listing it was opened from').toBe(propertyId);

    /* The same row answered to a second caller holding only the account's token, which is proof
       independent of anything the page itself received. */
    const { accessToken } = await apiLogin(mobile, { api: API });
    const rows = await ownRequests(accessToken);
    const ours = rows.find((r) => r.id === body.id);
    expect(ours, 'the request is readable from a second connection').toBeTruthy();
    expect(ours.type).toBe('rent-agreement');
    expect(ours.status).toBe('awaiting-payment');

    /* The positive wait comes first on purpose: `toHaveCount(0)` is satisfied instantly by a page
       that has not finished rendering, so a negative asserted first would pass vacuously. */
    await expect(page.getByText(PAY_PENDING)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('link', { name: /Complete payment/ })).toBeVisible();
    await expect(page.getByText(SUBMITTED)).toHaveCount(0);

    /* Matched on the real file name rather than a non-empty `documents[]`, because a length check
       would also be satisfied by a placeholder. */
    const settled = (await ownRequests(accessToken)).find((r) => r.id === body.id);
    const names = (settled.documents || []).map((d) => d.name || d.fileName || '').join(',');
    expect(names, 'the owner\'s uploaded document reached the request').toMatch(/owner-pan/);
  });

  test('a second unpaid rent agreement is refused by the SERVER, not merely hidden by the wizard', async () => {
    const mobile = uniqueMobile();
    const first = await fileUnpaidRequest(mobile);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('awaiting-payment');

    /* A client that only hid the form would let anyone reach the same create by other means and be
       charged twice for one agreement. */
    const second = await fileUnpaidRequest(mobile);
    expect(second.status, 'the server refuses a second unpaid request for the same desk').toBe(409);
    expect(String(second.body.message)).toMatch(/already have an unpaid rent-agreement request/i);

    // And it refused rather than quietly filing one anyway.
    const rows = await ownRequests(first.accessToken);
    expect(rows.filter((r) => r.type === 'rent-agreement')).toHaveLength(1);
  });

  test('an owner returning with an unpaid request in flight gets the locked panel, not a fresh form', async ({ page }) => {
    /* `awaiting_payment` counts as active, so an unpaid request locks the wizard exactly as a paid
       one does. Seeded over HTTP so the subject is what the page does with a server-held request. */
    const mobile = await signedInAsNew(page, { api: API });
    const filed = await fileUnpaidRequest(mobile);
    expect(filed.status).toBe(201);

    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await expect(page.getByText(LOCKED)).toBeVisible({ timeout: 20000 });
    await expect(page.getByPlaceholder('e.g. Skyline Heights')).toHaveCount(0);

    // Starting a new agreement reveals a fresh, blank wizard for a different property.
    await page.getByRole('button', { name: /Start a new agreement/ }).click();
    const propInput = active(page).getByPlaceholder('e.g. Skyline Heights');
    await expect(propInput).toBeVisible();
    await expect(propInput).toHaveValue('');
  });
});
