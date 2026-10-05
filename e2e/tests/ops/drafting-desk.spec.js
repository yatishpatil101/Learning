// Live drafting-desk checks cover behaviour the mock desks could not prove.
import { execFileSync } from 'node:child_process';
import { test, expect, ACTORS, MOBILE, STAFF } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders, signIn, signedInAsNew, uniqueMobile } from '../../helpers/liveAuth.js';

const DOCUMENT = {
  name: 'agreement.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
};

// The seeded staffer must match the request type because desks are team-scoped.
const CUSTOMER = { mobile: '9708919481', name: 'Omkar Kulkarni' };
const STAFFER = { mobile: '9383334640', name: 'Karan Chavan' };

// Values only this spec writes, so an assertion that finds one has found *our* row and not a coincidence.
const OWNER_PAN = 'ZZZQA1234Z';
const OWNER_AADHAAR = '999988887779';

const panRow = (dialog) => dialog.getByText('PAN', { exact: true });

const UNASSIGNED_REFUSAL = /not assigned to anyone yet/;
const PSQL = process.env.PSQL || 'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe';

// Create one rental request as the customer and record the owner's identity numbers on it.
async function seedRequest({ withProperty = false } = {}) {
  // A *fresh* raiser per request, not the seeded CUSTOMER.
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };
  const property = `Live spec flat ${mobile.slice(0, 5)}-${mobile.slice(5)}`;
  let propertyId;
  if (withProperty) {
    const res = await fetch(`${API}/properties?size=1`);
    const body = await res.json();
    propertyId = body.content?.[0]?.id;
    if (res.status !== 200 || !propertyId) {
      throw new Error(`property fixture failed (${res.status}): ${JSON.stringify(body)}`);
    }
  }

    // One matter of his own, so "he cannot see theirs" is scoping and not an empty list.
  const created = await fetch(`${API}/service-requests`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      // Use a known type because unknown service types can bypass exact-match pricing.
      type: 'valuation',
      propertyId,
      details: { ownerName: 'Live Desk Owner', property, purpose: 'Live spec valuation' },
    }),
  });
  const dto = await created.json();
  if (created.status >= 300) throw new Error(`create failed (${created.status}): ${JSON.stringify(dto)}`);

  const put = await fetch(`${API}/service-requests/${dto.id}/identities`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({
      parties: [
        { partyRole: 'owner', partyIndex: 0, partyName: 'Live Desk Owner', pan: OWNER_PAN, aadhaar: OWNER_AADHAAR },
      ],
    }),
  });
  if (put.status >= 300) throw new Error(`identities failed (${put.status}): ${await put.text()}`);

  return { ...dto, auth, property };
}

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

async function seedRentAgreement() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };
  const request = await fetch(`${API}/service-requests`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      type: 'rent-agreement',
      details: {
        ownerName: 'Queue Count Owner', rent: 24000, deposit: 72000, months: 11,
        _state: {
          prop: { flatNo: 'B-1201', society: 'Queue Count Heights', locality: 'Baner' },
          owner: { oName: 'Queue Count Owner' },
          tenants: [{ name: 'Queue Count Tenant', mobile: uniqueMobile() }],
          terms: { rent: '24000', deposit: '72000', months: '11' },
        },
      },
    }),
  });
  const dto = await request.json();
  if (request.status >= 300) throw new Error(`rent agreement create failed (${request.status}): ${JSON.stringify(dto)}`);
  settle(dto.id);
  return dto;
}

async function countFor(page, key) {
  const text = await page.getByTestId(`ra-count-${key}`).innerText();
  return Number(text.replace(/,/g, ''));
}

// Sign the valuation staffer in through the real `/staff-login` OTP flow and open the desk.
async function openDesk(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });

  await signIn(page, STAFFER.mobile, { screen: 'staff' });

  await page.goto('/admin/valuation');
  await expect(page.getByRole('heading', { name: 'Property Valuation', level: 1 })).toBeVisible();
  // The gate this screen now has: in live mode it must render the queue, not the offline panel.
  await expect(page.getByText(/needs the live API/i)).toHaveCount(0);
}

