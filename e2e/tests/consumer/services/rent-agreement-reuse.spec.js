// @ts-check
import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import {
  PNG, active, clickNext, fillOwner, fillProperty, fillTenant, fillTerms, fillWitnesses, inviteTenant, payAndSubmit,
} from '../../../helpers/rentAgreementWizard.js';
/* What the platform already holds is not asked for again. Each claim needs a second account or a
   server-side filing, so all three are asserted live. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const authed = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

async function invitesFor(token) {
  const res = await fetch(`${API}/me/service-request-invites`, { headers: authed(token) });
  expect(res.status).toBe(200);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function coFillOverHttp(ownerToken, inviteeMobile) {
  const res = await fetch(`${API}/service-requests/co-fill`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      request: {
        type: 'rent-agreement',
        details: { ownerName: 'Anita Verma', property: 'B-1204, Skyline Heights', rent: '30000', _state: { tenantMode: 'invite', prop: { gramPanchayat: false } } },
      },
      role: 'tenant',
      mobile: inviteeMobile,
    }),
  });
  expect(res.status, 'the server accepted the co-fill request').toBe(201);
  const body = await res.json();
  return { requestId: body.id, partyId: (body.parties || [])[0]?.id };
}

const inviteUrl = ({ partyId, requestId }) =>
  `${BASE}/services/rent-agreement?party=${encodeURIComponent(partyId)}&request=${encodeURIComponent(requestId)}`;

test.describe('Rent Agreement — reuse what the platform holds, live', () => {
  test('a declined invite is not a dead end — the owner re-invites someone else from the locked panel', async ({ page }) => {
    const ownerMobile = uniqueMobile();
    const { accessToken: ownerToken } = await apiLogin(ownerMobile, { api: API });
    const firstMobile = uniqueMobile();
    const { accessToken: firstToken } = await apiLogin(firstMobile, { api: API });
    const { requestId, partyId } = await coFillOverHttp(ownerToken, firstMobile);

    const declined = await fetch(`${API}/me/service-request-invites/${partyId}`, {
      method: 'POST', headers: authed(firstToken), body: JSON.stringify({ decision: 'decline' }),
    });
    expect(declined.ok, 'the invitee can decline').toBe(true);

    const nextMobile = uniqueMobile();
    const { accessToken: nextToken } = await apiLogin(nextMobile, { api: API });

    await signedInAs(page, ownerMobile);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    const panel = page.getByTestId('ra-declined-panel');
    await expect(panel.getByText('Your tenant declined the invitation')).toBeVisible();

    await panel.locator('#ra-reinvite-mobile').fill(nextMobile);
    await panel.getByRole('button', { name: /Invite someone else/ }).click();
    await expect(panel, 'a live invitation is no longer stalled').toHaveCount(0);

    const rows = await invitesFor(nextToken);
    expect(rows.map((r) => r.requestId), 'the new tenant is addressed by the same request').toContain(requestId);
  });

  test('once the tenant accepts, the owner can pay from the locked panel and hears why it is refused', async ({ page }) => {
    const ownerMobile = uniqueMobile();
    const { accessToken: ownerToken } = await apiLogin(ownerMobile, { api: API });
    const tenantMobile = uniqueMobile();
    const { accessToken: tenantToken } = await apiLogin(tenantMobile, { api: API });
    const { partyId } = await coFillOverHttp(ownerToken, tenantMobile);

    const accepted = await fetch(`${API}/me/service-request-invites/${partyId}`, {
      method: 'POST', headers: authed(tenantToken), body: JSON.stringify({ decision: 'accept' }),
    });
    expect(accepted.ok, 'the invitee can accept').toBe(true);

    await signedInAs(page, ownerMobile);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    const panel = page.getByTestId('ra-pay-panel');
    await expect(panel.getByText('Your tenant has filled in their part')).toBeVisible();
    /* The filing above has no papers, so the server's readiness check must refuse — and the
       owner must be told what it said, not left with a button that does nothing. */

    const checkout = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/[^/]+\/checkout$/.test(new URL(r.url()).pathname),
    /* The tenant's answers arrived after the owner's review-step tick, so paying asks again. */
    );
    await expect(panel.getByRole('button', { name: /^Pay/ })).toBeDisabled();
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: /^Pay/ }).click();
    const refused = await checkout;
    expect(refused.request().postDataJSON(), 'the accepted declaration travels with the checkout')
      .toEqual({ declaration: 'ra-decl-2026-09' });
    expect(refused.status(), 'the click reached the server checkout').toBe(409);
    await expect(page.getByText(/not ready for payment yet/)).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Pay/ })).toBeEnabled();
  });

  test('a filing that fell short is completed in place after a reload, not refused as a second unpaid request', async ({ page }) => {
    test.slow();
    const ownerMobile = await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    const fillAll = async () => {
      await fillProperty(page);
      await fillOwner(page);
      await fillTenant(page);
      await fillTerms(page);
      await fillWitnesses(page);
      await active(page).getByRole('checkbox').check();
    };
    const isCreate = (r) => r.method() === 'POST' && /\/service-requests$/.test(new URL(r.url()).pathname);
    /* The identities call failing is the ordinary way a filing lands without being ready to pay. */
    await page.route('**/service-requests/*/identities', (route) => route.fulfill({ status: 503, body: '{}' }), { times: 1 });
    await fillAll();
    const created = page.waitForResponse((r) => isCreate(r.request()));
    await payAndSubmit(page);
    const requestId = (await (await created).json()).id;
    await expect(page.getByText(/couldn't send the PAN and Aadhaar details/)).toBeVisible();

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('ra-continue-filed').click();
    await expect(page.locator('.step-dot').nth(0)).toHaveClass(/\bactive\b/);

    const creates = [];
    page.on('request', (r) => { if (isCreate(r)) creates.push(r.url()); });
    await fillAll();
    const checkout = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/[^/]+\/checkout$/.test(new URL(r.url()).pathname),
    );
    await payAndSubmit(page);
    const opened = await checkout;
    expect(opened.status(), 'the completed filing opened checkout').toBe(200);
    expect(new URL(opened.url()).pathname, 'on the request filed before the reload').toContain(requestId);
    expect(creates, 'nothing was filed a second time').toHaveLength(0);

    const res = await fetch(`${API}/service-requests?size=50`, { headers: await authHeaders(ownerMobile) });
    const rows = ((await res.json()).content || []).filter((r) => r.status === 'awaiting-payment');
    expect(rows.map((r) => r.id), 'one unpaid request, the original').toEqual([requestId]);
  });

  test('on another device, papers already on the filed request are not asked for again', async ({ page, browser }) => {
    test.slow();
    const ownerMobile = await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await page.route('**/service-requests/*/identities', (route) => route.fulfill({ status: 503, body: '{}' }), { times: 1 });
    await fillProperty(page);
    await fillOwner(page);
    await fillTenant(page);
    await fillTerms(page);
    await fillWitnesses(page);
    await active(page).getByRole('checkbox').check();
    const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/service-requests$/.test(new URL(r.url()).pathname));
    await payAndSubmit(page);
    const requestId = (await (await created).json()).id;
    await expect(page.getByText(/couldn't send the PAN and Aadhaar details/)).toBeVisible();
    /* A fresh context has no local draft: the answers come from the request, the papers must too. */
    const other = await (await browser.newContext()).newPage();
    await signedInAs(other, ownerMobile);
    await other.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await other.getByTestId('ra-continue-filed').click();

    const sent = [];
    other.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (r.method() === 'POST' && (/\/service-requests$/.test(path) || /\/docs(\/from-vault)?$/.test(path))) sent.push(path);
    // The statutory numbers never leave the tab they were typed in, so only those are retyped.
    });
    await fillProperty(other);
    await fillOwner(other, { docs: false, next: false });
    await expect(active(other).getByText('owner-doc-0.jpg'), 'the paper already filed fills its slot').toBeVisible();
    await clickNext(other, 2);
    await fillTenant(other, { docs: false });
    await fillTerms(other);
    await fillWitnesses(other);
    await active(other).getByRole('checkbox').check();
    const checkout = other.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/[^/]+\/checkout$/.test(new URL(r.url()).pathname),
    );
    await payAndSubmit(other);
    const opened = await checkout;
    expect(opened.status(), 'the papers on file satisfied the server checklist').toBe(200);
    expect(new URL(opened.url()).pathname).toContain(requestId);
    expect(sent, 'no paper re-sent and nothing re-filed').toEqual([]);
    await other.context().close();
  });

  async function filedShortToTenant(page, browser) {
    const tenantMobile = uniqueMobile();
    const { accessToken: tenantToken } = await apiLogin(tenantMobile, { api: API });
    const ownerMobile = await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await page.route('**/service-requests/*/identities', (route) => route.fulfill({ status: 503, body: '{}' }), { times: 1 });
    await fillProperty(page);
    await fillOwner(page);
    await inviteTenant(page, tenantMobile);
    await fillTerms(page);
    await fillWitnesses(page);
    await active(page).getByRole('checkbox').check();
    const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/service-requests\/co-fill$/.test(new URL(r.url()).pathname));
    await active(page).getByRole('button', { name: /Generate Agreement & Proceed/ }).click();
    const requestId = (await (await created).json()).id;
    await expect(page.getByText(/couldn't send the PAN and Aadhaar details/)).toBeVisible();

    const other = await (await browser.newContext()).newPage();
    await signedInAs(other, ownerMobile);
    await other.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await expect(other.getByText(/shared with your tenant and stay as filed/)).toBeVisible();
    await other.getByTestId('ra-continue-filed').click();
    return { other, requestId, tenantToken };
  }

  test('a co-fill filing that fell short is topped up in place, keeping the tenant\'s invitation', async ({ page, browser }) => {
    test.slow();
    const { other, requestId, tenantToken } = await filedShortToTenant(page, browser);

    const sent = [];
    other.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (r.method() === 'POST' && /\/service-requests(\/co-fill)?$|\/docs(\/from-vault)?$|\/cancel$/.test(path)) sent.push(path);
    });
    await fillProperty(other);
    await fillOwner(other, { docs: false });
    await clickNext(other, 3);
    await fillTerms(other);
    await fillWitnesses(other);
    await active(other).getByRole('checkbox').check();
    const identities = other.waitForResponse((r) => r.request().method() === 'PUT' && /\/identities$/.test(new URL(r.url()).pathname));
    await active(other).getByRole('button', { name: /Retry payment/ }).click();
    const put = await identities;
    expect(put.ok(), 'the owner\'s identities were recorded').toBe(true);
    expect(new URL(put.url()).pathname, 'on the request the tenant was invited to').toContain(requestId);
    await expect(other.getByText('Your side of the agreement is complete.')).toBeVisible();
    await expect(other.getByTestId('ra-continue-filed'), 'back on the locked panel').toBeVisible();
    expect(sent, 'nothing cancelled, re-filed or re-sent').toEqual([]);

    const rows = await invitesFor(tenantToken);
    expect(rows.map((r) => r.requestId), 'the tenant\'s invitation survived').toContain(requestId);
    await other.context().close();
  });

  test('a top-up that edits the shared answers is refused, and nothing is sent', async ({ page, browser }) => {
    test.slow();
    const { other } = await filedShortToTenant(page, browser);

    const sent = [];
    other.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (['POST', 'PUT'].includes(r.method()) && /\/service-requests(\/co-fill)?$|\/identities$|\/docs(\/from-vault)?$|\/cancel$/.test(path)) sent.push(path);
    });
    await fillProperty(other);
    await fillOwner(other, { docs: false });
    await clickNext(other, 3);
    await fillTerms(other, { next: false });
    await active(other).getByPlaceholder('e.g. 25000').fill('31000');
    await clickNext(other, 4);
    await fillWitnesses(other);
    await active(other).getByRole('checkbox').check();
    await active(other).getByRole('button', { name: /Retry payment/ }).click();

    await expect(other.getByText(/shared with your tenant and can't be changed here/)).toBeVisible();
    expect(sent, 'the refused top-up sent nothing').toEqual([]);
    await other.context().close();
  });

  test('a paper already in your Documents is filed by reference, not re-uploaded', async ({ page }) => {
    test.slow();
    const ownerMobile = await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);

    const o = active(page);
    const savedToVault = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/me\/documents\/personal$/.test(new URL(r.url()).pathname),
    );
    await o.locator('input[type="file"]').nth(0).setInputFiles({ name: 'live-pan.png', mimeType: 'image/png', buffer: PNG });
    expect((await savedToVault).ok(), 'the first owner paper was saved to the vault').toBe(true);
    await expect(o.getByText('Saved to your Documents')).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => page.evaluate(() => {
        const draft = JSON.parse(localStorage.getItem('dzDraft:rentAgreement') || '{}');
        return draft.docRefs?.owner?.['o-pan'] || null;
      }), { timeout: 10000 })
      .toMatchObject({ fileName: 'live-pan.jpg', fromVault: true });
    /* A vault row carries a signed URL, not bytes, so the reload proves the slot is held by id. */
    await page.reload({ waitUntil: 'networkidle' });
    await expect(o.getByText('live-pan.jpg')).toBeVisible();
    await expect(o.getByText('From your Documents')).toBeVisible();

    const inputs = o.locator('input[type="file"]');
    for (let i = 1; i < 4; i++) {
      await inputs.nth(i).setInputFiles({ name: `owner-doc-${i}.png`, mimeType: 'image/png', buffer: PNG });
      await expect(o.getByText(`owner-doc-${i}.jpg`)).toBeVisible();
    }
    await fillOwner(page, { docs: false });
    await inviteTenant(page, uniqueMobile());
    await fillTerms(page);
    await fillWitnesses(page);

    const review = active(page);
    await review.getByRole('checkbox').check();
    const filed = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/[^/]+\/docs\/from-vault$/.test(new URL(r.url()).pathname),
    );
    await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();
    const res = await filed;
    expect(res.status(), 'the server filed the vault copy onto the request').toBe(201);
    const { category } = JSON.parse(res.request().postData() || '{}');

    const requestId = new URL(res.url()).pathname.split('/').at(-3);
    const read = await fetch(`${API}/service-requests/${requestId}`, { headers: await authHeaders(ownerMobile) });
    expect(read.status).toBe(200);
    const docs = (await read.json()).documents || [];
    expect(docs.map((d) => d.category), 'the PAN is on the request under its slot').toContain(category);
  });
});
