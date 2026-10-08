// Registration needs a second operator and a tenant who accepted the co-fill invite.
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { ACTORS, BASELINE_STAFF, STAFF } from '../../fixtures/live.js';
import { API, apiLogin, uploadedListingPhotos, signIn, uniqueMobile } from '../../helpers/liveAuth.js';

const PSQL = process.env.PSQL || 'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe';
const TENANT_NAME = 'Live Check Tenant';
const TYPED_NAME = 'Typed Only Tenant';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const bearer = (token) => ({ authorization: `Bearer ${token}` });
const json = (token) => ({ 'content-type': 'application/json', ...bearer(token) });

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body instanceof FormData ? bearer(token) : json(token),
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function ok(method, path, token, body) {
  const res = await call(method, path, token, body);
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${res.text}`);
  return res.body;
}

const upload = (name, fields = {}) => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), name);
  Object.entries(fields).forEach(([key, value]) => [value].flat().forEach((item) => form.append(key, item)));
  return form;
};
const CHECKS = { checks: ['identity', 'title', 'poa', 'address', 'terms'] };

async function fileAndVerify(requestId, desk, { licensor, tenant = licensor }) {
  const { items } = await ok('GET', `/service-requests/${requestId}/checklist`, licensor);
  for (const item of items) {
    const filer = item.id.startsWith('tenant-0-') ? tenant : licensor;
    await ok('POST', `/service-requests/${requestId}/docs`, filer, upload(`${item.id}.png`, { category: item.id }));
  }
  const filed = await ok('GET', `/service-requests/${requestId}/checklist`, desk);
  for (const item of filed.items) {
    await ok('PUT', `/service-requests/${requestId}/checklist/${item.id}`, desk, { documentId: item.documentId, verdict: 'verified' });
  }
  return filed.items;
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const record = () => {
  const n = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  return {
    documentNo: `HVL11-${n.slice(-8)}-2026`, sro: 'Haveli 11', registeredOn: today(),
    grn: `MH${n.padStart(17, '0').slice(-17)}`, stampDuty: '1100', registrationFee: '1000',
  };
};

// Do not sign webhooks in specs; Cashfree secrets are machine-local.
function settle(requestId) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error(`not a request id: ${requestId}`);
  const out = execFileSync(
    PSQL,
    ['-U', process.env.E2E_DB_USER || 'postgres', '-d', process.env.E2E_DB_NAME || 'draazy_e2e', '-At',
      '-c', `update service_requests set status = 'new' where id = '${requestId}' and status = 'awaiting-payment' returning id`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } },
  );
  if (!out.includes(requestId)) throw new Error(`could not settle ${requestId}`);
}

function markPaid(requestId) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error(`not a request id: ${requestId}`);
  execFileSync(
    PSQL,
    ['-U', process.env.E2E_DB_USER || 'postgres', '-d', process.env.E2E_DB_NAME || 'draazy_e2e', '-At',
      '-c', `update service_requests set payment_ref = 'e2e_order_${requestId}' where id = '${requestId}';`
        + ` insert into service_request_timeline (request_id, event) values ('${requestId}', 'payment.received')`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } },
  );
}

function enteredStatusAgo(requestId, hours) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !Number.isInteger(hours)) throw new Error('bad backdate');
  execFileSync(
    PSQL,
    ['-U', process.env.E2E_DB_USER || 'postgres', '-d', process.env.E2E_DB_NAME || 'draazy_e2e', '-At',
      '-c', `update service_requests set status_changed_at = now() - interval '${hours} hours' where id = '${requestId}'`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } },
  );
}

async function approvedAgreement(holder) {
  const customer = (await apiLogin(uniqueMobile())).accessToken;
  const listing = await ok('POST', '/me/listings', customer, {
    title: '2BHK in Baner', deal: 'rent', propertyType: 'apartment', price: 30000, bhk: 2,
    locality: 'Baner', city: 'Pune', floor: 4,
    images: await uploadedListingPhotos(customer),
  });
  const tenantMobile = uniqueMobile();
  const tenant = (await apiLogin(tenantMobile)).accessToken;
  const request = await ok('POST', '/service-requests/co-fill', customer, {
    request: {
      type: 'rent-agreement',
      propertyId: listing.id,
      details: {
        ownerName: 'Live Check Owner', rent: 30000, deposit: 150000, months: 11,
        _state: {
          tenantMode: 'fill',
          prop: { gramPanchayat: false },
          tenants: [{ name: TENANT_NAME, mobile: tenantMobile }, { name: TYPED_NAME, mobile: uniqueMobile() }],
        },
      },
    },
    role: 'tenant',
    mobile: tenantMobile,
  });
  const [invite] = await ok('GET', '/me/service-request-invites', tenant);
  await ok('POST', `/me/service-request-invites/${invite.id}`, tenant, { decision: 'accept' });
  settle(request.id);

  const admin = (await apiLogin(ACTORS.admin)).accessToken;
  const desk = holder || admin;
  await ok('PATCH', `/service-requests/${request.id}/status`, desk, { status: 'assigned' });
  await fileAndVerify(request.id, desk, { licensor: customer, tenant });
  await ok('POST', `/service-requests/${request.id}/draft`, desk, upload('draft.png', CHECKS));
  await ok('POST', `/service-requests/${request.id}/draft/opened`, customer);
  await ok('POST', `/service-requests/${request.id}/draft/decision`, customer, { decision: 'approve' });
  await ok('POST', `/service-requests/${request.id}/draft/opened`, tenant);
  await ok('POST', `/service-requests/${request.id}/draft/decision`, tenant, { decision: 'approve' });
  const { draftApproval } = await ok('GET', `/service-requests/${request.id}`, customer);
  for (const party of draftApproval.parties.filter((p) => p.method === 'otp' && !p.approved)) {
    await ok('POST', `/service-requests/${request.id}/draft/otp`, customer, { partyKey: party.key });
    await ok('POST', `/service-requests/${request.id}/draft/otp`, customer, { partyKey: party.key, otp: process.env.E2E_OTP_CODE || '000000' });
  }
  const after = await ok('GET', `/service-requests/${request.id}`, customer);
  if (after.status !== 'approved') throw new Error(`not approved (${after.status}): ${JSON.stringify(after.draftApproval)}`);
  return { id: request.id, admin, customer, tenantMobile };
}

async function completedAgreement(holder) {
  const agreement = await approvedAgreement(holder);
  await ok('POST', `/service-requests/${agreement.id}/final-doc`, holder || agreement.admin, upload('registered.png', record()));
  return agreement;
}

async function openRentDesk(page, tab = 'progress') {
  await page.goto(`/admin/rent-agreement?tab=${tab}`);
  await expect(page.getByRole('heading', { name: 'Rent Agreement' })).toBeVisible();
}

async function openCase(page, requestId, tab = 'progress') {
  await openRentDesk(page, tab);
  await page.getByPlaceholder('Name, mobile or request id').fill(requestId);
  await expect(page.getByTestId('ra-row')).toHaveCount(1);
  await page.getByTestId('ra-row').first().click();
  return page.getByRole('dialog');
}

test.describe('Ops → Drafting desk → registration check (live)', () => {
  test('a high-rent draft waits for a second operator before the customer sees it', async () => {
    const customer = (await apiLogin(uniqueMobile())).accessToken;
    const listing = await ok('POST', '/me/listings', customer, {
      title: '3BHK in Aundh', deal: 'rent', propertyType: 'apartment', price: 55000, bhk: 3,
      locality: 'Aundh', city: 'Pune', floor: 7,
      images: await uploadedListingPhotos(customer),
    });
    const request = await ok('POST', '/service-requests', customer, {
      type: 'rent-agreement',
      propertyId: listing.id,
      details: {
        rent: 55000, deposit: 200000, months: 11,
        _state: { prop: { gramPanchayat: false }, owner: { oMobile: uniqueMobile() }, tenants: [{ name: TYPED_NAME, mobile: uniqueMobile() }], terms: { rent: '55000', months: '11' } },
      },
    });
    settle(request.id);
    const holder = (await apiLogin(STAFF.rental)).accessToken;
    const checker = (await apiLogin(ACTORS.admin)).accessToken;
    await ok('PATCH', `/service-requests/${request.id}/status`, holder, { status: 'assigned' });
    await fileAndVerify(request.id, holder, { licensor: customer });
    await ok('POST', `/service-requests/${request.id}/draft`, holder, upload('draft.png', CHECKS));

    const hidden = await ok('GET', `/service-requests/${request.id}`, customer);
    expect(hidden.status).toBe('assigned');
    expect(hidden.documents.filter((doc) => doc.category === 'draft')).toHaveLength(0);
    const holderCheck = await call('POST', `/service-requests/${request.id}/draft/check`, holder, { decision: 'release' });
    expect(holderCheck.status).toBe(403);
    const released = await ok('POST', `/service-requests/${request.id}/draft/check`, checker, { decision: 'release' });
    expect(released.status).toBe('draft-shared');
    expect(released.draftCheck.reasons).toContain('rent_ge_50000');
    const visible = await ok('GET', `/service-requests/${request.id}`, customer);
    expect(visible.documents.some((doc) => doc.category === 'draft')).toBe(true);
  });

  test('a flat that was never listed completes, and prepares no badge rows', async () => {
    const customer = (await apiLogin(uniqueMobile())).accessToken;
    const request = await ok('POST', '/service-requests', customer, {
      type: 'rent-agreement',
      details: { ownerName: 'Unlisted Owner', rent: 18000, deposit: 60000, months: 11, _state: { tenantMode: 'fill', prop: { gramPanchayat: false } } },
    });
    settle(request.id);

    const admin = (await apiLogin(ACTORS.admin)).accessToken;
    await ok('PATCH', `/service-requests/${request.id}/status`, admin, { status: 'assigned' });
    const unchecked = await call('POST', `/service-requests/${request.id}/draft`, admin, upload('draft.png', { checks: ['identity'] }));
    expect(unchecked.status, unchecked.text).toBe(422);
    expect(unchecked.text).toContain('power of attorney checked');
    const unverified = await call('POST', `/service-requests/${request.id}/draft`, admin, upload('draft.png', CHECKS));
    expect(unverified.status, unverified.text).toBe(409);
    expect(unverified.text).toContain('Verify every document before');
    await fileAndVerify(request.id, admin, { licensor: customer });
    await ok('POST', `/service-requests/${request.id}/draft`, admin, upload('draft.png', CHECKS));
    await ok('POST', `/service-requests/${request.id}/draft/opened`, customer);
    await ok('POST', `/service-requests/${request.id}/draft/decision`, customer, { decision: 'approve' });
    const bare = await call('POST', `/service-requests/${request.id}/final-doc`, admin, upload('registered.png'));
    expect(bare.status, bare.text).toBe(422);
    expect(bare.text).toContain('GRAS challan GRN');
    const final = await call('POST', `/service-requests/${request.id}/final-doc`, admin, upload('registered.png', record()));
    expect(final.status, final.text).toBe(201);

    expect((await ok('GET', `/service-requests/${request.id}`, admin)).status).toBe('completed');
    expect(await ok('GET', `/service-requests/${request.id}/rent-agreements`, admin)).toHaveLength(0);
  });
  test('the desk will not complete a rent agreement until the registration record is typed in', async ({ page }) => {
    const staff = (await apiLogin(STAFF.rental)).accessToken;
    const { id } = await approvedAgreement(staff);
    const entry = record();

    await signIn(page, STAFF.rental, { screen: 'staff' });
    const dialog = await openCase(page, id, 'progress');
    await dialog.locator('#service-final-file').setInputFiles({ name: 'registered.png', mimeType: 'image/png', buffer: PNG });
    const submit = dialog.getByRole('button', { name: 'Upload registered copy' });
    await expect(submit).toBeDisabled();

    await dialog.getByLabel('Document number').fill(entry.documentNo);
    await dialog.getByLabel('Sub-Registrar office').fill(entry.sro);
    await dialog.getByLabel('Registration date').fill(entry.registeredOn);
    await dialog.getByLabel('GRAS challan GRN').fill(entry.grn.toLowerCase());
    await dialog.getByLabel('Stamp duty paid (₹)').fill('1');
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Registration fee paid (₹)').fill(entry.registrationFee);
    await submit.click();
    await expect(page.getByRole('alert').filter({ hasText: 'The registered copy was uploaded' })).toBeVisible();

    const shown = dialog.getByRole('region', { name: 'Registration check' }).getByTestId('registration-record');
    await expect(shown).toContainText(entry.documentNo);
    await expect(shown).toContainText(entry.grn);
    await expect(shown.getByRole('note')).toContainText('Stamp duty paid ₹1 differs from');
    await expect(shown.getByRole('note')).not.toContainText('Registration fee');
  });

  test('the desk shows the deed particulars with full mobiles, and will not share a draft until every check is ticked', async ({ page }) => {
    const customer = (await apiLogin(uniqueMobile())).accessToken;
    const request = await ok('POST', '/service-requests', customer, {
      type: 'rent-agreement',
      details: {
        rent: 25000, deposit: 100000, months: 11,
        _state: {
          tenantMode: 'fill',
          prop: { flatNo: 'B-702', society: 'Kumar Park', locality: 'Kothrud', gramPanchayat: false, city: 'Pune', pincode: '411038' },
          owner: { oName: 'Asha Deshpande', oMobile: '9822012345', capacity: 'poa', poaPrincipal: 'Vinod Deshpande', poaRegNo: 'HVL3-889-2024', poaSro: 'Haveli 3', poaDate: '2024-03-15' },
          tenants: [{ name: 'Kiran Rao', mobile: '9922054321' }],
          terms: { rent: '25000', deposit: '100000', months: '11', lockin: '6', notice: '1' },
        },
      },
    });
    settle(request.id);
    const staff = (await apiLogin(STAFF.rental)).accessToken;
    await ok('PATCH', `/service-requests/${request.id}/status`, staff, { status: 'assigned' });
    const papers = await fileAndVerify(request.id, staff, { licensor: customer });
    expect(papers.map((p) => p.id)).toContain('licensor-0-poa');

    await signIn(page, STAFF.rental, { screen: 'staff' });
    const dialog = await openCase(page, request.id, 'progress');

    const section = async (name) => {
      await dialog.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
      return dialog.getByRole('tabpanel');
    };
    await expect(await section('Property')).toContainText('B-702');
    await expect(await section('Terms')).toContainText('6 months');
    await expect(await section('Licensee')).toContainText('9922054321');
    const licensor = await section('Licensor');
    await expect(licensor).toContainText('for Vinod Deshpande, reg. HVL3-889-2024 (Haveli 3, 2024-03-15)');
    await expect(licensor).toContainText('9822012345');

    await dialog.locator('#service-draft-file').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: PNG });
    const share = dialog.getByRole('button', { name: 'Share draft' });
    const boxes = dialog.getByRole('group', { name: 'Before the customer sees it' }).getByRole('checkbox');
    await expect(boxes).toHaveCount(5);
    for (let i = 0; i < 4; i += 1) await boxes.nth(i).check();
    await expect(share).toBeDisabled();
    await boxes.nth(4).check();
    await share.click();
    await expect(page.getByRole('alert').filter({ hasText: 'The draft is waiting for a colleague' })).toBeVisible();
    const held = await ok('GET', `/service-requests/${request.id}`, staff);
    expect(held.draftCheck?.status, 'a POA draft waits for a second operator (D-i)').toBe('pending');
  });

  test('the desk sends a paper back with a reason, the customer re-uploads it, and the new copy is what gets verified', async ({ page, browser }) => {
    const mobile = uniqueMobile();
    const customer = (await apiLogin(mobile)).accessToken;
    const request = await ok('POST', '/service-requests', customer, {
      type: 'rent-agreement',
      details: { ownerName: 'Reupload Owner', rent: 20000, deposit: 60000, months: 11, _state: { tenantMode: 'fill', prop: { gramPanchayat: false } } },
    });
    settle(request.id);
    const staff = (await apiLogin(STAFF.rental)).accessToken;
    await ok('PATCH', `/service-requests/${request.id}/status`, staff, { status: 'assigned' });
    const { items } = await ok('GET', `/service-requests/${request.id}/checklist`, customer);
    for (const item of items) {
      await ok('POST', `/service-requests/${request.id}/docs`, customer, upload(`${item.id}.png`, { category: item.id }));
    }

    await signIn(page, STAFF.rental, { screen: 'staff' });
    const dialog = await openCase(page, request.id, 'progress');
    const papers = dialog.getByRole('region', { name: 'Papers', exact: true });
    const panel = dialog.getByRole('tabpanel');
    const tab = (name) => dialog.getByRole('tab', { name: new RegExp(`^${name}`) });
    await expect(papers).toContainText('7 of 7 received · 0 verified');
    await tab('Licensee').click();
    await panel.getByRole('button', { name: 'Verify Tenant 1 — PAN card' }).click();
    await expect(papers).toContainText('1 verified');
    await tab('Licensor').click();
    await panel.getByRole('button', { name: 'Reject Licensor 1 — PAN card' }).click();
    await panel.getByLabel('Why is Licensor 1 — PAN card rejected?').fill('The PAN number is cut off at the edge');
    await panel.getByRole('button', { name: 'Send back' }).click();
    await expect(panel).toContainText('Sent back: The PAN number is cut off at the edge');
    await expect(papers).toContainText('The draft and the registered copy wait until every paper is verified.');

    const context = await browser.newContext();
    const tenantPage = await context.newPage();
    await signIn(tenantPage, mobile);
    await tenantPage.goto('/services/rent-agreement');
    const redo = tenantPage.getByRole('region', { name: 'Documents to re-upload' });
    await expect(redo).toContainText('Licensor 1 — PAN card');
    await expect(redo).toContainText('The PAN number is cut off at the edge');
    await redo.getByLabel('Upload a new copy of Licensor 1 — PAN card').setInputFiles({ name: 'pan.png', mimeType: 'image/png', buffer: PNG });
    await expect(tenantPage.getByRole('alert').filter({ hasText: 'Licensor 1 — PAN card re-uploaded' })).toBeVisible();
    await expect(redo).toHaveCount(0);
    await context.close();

    await page.reload();
    await openCase(page, request.id, 'progress');
    await expect(panel).not.toContainText('Sent back:');
    await panel.getByRole('button', { name: 'Verify Licensor 1 — PAN card' }).click();
    await expect(papers).toContainText('2 verified');
    const after = await ok('GET', `/service-requests/${request.id}/checklist`, staff);
    expect(after.items.find((i) => i.id === 'licensor-0-pan')).toMatchObject({ review: 'verified' });
  });

  test('an agreement nobody picked up in four hours is overdue on the desk, and taking it restarts the clock', async ({ page }) => {
    const customer = (await apiLogin(uniqueMobile())).accessToken;
    const request = await ok('POST', '/service-requests', customer, {
      type: 'rent-agreement',
      details: { ownerName: 'Slow Pickup Owner', rent: 21000, deposit: 63000, months: 11, _state: { tenantMode: 'fill', prop: { gramPanchayat: false } } },
    });
    settle(request.id);
    enteredStatusAgo(request.id, 5);
    const staff = (await apiLogin(STAFF.rental)).accessToken;
    const overdue = await ok('GET', `/service-requests?overdue=true&q=${request.id}`, staff);
    expect(overdue.content.map((r) => r.id)).toEqual([request.id]);
    expect(overdue.content[0].sla).toMatchObject({ waitingOn: 'desk', overdue: true });

    await signIn(page, STAFF.rental, { screen: 'staff' });
    await openRentDesk(page, 'pickup');
    // A case row is itself a button and its age cue also reads "Overdue by …", so match the chip alone.
    const overdueToggle = page.getByRole('button', { name: /^Overdue( \d+)?$/ });
    await overdueToggle.click();
    await expect(overdueToggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByPlaceholder('Name, mobile or request id').fill(request.id);
    await expect(page.getByTestId('ra-row')).toHaveCount(1);
    await expect(page.getByTestId('ra-row').first().getByTestId('service-request-age-breach')).toHaveText(/Overdue by 1h/);

    await ok('PATCH', `/service-requests/${request.id}/status`, staff, { status: 'assigned' });
    await page.getByRole('tab', { name: /In progress/ }).click();
    await overdueToggle.click();
    await expect(page.getByTestId('ra-row')).toHaveCount(1);
    await expect(page.getByTestId('ra-row').first().getByTestId('service-request-age-fresh')).toHaveText(/Due in 48h/);
    expect((await ok('GET', `/service-requests?overdue=true&q=${request.id}`, staff)).content).toHaveLength(0);
  });

  test('the desk revises the priced terms, and the draft waits until the customer accepts and pays any difference', async ({ page, browser }) => {
    const mobile = uniqueMobile();
    const customer = (await apiLogin(mobile)).accessToken;
    const request = await ok('POST', '/service-requests', customer, {
      type: 'rent-agreement',
      details: { ownerName: 'Revised Terms Owner', rent: 20000, deposit: 60000, months: 11, _state: { tenantMode: 'fill', prop: { gramPanchayat: false } } },
    });
    settle(request.id);
    const staff = (await apiLogin(STAFF.rental)).accessToken;
    await ok('PATCH', `/service-requests/${request.id}/status`, staff, { status: 'assigned' });
    await fileAndVerify(request.id, staff, { licensor: customer });

    await signIn(page, STAFF.rental, { screen: 'staff' });
    const dialog = await openCase(page, request.id, 'progress');
    const terms = dialog.getByRole('region', { name: 'Priced terms' });
    await terms.getByRole('button', { name: 'Revise priced terms' }).click();
    await expect(terms.getByLabel('Monthly rent')).toHaveValue('20000');
    await terms.getByLabel('Monthly rent').fill('25000');
    await terms.getByLabel(/Why the terms change/).fill('The owner confirmed the rent is 25,000');
    await terms.getByRole('button', { name: 'Send to customer' }).click();
    const pending = terms.getByTestId('amendment-open');
    await expect(pending).toContainText('Monthly rent: ₹20,000 → ₹25,000');
    await expect(pending).toContainText(/pays ₹[\d,]+ more before the draft can be shared/);

    const raised = (await ok('GET', `/service-requests/${request.id}`, customer)).amendment;
    expect(raised.delta).toBeGreaterThan(0);
    expect((await call('POST', `/service-requests/${request.id}/draft`, staff, upload('draft.png', CHECKS))).status).toBe(409);

    const context = await browser.newContext();
    const customerPage = await context.newPage();
    await signIn(customerPage, mobile);
    await customerPage.goto('/services/rent-agreement');
    const revised = customerPage.getByRole('region', { name: 'Revised terms' });
    await expect(revised).toContainText('The owner confirmed the rent is 25,000');
    await revised.getByRole('button', { name: /^Pay ₹[\d,]+ and accept$/ }).click();
    await expect(customerPage.getByRole('alert').filter({ hasText: 'as soon as the payment is confirmed' })).toBeVisible();
    expect((await ok('GET', `/service-requests/${request.id}`, customer)).amendment).toMatchObject({ checkoutOpen: true });

    await terms.getByRole('button', { name: 'Withdraw revised terms' }).click();
    await expect(pending).toHaveCount(0);

    await ok('POST', `/service-requests/${request.id}/amendments`, staff, { rent: 15000, reason: 'The owner agreed to 15,000' });
    await customerPage.reload();
    await expect(revised).toContainText('nothing more to pay');
    await revised.getByRole('button', { name: 'Accept revised terms' }).click();
    await expect(revised).toHaveCount(0);
    await context.close();

    const applied = await ok('GET', `/service-requests/${request.id}`, staff);
    expect(applied.amendment).toBeNull();
    expect(applied.details.rent).toBe(15000);
    expect(applied.amount).toBe(request.amount);
    await ok('POST', `/service-requests/${request.id}/draft`, staff, upload('draft.png', CHECKS));
  });

  test('a refund the holder asks for waits for a colleague, and after the duty only the service fee goes back', async ({ page }) => {
    const customer = (await apiLogin(uniqueMobile())).accessToken;
    const request = await ok('POST', '/service-requests', customer, {
      type: 'rent-agreement',
      details: { ownerName: 'Refund Owner', rent: 20000, deposit: 60000, months: 11, _state: { tenantMode: 'fill', prop: { gramPanchayat: false } } },
    });
    settle(request.id);
    markPaid(request.id);
    const staff = (await apiLogin(STAFF.rental)).accessToken;
    const admin = (await apiLogin(ACTORS.admin)).accessToken;
    await ok('PATCH', `/service-requests/${request.id}/status`, staff, { status: 'assigned' });
    const before = await ok('GET', `/service-requests/${request.id}/refunds`, staff);
    expect(before).toMatchObject({ paid: request.amount, refunded: 0, refundableBeforeDuty: request.amount, dutyPaidOnRecord: false });
    expect(before.refundableAfterDuty).toBeLessThan(request.amount);
    const overCeiling = await call('POST', `/service-requests/${request.id}/refunds`, staff,
      { amount: before.refundableAfterDuty + 1, dutyPaid: true, grn: record().grn, reason: 'Duty already paid' });
    expect(overCeiling.status).toBe(422);

    await signIn(page, STAFF.rental, { screen: 'staff' });
    const dialog = await openCase(page, request.id, 'progress');
    const refunds = dialog.getByRole('region', { name: 'Refunds' });
    await expect(refunds.getByTestId('refund-figures')).toContainText('can go back');
    await refunds.getByRole('button', { name: 'Ask for a refund' }).click();
    await refunds.getByLabel(/^Amount, up to/).fill(String(request.amount));
    await refunds.getByLabel('Why the money goes back').fill('The owner sold the flat before drafting');
    await refunds.getByRole('button', { name: 'Ask for approval' }).click();
    const open = refunds.getByTestId('refund-open');
    await expect(open).toContainText('You asked for it, so a colleague has to approve it.');
    await expect(open.getByRole('button', { name: 'Approve and refund' })).toHaveCount(0);

    const [asked] = (await ok('GET', `/service-requests/${request.id}/refunds`, staff)).refunds;
    expect((await call('POST', `/service-requests/${request.id}/refunds/${asked.id}/approve`, staff)).status).toBe(403);
    const approved = await ok('POST', `/service-requests/${request.id}/refunds/${asked.id}/approve`, admin);
    expect(approved).toMatchObject({ refunded: request.amount, refundableBeforeDuty: 0 });
    expect(approved.refunds[0]).toMatchObject({ status: 'approved', gatewayRefundId: expect.any(String) });
    const timeline = (await ok('GET', `/service-requests/${request.id}`, staff)).timeline.map((t) => t.event);
    expect(timeline).toContain('refund.approved');
    expect((await call('GET', `/service-requests/${request.id}/refunds`, customer)).status).toBe(403);
  });

  test('the desk sees another agreement on the same flat, and a licensor named differently', async ({ page }) => {
    const first = (await apiLogin(uniqueMobile())).accessToken;
    const listing = await ok('POST', '/me/listings', first, {
      title: '1BHK in Aundh', deal: 'rent', propertyType: 'apartment', price: 20000, bhk: 1,
      locality: 'Aundh', city: 'Pune', floor: 2,
      images: await uploadedListingPhotos(first),
    });
    const raise = async (token, licensor, startDate) => {
      const request = await ok('POST', '/service-requests', token, {
        type: 'rent-agreement', propertyId: listing.id,
        details: { rent: 20000, deposit: 60000, months: 11, startDate, _state: { tenantMode: 'fill', prop: { gramPanchayat: false }, owner: { oName: licensor } } },
      });
      settle(request.id);
      return request.id;
    };
    const earlier = await raise(first, 'Asha Deshpande', '2026-04-01');
    const current = await raise((await apiLogin(uniqueMobile())).accessToken, 'Rohan Patil', '2026-10-01');

    await signIn(page, STAFF.rental, { screen: 'staff' });
    const dialog = await openCase(page, current, 'pickup');
    const panel = dialog.getByRole('region', { name: 'Overlap check' });
    await expect(panel).toContainText('Another agreement covers this flat');
    await expect(panel).toContainText(earlier.slice(0, 8));
    await expect(panel).toContainText('2026-04-01 → 2027-03-01');
    await expect(panel).toContainText('Licensor named differently there: Asha Deshpande');
  });

  test('the uploader cannot confirm their own registered copy, and the customer cannot add one', async () => {
    const { id, admin, customer } = await completedAgreement();

    const rows = await ok('GET', `/service-requests/${id}/rent-agreements`, admin);
    expect(rows).toHaveLength(2);
    const byName = Object.fromEntries(rows.map((r) => [r.tenantName, r]));
    expect(byName[TENANT_NAME]).toMatchObject({ status: 'draft', preparedByYou: true, otpVerified: true });
    expect(byName[TYPED_NAME]).toMatchObject({ status: 'draft', otpVerified: false });

    const refused = await call('PATCH', `/admin/rent-agreements/${byName[TENANT_NAME].id}`, admin, { status: 'registered' });
    expect(refused.status, refused.text).toBe(403);

    const planted = new FormData();
    planted.append('category', 'final-document');
    planted.append('file', new Blob([PNG], { type: 'image/png' }), 'forged.png');
    expect((await call('POST', `/service-requests/${id}/docs`, customer, planted)).status).toBe(409);
  });

  test('a second operator confirms the tenancy from the desk, seeing the full mobile', async ({ page }) => {
    const { id, admin, tenantMobile } = await completedAgreement();

    await signIn(page, STAFF.rental, { screen: 'staff' });
    const dialog = await openCase(page, id, 'closed');

    const panel = dialog.getByRole('region', { name: 'Registration check' });
    await expect(panel.getByText(TENANT_NAME)).toBeVisible();
    await expect(panel.getByText('Awaiting check')).toHaveCount(2);
    await expect(panel).toContainText(tenantMobile);
    await expect(panel.getByRole('button', { name: 'Open the registered copy' })).toBeVisible();

    await panel.getByRole('button', { name: `Confirm ${TENANT_NAME} registered` }).click();
    await expect(panel.getByText('Registered', { exact: true })).toBeVisible();
    await expect(panel).toContainText('checked by');
    await expect(panel.getByRole('button', { name: `Confirm ${TENANT_NAME} registered` })).toHaveCount(0);

    // A number only typed on the form proves nobody holds it: it can be ruled out, never confirmed.
    await expect(panel.getByText(/typed on the form and never confirmed/)).toBeVisible();
    await expect(panel.getByRole('button', { name: `Confirm ${TYPED_NAME} registered` })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: `${TYPED_NAME} is not on the copy` })).toBeVisible();

    const rows = await ok('GET', `/service-requests/${id}/rent-agreements`, admin);
    const row = rows.find((r) => r.tenantName === TENANT_NAME);
    const typed = rows.find((r) => r.tenantName === TYPED_NAME);
    expect(row.status).toBe('registered');
    expect(row.verifiedBy).toBeTruthy();
    const checker = (await apiLogin(STAFF.rental)).accessToken;
    const forced = await call('PATCH', `/admin/rent-agreements/${typed.id}`, checker, { status: 'registered' });
    expect(forced.status, forced.text).toBe(422);
  });

  test('staff records police intimation confirmation and the customer read turns done', async ({ page }) => {
    const { id, customer } = await completedAgreement((await apiLogin(STAFF.rental)).accessToken);

    await signIn(page, STAFF.rental, { screen: 'staff' });
    const dialog = await openCase(page, id, 'closed');
    const panel = dialog.getByRole('region', { name: 'Police intimation' });
    await expect(panel).toContainText('Pending');
    await panel.getByLabel('Reference / acknowledgement no.').fill('PCMC-LIVE-42');
    await panel.getByLabel('Submission date').fill(today());
    await panel.getByRole('button', { name: 'Owner confirmed they submitted it' }).click();
    await expect(panel).toContainText('Confirmed');

    const read = await ok('GET', `/service-requests/${id}`, customer);
    expect(read.policeIntimation).toMatchObject({ confirmed: true, reference: 'PCMC-LIVE-42', submittedOn: today() });
    expect(read.timeline.map((entry) => entry.event)).toContain('police-intimation.confirmed');
  });

  test('confirming needs the Rent Agreement desk, not a maker\'s services:write held through another desk', async ({ page }) => {
    const { id, admin } = await completedAgreement();
    const staff = (await apiLogin(STAFF.rental)).accessToken;
    const me = await ok('GET', '/auth/me', staff);
    const scope = (functions) => ok('PUT', `/users/${me.id}/permissions`, admin, { functions });
    // The registration-check atom now ships inside `desk:rental`, so dropping that desk is how it is withheld.
    await scope(BASELINE_STAFF.filter((fn) => fn !== 'desk:rental'));
    try {
      const rows = await ok('GET', `/service-requests/${id}/rent-agreements`, admin);
      const row = rows.find((r) => r.tenantName === TENANT_NAME);
      const refused = await call('PATCH', `/admin/rent-agreements/${row.id}`, staff, { status: 'registered' });
      expect(refused.status, refused.text).toBe(403);

      await signIn(page, STAFF.rental, { screen: 'staff' });
      await page.goto('/staff/rent-agreement');
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page.getByRole('heading', { name: 'Rent Agreement' })).toHaveCount(0);
    } finally {
      await scope(BASELINE_STAFF);
    }

    const after = await ok('GET', `/service-requests/${id}/rent-agreements`, admin);
    expect(after.find((r) => r.tenantName === TENANT_NAME).status).not.toBe('registered');
  });
});
