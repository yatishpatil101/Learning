// @ts-check
import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/*
 * Rent Agreement — the owner's submit, against the server that prices it.
 *
 * ## Why this spec exists, and what its mock twin could not say
 *
 * `rent-agreement` is the one *priced* service type. `ServiceRequestPricing` costs it server-side,
 * `ServiceRequestService` commits it at `awaiting-payment`, and the response carries an `amount`
 * and a single-use `paymentSessionId`. None of that exists on a mock build: the mock provider
 * returns no session, so the wizard's whole paid branch (`useRentAgreement.js:910` onwards) is
 * unreachable there by construction. The mock spec beside this one therefore asserts the *free*
 * shape of a desk that is not free — its `submitFromReview` waits for "Request submitted!", which
 * is the emerald panel a live build never shows an owner who has not paid.
 *
 * So this is not a like-for-like port. The mock tests that ran the wizard to a submit were
 * asserting a journey that ends somewhere else live, and porting their assertions verbatim would
 * have pinned the mock's ending onto the server's flow.
 *
 * ## Why the paid path IS reachable from Playwright, contrary to the note it replaces
 *
 * `e2e/COVERAGE.md` recorded this gate as "⛔ by design — not reachable from e2e", on the reasoning
 * that "E2E runs mock-mode" and a spec "could only assert against a stub of our own making". Both
 * halves are now stale, and were re-derived rather than trusted:
 *
 *   - `serviceRequest` IS in the live suite's `VITE_API_DOMAINS` (`playwright.config.js`), so
 *     the live wizard posts to the real controller. Measured: 201, `status: awaiting-payment`,
 *     `amount: 4184`, `paymentSessionId: mock_session_…`.
 *   - The stub is not one a spec invents. `PaymentGateway.java:75` mints `mock_session_*` when the
 *     Cashfree provider is disabled, and `lib/cashfree.js:58` returns early on that prefix so the
 *     id never reaches the SDK — the product's own documented dev-mode gateway, on both sides.
 *
 * What genuinely stays out of reach is *settlement*: only the signature-verified webhook moves the
 * request to `new`, and forging a signature in a spec is the one thing this surface should not
 * learn to do. That half stays with `ServiceRequestFlowTest.PaidGate` on the backend, which drives
 * the real state machine.
 *
 * ## Ownership boundaries (what this spec deliberately does not claim)
 *
 *   - **The ops queue's blindness to an unpaid request** is NOT asserted here. `findForQueue`
 *     excludes `awaiting-payment` on purpose, and `ops/live-drafting-desk.spec.js` already
 *     documents that at length — it files a *valuation* precisely because the rental desk is always
 *     empty from e2e. Asserting an absence against a queue that is empty for unrelated reasons
 *     would be vacuous: measured, a seeded staffer reads zero rows from `GET /service-requests`
 *     even for a *free* request that is unambiguously in the queue, so the absence would pass with
 *     the gate removed. That is exactly the shape this branch has been burned by before.
 *   - **The owner's document vault** belongs to `consumer/services/live-rent-agreement-vault`.
 *   - **The draft-autosave redaction rule (D159)** is a genuine browser-storage claim and stays in
 *     the mock spec, where `localStorage` is the subject rather than an accident.
 *   - **The published fee schedule** is owned live by the row at `COVERAGE.md:437`; the mock test
 *     that poked `draazyDB_v5.settings.fees` was a duplicate of it and is deleted, not ported.
 *   - **The sample-draft affordances** (approve, request-changes, the draft-shared bell) cannot
 *     port at all: `ServiceTracker.jsx:138` gates the button on `!isHttpDomain('serviceRequest')`,
 *     so live there is no sample to preview. They stay mock-side as what they are — a demo.
 *   - **The co-fill invite and the invited-tenant journey** both run through the same paid submit
 *     and would need a settled payment to reach their assertions. Not ported; see the mock spec.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const PAY_PENDING = "We couldn't confirm your payment yet";
const SUBMITTED = 'Request submitted!';
const LOCKED = 'Your request is already submitted';

const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const active = (page) => page.locator('.step-panel.active');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMDAQCb8v8AAAAASUVORK5CYII=', 'base64');

/* Ported from the mock spec, and for the reason its own comment gives rather than for
   convenience: the Property, Owner and Tenant panels share every placeholder, so a Next that
   silently refused to advance leaves the next helper typing tenant answers into the owner panel
   and the run falls over several steps later on a locator with nothing to do with the cause. */
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