// The row for the matter this spec created — matched on its own property string, not on position.
const ourRow = (page) => page.getByTestId('queue-row').filter({ hasText: 'Live spec flat' }).first();
const rowFor = (page, property) => page.getByTestId('queue-row').filter({ hasText: property }).first();
const openRow = (row) => row.getByRole('button', { name: 'Open', exact: true }).click();
const showTab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();

test.describe('Ops → Drafting desk (live)', () => {
  test.beforeEach(async () => { await seedRequest(); });

  test('the desk lists the server queue with its filters, the age cue, and no identity number or mobile in it', async ({ page }) => {
    test.slow();
    await openDesk(page);
    await test.step('the desk lists the server queue with its filters', async () => {

      await expect(page.getByLabel('Filter by desk')).toHaveCount(0);
      await expect(page.getByRole('tab', { name: /^To pick up/ })).toHaveAttribute('aria-selected', 'true');
      for (const name of ['My requests', 'In progress', 'With customer', 'Closed']) {
        await expect(page.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeVisible();
      }
      await expect(page.getByPlaceholder('Name, mobile or request id')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Overdue/ })).toBeVisible();
      await expect(ourRow(page)).toBeVisible();
    });
    await test.step('a fresh request has the opened-age cue', async () => {
      await expect(ourRow(page).getByTestId('service-request-age-fresh')).toBeVisible();
    });
    await test.step('the queue itself never carries an identity number or a mobile', async () => {
      await expect(ourRow(page)).toBeVisible();

      const table = await page.getByRole('tabpanel').innerText();
      const tableWithoutUuids = table.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '');
      expect(tableWithoutUuids).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);
      expect(tableWithoutUuids).not.toMatch(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
      expect(tableWithoutUuids).not.toMatch(MOBILE);
    });
    await test.step('a desk can search its queue', async () => {
      await page.getByPlaceholder('Name, mobile or request id').fill('Live Desk Owner');
      await expect(ourRow(page)).toBeVisible();
      await page.getByPlaceholder('Name, mobile or request id').fill('no such request zz');
      await expect(page.getByText('No requests match these filters.')).toBeVisible();
    });
  });

  test('a staffer cannot silently take a colleague\'s request', async ({ page }) => {
    const request = await seedRequest();
    const colleague = await apiLogin(STAFF.valuation);
    const taken = await fetch(`${API}/service-requests/${request.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${colleague.accessToken}` },
      body: JSON.stringify({ status: 'assigned' }),
    });
    expect(taken.status, await taken.text()).toBe(200);

    await openDesk(page);
    await showTab(page, 'In progress');
    await openRow(rowFor(page, request.property));
    await page.getByRole('dialog').getByRole('button', { name: 'Take this request' }).click();

    await expect(page.getByRole('alert')).toContainText('Meera Iyer is already working this request');
  });

  test('only the operator holding a matter can share its draft', async () => {
    const request = await seedRequest({ withProperty: true });
    const holder = await apiLogin(STAFF.valuation);
    const bystander = await apiLogin(STAFFER.mobile);
    const as = (token) => ({ authorization: `Bearer ${token}` });
    const took = await fetch(`${API}/service-requests/${request.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...as(holder.accessToken) },
      body: JSON.stringify({ status: 'assigned' }),
    });
    expect(took.status, await took.text()).toBe(200);
    const share = (token) => {
      const form = new FormData();
      form.set('file', new Blob([DOCUMENT.buffer], { type: DOCUMENT.mimeType }), DOCUMENT.name);
      return fetch(`${API}/service-requests/${request.id}/draft`, { method: 'POST', headers: as(token), body: form });
    };

    const refused = await share(bystander.accessToken);
    expect(refused.status).toBe(409);
    expect((await refused.json()).message).toContain('Meera Iyer');
    const shared = await share(holder.accessToken);
    expect(shared.status, await shared.text()).toBe(200);
  });

  test('the desk shares a draft, records its note, and uploads the registered copy after approval', async ({ page }) => {
    const request = await seedRequest({ withProperty: true });
    const note = 'Draft checked against the submitted ownership proof.';

    await openDesk(page);
    await openRow(rowFor(page, request.property));
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Take this request' }).click();
    await expect(page.getByRole('alert')).toContainText('This request is now yours');

    await dialog.getByRole('button', { name: 'Internal note (optional)' }).click();
    await dialog.getByPlaceholder('Add a note for the team... (visible only to admins/staff)').fill(note);
    await dialog.locator('#service-draft-file').setInputFiles(DOCUMENT);
    await dialog.getByRole('button', { name: 'Share draft' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The draft was shared with the customer' })).toBeVisible();

    const opened = await fetch(`${API}/service-requests/${request.id}/draft/opened`, {
      method: 'POST',
      headers: request.auth,
    });
    expect(opened.status).toBe(204);
    const approved = await fetch(`${API}/service-requests/${request.id}/draft/decision`, {
      method: 'POST',
      headers: request.auth,
      body: JSON.stringify({ decision: 'approve' }),
    });
    const approval = await approved.json();
    expect(approved.status, JSON.stringify(approval)).toBe(200);
    expect(approval.status).toBe('approved');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Property Valuation', level: 1 })).toBeVisible();
    await showTab(page, 'My requests');
    await openRow(rowFor(page, request.property));
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '1 previous note' }).click();
    await expect(dialog.getByText(note)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /agreement\.jpg\s*Draft/ })).toBeVisible();

    await dialog.locator('#service-final-file').setInputFiles(DOCUMENT);
    await expect(dialog.getByLabel('GRAS challan GRN')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Upload registered copy' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The registered copy was uploaded' })).toBeVisible();
    await expect(dialog.getByText('completed', { exact: true })).toBeVisible();
  });

  test('staff can reply and must explain a cancellation to the customer', async ({ page }) => {
    const request = await seedRequest();
    const reason = 'The valuation address could not be verified.';
    await openDesk(page);
    await openRow(rowFor(page, request.property));

    const dialog = page.getByRole('dialog').first();
    await dialog.getByLabel('Reply to customer').fill('Please call the desk before 5pm.');
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog.getByText('Please call the desk before 5pm.')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel request' }).click();
    const cancellation = page.getByRole('dialog').filter({ hasText: 'Reason for cancellation' });
    await expect(cancellation.getByRole('button', { name: 'Cancel and notify' })).toBeDisabled();
    await cancellation.getByLabel('Reason for cancellation').fill(reason);
    await cancellation.getByRole('button', { name: 'Cancel and notify' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'customer was notified' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);

    // Read back as the customer: the reason must reach their thread and their inbox, not only audit_log.
    const mine = await (await fetch(`${API}/service-requests/${request.id}`, { headers: request.auth })).json();
    expect(mine.status).toBe('cancelled');
    expect((mine.messages || []).map((m) => m.body)).toContain(reason);
    const inbox = await (await fetch(`${API}/notifications?size=100`, { headers: request.auth })).json();
    expect((inbox.content || []).some((n) => n.type === 'service.cancelled' && String(n.body).includes(reason))).toBe(true);
  });

  test("a matter's drawer: named fields, paperwork, the refused reveal, taking and revealing, and a disclosure that dies with the drawer", async ({ page }) => {
    test.slow();
    const request = await seedRequest();
    const ours = () => rowFor(page, request.property);
    await openDesk(page);
    await test.step('the request summary shows named fields only, never the raw details object', async () => {
      await openRow(ours());

      const dialog = page.getByRole('dialog');
      // Match the whole `dt` so headings cannot satisfy detail-row labels.
      await expect(dialog.getByText('Property', { exact: true })).toBeVisible();

      const body = await dialog.innerText();
      expect(body).not.toMatch(/_state/);
      expect(body).not.toMatch(MOBILE);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    await test.step('a matter names the paperwork it is waiting for', async () => {
      // Only read-side document review returns; the server folds it from vault documents.
      await openRow(ours());

      const drawer = page.getByRole('dialog');
      // Seeded over HTTP with no uploads, so every item is outstanding — and the count is the
      // server's own, off the envelope, not a tally this screen made up.
      await expect(drawer.getByText('0 of 5 received')).toBeVisible();
      for (const item of [
        'Owner Aadhaar + PAN',
        'Tenant Aadhaar + PAN',
        'Ownership proof (Index II / tax receipt)',
        'Passport photos (all parties)',
        'Latest electricity bill',
      ]) {
        await expect(drawer.getByText(item, { exact: true })).toBeVisible();
      }

      await expect(drawer.getByText(/the customer.s to upload/i)).toBeVisible();
      await expect(drawer.getByRole('button', { name: /^(verify|reject) /i })).toHaveCount(0);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    await test.step("an unassigned request refuses the reveal, in the server's own words", async () => {
      await openRow(ours());

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Held by nobody')).toBeVisible();

      await dialog.getByRole('button', { name: 'Reveal' }).click();

      // The refusal is rendered, not swallowed — and it says which move unblocks it.
      await expect(dialog.getByText(UNASSIGNED_REFUSAL)).toBeVisible();
      await expect(panRow(dialog)).toHaveCount(0);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    await test.step('taking the request unlocks the reveal, and Hide puts it away again', async () => {
      await openRow(ours());

      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Take this request' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'This request is now yours' })).toBeVisible();

      await dialog.getByRole('button', { name: 'Reveal' }).click();

      // The number that comes back is one only a round trip through Postgres can produce.
      await expect(panRow(dialog).first()).toBeVisible();
      await expect(dialog.getByText(OWNER_PAN)).toBeVisible();
      await expect(dialog.getByText(/Every attempt is recorded against your name/)).toBeVisible();
      await expect(dialog.getByText(UNASSIGNED_REFUSAL)).toHaveCount(0);

      // Hide clears it from the view (and from component state — there is nowhere else it lives).
      await dialog.getByRole('button', { name: 'Hide' }).click();
      await expect(panRow(dialog)).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Reveal' })).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    await test.step('a disclosure does not survive closing the matter, and never reaches the URL', async () => {
      // The request was taken in the step above, so Reveal is open to this operator.
      await showTab(page, 'My requests');
      await openRow(ours());

      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Reveal' }).click();
      await expect(panRow(dialog).first()).toBeVisible();

      // The open request's id is not a route param, so nothing identifying is in history.
      await expect(page).toHaveURL(/\/staff\/valuation\?tab=mine$/);

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      await openRow(ours());
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(panRow(page.getByRole('dialog'))).toHaveCount(0);
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Reveal' })).toBeVisible();
    });
  });

  test('the API answers a customer with his own matters rather than the queue', async ({ page }) => {
    // The adversarial row: a matter raised by somebody else, sitting in the valuation queue.
    const theirs = await seedRequest();

    const customer = await signedInAsNew(page);

    const created = await fetch(`${API}/service-requests`, {
      method: 'POST',
      headers: await authHeaders(customer),
      body: JSON.stringify({
        type: 'valuation',
        details: { ownerName: 'Live Guard Customer', property: 'Live guard flat, Baner', purpose: 'Live spec guard' },
      }),
    });
    const mine = await created.json();
    expect(created.status, JSON.stringify(mine)).toBe(201);

    const listFor = async (mobile) => {
      const res = await fetch(`${API}/service-requests?size=100`, { headers: await authHeaders(mobile) });
      const body = await res.json();
      return { status: res.status, ids: (body.content || []).map((row) => row.id) };
    };

    // The positive anchor: without it, an endpoint broken for everybody would satisfy the absences.
    const desk = await listFor(STAFFER.mobile);
    expect(desk.status, JSON.stringify(desk)).toBe(200);
    expect(desk.ids).toContain(theirs.id);

    const his = await listFor(customer);
    expect(his.status, JSON.stringify(his)).toBe(200);
    expect(his.ids).toContain(mine.id);
    expect(his.ids).not.toContain(theirs.id);
  });

  test('rent-agreement pickup counts, modal persistence, and desk sidebar gating', async ({ page, browser, login }) => {
    const request = await seedRentAgreement();
    await login.scopeStaff('legal', ['desk:legal']);

    await login.asStaff('rental');
    await page.goto('/admin/rent-agreement?tab=pickup');
    await expect(page.getByRole('heading', { name: 'Rent Agreement', level: 1 })).toBeVisible();
    await expect(page.getByTestId('ra-count-pickup')).toBeVisible();
    await expect(page.getByTestId('ra-count-mine')).toBeVisible();

    const pickupBefore = await countFor(page, 'pickup');
    const mineBefore = await countFor(page, 'mine');
    await page.getByPlaceholder('Name, mobile or request id').fill(request.id);
    await expect(page.getByTestId('ra-row')).toHaveCount(1);
    await page.getByTestId('ra-row').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('list', { name: 'Case stages' })).toBeVisible();
    await expect(dialog.getByTestId('ra-next-step')).toBeVisible();
    await dialog.getByRole('button', { name: 'Take case' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('You', { exact: true })).toBeVisible();
    await expect.poll(() => countFor(page, 'pickup')).toBeLessThan(pickupBefore);
    await expect.poll(() => countFor(page, 'mine')).toBeGreaterThan(mineBefore);

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('tab', { name: /My cases/ }).click();
    await expect(page).toHaveURL(/tab=mine/);
    await expect(page.getByTestId('ra-row')).toHaveCount(1);

    const context = await browser.newContext();
    const legalPage = await context.newPage();
    try {
      await signIn(legalPage, STAFF.legal, { screen: 'staff' });
      await legalPage.goto('/admin');
      await expect(legalPage.getByRole('link', { name: 'Property & Legal', exact: true })).toBeVisible();
      await expect(legalPage.getByRole('link', { name: 'Rent Agreement', exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('retired /ops bookmarks land on the staffer\'s own desk page, and the administrator on the matching desk page, or the console', async ({ page, browser }) => {
    const legalContext = await browser.newContext();
    try {
      const legalPage = await legalContext.newPage();
      await signIn(legalPage, STAFF.legal, { screen: 'staff' });

      await legalPage.goto('/ops/drafting-desk?type=legal');
      await expect(legalPage).toHaveURL(/\/staff\/legal$/);
      await expect(legalPage.getByRole('heading', { name: 'Property & Legal', level: 1 })).toBeVisible();
      await expect(legalPage.getByLabel('Filter by desk')).toHaveCount(0);

      await legalPage.goto('/ops/drafting-desk');
      await expect(legalPage).toHaveURL(/\/staff$/);
    } finally {
      await legalContext.close();
    }

    await signIn(page, ACTORS.admin, { screen: 'staff', role: /Administrator/ });

    await page.goto('/ops/drafting-desk?type=legal');
    await expect(page).toHaveURL(/\/admin\/legal$/);
    await expect(page.getByRole('heading', { name: 'Property & Legal', level: 1 })).toBeVisible();

    await page.goto('/ops/drafting-desk');
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto('/ops/rent-agreement');
    await expect(page).toHaveURL(/\/admin\/rent-agreement$/);
    await expect(page.getByRole('heading', { name: 'Rent Agreement', level: 1 })).toBeVisible();
  });
});