/** The first seeded listing, so the wizard can be opened the way an owner reaches it from a flat. */
async function firstPropertyId() {
  const res = await fetch(`${API}/properties?size=1`);
  const body = await res.json().catch(() => ({}));
  return (body.content || [])[0]?.id;
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
    /* The longest journey in the suite — four wizard steps and a review submit — and it now also
       waits out the post-checkout status poll. Triple the budget rather than trimming the flow. */
    test.slow();
    const mobile = await signedInAsNew(page, { api: API });
    const propertyId = await firstPropertyId();
    expect(propertyId, 'a seeded listing to open the wizard from').toBeTruthy();
    /* Opened from a listing, the way an owner actually reaches this wizard from their flat. It is
       not decoration: `POST /service-requests/{id}/docs` refuses a request with no `propertyId`
       (409), so a cold `/services/rent-agreement` can never carry the papers the wizard demands.
       That gap is filed in `tasks/DECISIONS-NEEDED.md`; this test covers the path that works. */
    await page.goto(`${BASE}/services/rent-agreement?listing=${propertyId}`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page, { withDoc: true });
    await fillTenant(page);
    await fillTerms(page);
    await clickNext(page, 5); // witnesses -> review

    const review = active(page);
    await review.getByRole('checkbox').check();

    /* Armed BEFORE the click. This is the whole point of the conversion: a wizard that clears and
       shows a panel looks identical whether the POST was accepted, refused, or never sent, and the
       mock twin could only ever read back what the browser itself had written. Match on method and
       an exact path tail — `recordServiceRequestIdentities` posts to
       `/service-requests/{id}/identities` moments later and would otherwise win the race. */
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests$/.test(new URL(r.url()).pathname),
    );
    await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();

    const res = await created;
    expect(res.status(), 'the server accepted the rent agreement').toBe(201);
    const body = await res.json();

    /* The three facts that only a server can supply, and that the mock provider supplies none of.
       `amount` is asserted as a positive number rather than a literal: the figure is derived from
       the terms plus the published platform fee, so pinning 4184 here would make this spec fail the
       day Ops edits a fee — a change this test has no opinion about. What matters is that a price
       was applied at all, which is what "priced desk" means. */
    expect(body.status, 'a priced desk parks the request until it is paid for').toBe('awaiting-payment');
    expect(Number(body.amount), 'the server priced it').toBeGreaterThan(0);
    expect(String(body.paymentSessionId), 'a checkout session was minted').toMatch(/^mock_session_/);
    expect(body.propertyId, 'the wizard bound the request to the listing it was opened from').toBe(propertyId);

    /* Read the row back from outside the browser. Even the response above is something the page
       received; this is the same row answered to a second caller holding only the account's token,
       which is the only form of proof the mock twin could not fake. */
    const { accessToken } = await apiLogin(mobile, { api: API });
    const rows = await ownRequests(accessToken);
    const ours = rows.find((r) => r.id === body.id);
    expect(ours, 'the request is readable from a second connection').toBeTruthy();
    expect(ours.type).toBe('rent-agreement');
    expect(ours.status).toBe('awaiting-payment');

    /* And the owner is told the truth about it. The poll spends its budget still reading
       `awaiting_payment` — nothing settles a mock session — so the amber panel is the correct
       ending, and the emerald "Request submitted!" would be a lie that invites a second payment.
       The positive wait comes first on purpose: `toHaveCount(0)` is satisfied instantly by a page
       that has not finished rendering, so a negative asserted first passes whether the guard works
       or not. That trap cost a vacuous test on this branch already. */
    await expect(page.getByText(PAY_PENDING)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('link', { name: /Complete payment/ })).toBeVisible();
    await expect(page.getByText(SUBMITTED)).toHaveCount(0);

    /* And the owner's paper is on the request, read back over HTTP.
     *
     * This is the assertion the mock twin could not make honestly. `createServiceRequest` carries
     * `docs` no further than the wizard — `toCreate` builds `{type, details, propertyId?,
     * ticketId?}` and never reads the field — so until this was fixed the owner's branch created
     * the request and uploaded nothing, while the mock spec read the same uploads back out of
     * `draazyServiceReq:` and passed. Matched on the real file name rather than a non-empty
     * `documents[]`, because a length check would also be satisfied by a placeholder. */
    const settled = (await ownRequests(accessToken)).find((r) => r.id === body.id);
    const names = (settled.documents || []).map((d) => d.name || d.fileName || '').join(',');
    expect(names, 'the owner\'s uploaded document reached the request').toMatch(/owner-pan/);
  });

  test('a second unpaid rent agreement is refused by the SERVER, not merely hidden by the wizard', async () => {
    const mobile = uniqueMobile();
    const first = await fileUnpaidRequest(mobile);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('awaiting-payment');

    /* The lock the next test sees on screen is a rule, and this is where the rule lives. A client
       that only hid the form would let anyone reach the same create by other means and be charged
       twice for one agreement. */
    const second = await fileUnpaidRequest(mobile);
    expect(second.status, 'the server refuses a second unpaid request for the same desk').toBe(409);
    expect(String(second.body.message)).toMatch(/already have an unpaid rent-agreement request/i);

    // And it refused rather than quietly filing one anyway.
    const rows = await ownRequests(first.accessToken);
    expect(rows.filter((r) => r.type === 'rent-agreement')).toHaveLength(1);
  });

  test('an owner returning with an unpaid request in flight gets the locked panel, not a fresh form', async ({ page }) => {
    /* `awaiting_payment` counts as active (`useRentAgreement.js:223`), so an unpaid request locks
       the wizard exactly as a paid one does — you do not get to describe the same agreement twice
       while the first is outstanding. Seeded over HTTP rather than through the wizard: the subject
       is what the page does with a request the SERVER already holds, and driving the wizard again
       would only re-prove the test above. */
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
