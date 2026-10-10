// @ts-check
import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { AADHAAR, SOCIETY_PLACEHOLDER, active, clickNext, fillOwner, fillProperty, fillTenantPolice, fillTerms, fillWitnesses, inviteOwner, inviteTenant, uploadAll } from '../../../helpers/rentAgreementWizard.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
// Co-fill must be live: it spans two accounts and browser contexts.
const BASE = process.env.BASE_URL || 'http://localhost:5173';

const authed = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
/** The invitations the server considers addressed to this account. */
async function invitesFor(token) {
  const res = await fetch(`${API}/me/service-request-invites`, { headers: authed(token) });
  expect(res.status, 'an account can always read its own invite list').toBe(200);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}
/* This account's own inbox, read over the API rather than through the bell: the claim is that the
   *server* raised the row, and the page would put `notificationMapper` between it and the fact. */
async function notificationsFor(token) {
  const res = await fetch(`${API}/notifications?size=100`, { headers: authed(token) });
  expect(res.status, 'an account can always read its own inbox').toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.content), 'the notification contract returns a page envelope').toBe(true);
  return body.content;
}
/* File a co-fill request the way the wizard does, without driving it. `type` is the wire value
   `rent-agreement`, not the client's `rental`, so the wire vocabulary is spelled out, not assumed. */

async function coFillOverHttp(ownerToken, inviteeMobile) {
  const res = await fetch(`${API}/service-requests/co-fill`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      request: {
        type: 'rent-agreement',
        details: { ownerName: 'Anita Verma', property: 'B-1204, Skyline Heights', rent: '30000', _state: { prop: { gramPanchayat: false } } },
      },
      role: 'tenant',
      mobile: inviteeMobile,
    }),
  });
  expect(res.status, 'the server accepted the co-fill request').toBe(201);
  const body = await res.json();
  const party = (body.parties || [])[0];
  expect(party?.id, 'the co-fill create returned the invited party').toBeTruthy();
  return { requestId: body.id, partyId: party.id, party };
}

const inviteUrl = ({ partyId, requestId }) =>
  `${BASE}/services/rent-agreement?party=${encodeURIComponent(partyId)}&request=${encodeURIComponent(requestId)}`;

test.describe('Rent Agreement co-fill — the invite the server addresses', () => {
  test('the requester can address two tenant rows as separate invitations', async () => {
    const tenantOne = uniqueMobile();
    const tenantTwo = uniqueMobile();
    const { accessToken: tenantOneToken } = await apiLogin(tenantOne, { api: API });
    const { accessToken: tenantTwoToken } = await apiLogin(tenantTwo, { api: API });
    const { accessToken: ownerToken } = await apiLogin(uniqueMobile(), { api: API });

    const created = await fetch(`${API}/service-requests/co-fill`, {
      method: 'POST',
      headers: authed(ownerToken),
      body: JSON.stringify({
        request: {
          type: 'rent-agreement',
          details: {
            ownerName: 'Anita Verma',
            rent: '30000',
            _state: { tenantMode: 'invite', prop: { gramPanchayat: false }, tenants: [{ name: 'Ria', mobile: tenantOne }, { name: 'Sam', mobile: tenantTwo }] },
          },
        },
        role: 'tenant',
        mobile: tenantOne,
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();

    const second = await fetch(`${API}/service-requests/${body.id}/parties`, {
      method: 'POST',
      headers: authed(ownerToken),
      body: JSON.stringify({ role: 'tenant', partyIndex: 1, mobile: tenantTwo }),
    });
    expect(second.status, 'a second tenant row can be invited separately').toBe(201);

    const firstInvite = (await invitesFor(tenantOneToken)).find((row) => row.requestId === body.id);
    const secondInvite = (await invitesFor(tenantTwoToken)).find((row) => row.requestId === body.id);
    expect(firstInvite?.partyIndex).toBe(0);
    expect(secondInvite?.partyIndex).toBe(1);
  });

  test('the owner\'s invite becomes a row the SERVER addressed to the tenant\'s account, and the tenant opens it from a different browser with only their own section editable', async ({ page, browser }) => {
    /* Two actors, a full wizard run and a second browser context. */
    test.slow();

    const tenantMobile = uniqueMobile();
    const { accessToken: tenantToken } = await apiLogin(tenantMobile, { api: API });

    const before = new Set((await invitesFor(tenantToken)).map((r) => r.id));

    await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page);
    await inviteTenant(page, tenantMobile);
    await fillTerms(page);
    await fillWitnesses(page);

    const review = active(page);
    await review.getByRole('checkbox').check();
    /* Armed before the click: a wizard that swaps in a confirmation panel looks identical whether
       the POST was accepted, refused, or never sent. */

    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/co-fill$/.test(new URL(r.url()).pathname),
    );
    await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();

    const res = await created;
    expect(res.status(), 'the server accepted the co-fill request').toBe(201);
    const body = await res.json();
    const party = (body.parties || []).find((p) => p?.role === 'tenant') || (body.parties || [])[0];
    expect(party?.id, 'the server recorded the invited party').toBeTruthy();
    expect(body.status, 'a co-fill request parks unpaid, like any rent agreement').toBe('awaiting-payment');
    /* THE claim: the invitation is readable by the tenant's own account, from outside this
       browser entirely. The mock could only ever re-read the key it had just written. */

    const after = await invitesFor(tenantToken);
    const fresh = after.filter((r) => !before.has(r.id));
    expect(fresh.length, 'exactly one new invitation reached the tenant account').toBe(1);
    expect(fresh[0].requestId, 'and it points at the request the owner just filed').toBe(body.id);
    expect(fresh[0].role).toBe('tenant');
    expect(fresh[0].requestType).toBe('rent-agreement');
    /* `pending: false` — the server found an account for that number. This is the fact behind the
       copy assertion below, so both halves are pinned. */

    expect(fresh[0].pending, 'the tenant already has an account, so nothing is pending signup').toBe(false);
    await expect(
      page.getByText('Waiting for them to open the invite'),
      'the owner is told they are waiting on a reply, not on a signup',
    ).toBeVisible();

    const href = await page.getByRole('link', { name: /Send invite on WhatsApp/ }).getAttribute('href');
    const decoded = decodeURIComponent(href || '');
    expect(decoded).toContain('wa.me/91');
    expect(decoded, 'the live invite is addressed to a party, not carried as a token').toContain('?party=');
    expect(decoded).not.toContain('?invite=');
    /* ── The tenant, in a browser that has never seen the owner's session ── */
    const tenantCtx = await browser.newContext();
    try {
      const tenantPage = await tenantCtx.newPage();
      await signedInAs(tenantPage, tenantMobile);
      await tenantPage.goto(inviteUrl({ partyId: party.id, requestId: body.id }), { waitUntil: 'networkidle' });
      /* The owner's sections are readable but not writable, and the tenant's is the one they
         complete. Asserted from a context whose `localStorage` never held the owner's draft. */

      await expect(tenantPage.getByText('Set up by the owner — view only')).toBeVisible();
      await expect(active(tenantPage).getByPlaceholder(SOCIETY_PLACEHOLDER)).toBeDisabled();
      await expect(active(tenantPage).locator('.dz-dropdown__trigger').first()).toBeDisabled();

      await clickNext(tenantPage, 1); // Property -> Owner (still read-only)
      await clickNext(tenantPage, 2); // Owner -> Tenant
      await expect(tenantPage.getByText('Your details — please complete this step')).toBeVisible();
      await expect(active(tenantPage).getByPlaceholder('As per PAN/Aadhaar')).toBeEnabled();
      await expect(active(tenantPage).getByPlaceholder('10-digit mobile').first(), 'the invitee finds their own mobile already on their step').toHaveValue(tenantMobile);
      /* Accepting removes the row from the *pending* invite list, so a second visit finds nothing
         there and must not read that absence as expiry — the tenant would have no way back in. */

      await tenantPage.reload({ waitUntil: 'networkidle' });
      await expect(
        tenantPage.getByText('This invite is no longer available'),
        'reopening an accepted invite is not treated as expiry',
      ).toHaveCount(0);
      await expect(tenantPage.getByText('Set up by the owner — view only')).toBeVisible();
    } finally {
      await tenantCtx.close();
    }
  });

  test('a tenant can start the agreement and invite the owner, who fills only the owner half from their own browser', async ({ page, browser }) => {
    test.slow();
    const ownerMobile = uniqueMobile();
    const { accessToken: ownerToken } = await apiLogin(ownerMobile, { api: API });
    const tenantMobile = await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await inviteOwner(page, ownerMobile, 'Rajesh Deshpande');
    const t = active(page);
    await expect(t.getByPlaceholder('10-digit mobile').first(), 'the requester is the first tenant').toHaveValue(tenantMobile);
    await t.getByPlaceholder('As per PAN/Aadhaar').first().fill('Rahul Nair');
    await t.getByPlaceholder('As per identity proof').first().fill('Latha Nair');
    await pickDate(page, '[data-err="t0dob"]', '1995-01-01');
    await t.getByPlaceholder('ABCDE1234F').first().fill('PQRSX6789K');
    await t.getByPlaceholder('12-digit Aadhaar').first().fill(AADHAAR.tenant);
    await t.getByPlaceholder('Full permanent address').first().fill('44, FC Road, Pune 411004');
    await fillTenantPolice(page);
    await uploadAll(t, 'tenant-doc');
    await clickNext(page, 3);
    await fillTerms(page);
    await fillWitnesses(page);

    const review = active(page);
    await expect(review.getByText('Invited: Rajesh Deshpande (pending)')).toBeVisible();
    await review.getByRole('checkbox').check();
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/co-fill$/.test(new URL(r.url()).pathname),
    );
    await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();
    const res = await created;
    expect(res.status(), 'the server accepted the tenant-started co-fill').toBe(201);
    const body = await res.json();
    const party = (body.parties || []).find((p) => p?.role === 'owner');
    expect(party?.id, 'the invited party is the owner').toBeTruthy();
    await expect(page.getByText('Request sent to the owner!')).toBeVisible();
    await expect(page.getByText('Send the invite to the owner')).toBeVisible();
    expect((await invitesFor(ownerToken)).map((r) => `${r.requestId}:${r.role}`)).toContain(`${body.id}:owner`);

    const ownerCtx = await browser.newContext();
    try {
      const ownerPage = await ownerCtx.newPage();
      await signedInAs(ownerPage, ownerMobile);
      await ownerPage.goto(inviteUrl({ partyId: party.id, requestId: body.id }), { waitUntil: 'networkidle' });
      await expect(ownerPage.getByText('Set up by the tenant — view only')).toBeVisible();
      await expect(active(ownerPage).getByPlaceholder(SOCIETY_PLACEHOLDER)).toBeDisabled();
      await clickNext(ownerPage, 1);
      await expect(ownerPage.getByText('Your details — please complete this step')).toBeVisible();
      const o = active(ownerPage);
      await expect(o.getByPlaceholder('10-digit mobile').first(), 'the invitee\'s own number is already there').toHaveValue(ownerMobile);
      await o.getByPlaceholder('As per PAN/Aadhaar').first().fill('Rajesh Deshpande');
      await o.getByPlaceholder('As per identity proof').first().fill('Maya Deshpande');
      await pickDate(ownerPage, '[data-err="oDob"]', '1974-01-01');
      await o.getByPlaceholder('ABCDE1234F').first().fill('ABCDE1234F');
      await o.getByPlaceholder('12-digit Aadhaar').first().fill(AADHAAR.owner);
      await o.getByPlaceholder('Full permanent address').first().fill('12, MG Road, Pune 411001');
      await uploadAll(o, 'owner-doc');
      await clickNext(ownerPage, 2);
      await expect(active(ownerPage).getByPlaceholder('As per PAN/Aadhaar').first(), 'the tenant half is read-only').toBeDisabled();
      await clickNext(ownerPage, 3);
      await clickNext(ownerPage, 4);
      await clickNext(ownerPage, 5);
      await active(ownerPage).getByRole('checkbox').check();
      const filled = ownerPage.waitForResponse(
        (r) => r.request().method() === 'PUT' && /\/party-details$/.test(new URL(r.url()).pathname),
      );
      await active(ownerPage).getByRole('button', { name: /Generate Agreement & Proceed/ }).click();
      expect((await filled).status(), 'the owner half was accepted').toBe(200);
    } finally {
      await ownerCtx.close();
    }

    const read = await fetch(`${API}/service-requests/${body.id}`, { headers: await authHeaders(tenantMobile) });
    const merged = (await read.json()).details;
    expect(merged._state.owner.oName, 'the owner wrote the licensor').toBe('Rajesh Deshpande');
    expect(merged._state.tenants[0].name, 'and left the requester\'s tenant half alone').toBe('Rahul Nair');

    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('ra-pay-panel').getByText('The owner has filled in their part')).toBeVisible();
    const summary = page.getByTestId('ra-pay-summary');
    await expect(summary, 'the pay panel states the deed being paid for').toContainText('Rahul Nair');
  });

  test('an invite addressed to one account is invisible to another, and a signed-out invitee is sent to sign in and back — the SERVER withholds it, and the mobile never enters the URL', async ({ page, browser }) => {
    const ownerMobile = uniqueMobile();
    const { accessToken: ownerToken } = await apiLogin(ownerMobile, { api: API });
    const tenantMobile = uniqueMobile();
    await apiLogin(tenantMobile, { api: API });

    const { requestId, partyId } = await coFillOverHttp(ownerToken, tenantMobile);
    const strangerMobile = uniqueMobile();
    const { accessToken: strangerToken } = await apiLogin(strangerMobile, { api: API });

    expect(
      (await invitesFor(strangerToken)).map((r) => r.id),
      'the invitation is not in a stranger\'s list at all',
    ).not.toContain(partyId);

    const peek = await fetch(`${API}/service-requests/${requestId}`, { headers: authed(strangerToken) });
    expect(peek.status, 'the request does not exist as far as a stranger is concerned').toBe(404);

    await signedInAs(page, strangerMobile);
    await page.goto(inviteUrl({ partyId, requestId }), { waitUntil: 'networkidle' });
    /* Positive wait first. `toHaveCount(0)` is satisfied instantly by a page that has not
       rendered, so without this the two absence assertions below would pass on a blank screen. */
    await expect(page.getByText('This invite is no longer available')).toBeVisible();

    await expect(page.getByText(/sent to a different number/i)).toHaveCount(0);
    await expect(active(page).getByPlaceholder('As per PAN/Aadhaar')).toHaveCount(0);

    const signedOut = await browser.newContext();
    try {
      const anon = await signedOut.newPage();
      await anon.goto(inviteUrl({ partyId, requestId }), { waitUntil: 'networkidle' });

      await expect(anon).toHaveURL(/\/signin/);
      await expect(anon).toHaveURL(/reason=invite/);
      await expect(anon.getByRole('heading', { name: 'Sign in to complete your Rent Agreement' })).toBeVisible();

      const url = new URL(anon.url());
      expect(decodeURIComponent(url.searchParams.get('next') || ''), 'the invite is resumed after sign-in').toContain(`party=${partyId}`);
      // Live the number is never put in the URL, so a forwarded link does not disclose whose invite it is.
      expect(url.searchParams.get('mobile'), 'the invited number is not leaked into the sign-in URL').toBeNull();
      expect(anon.url()).not.toContain(tenantMobile);
    } finally {
      await signedOut.close();
    }
  });

  test('inviting a number with no Draazy account says so, and asks for a signup rather than a resend', async ({ page }) => {
    const strangerMobile = uniqueMobile();

    await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page);
    await inviteTenant(page, strangerMobile);
    await fillTerms(page);
    await fillWitnesses(page);

    const review = active(page);
    await review.getByRole('checkbox').check();

    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/co-fill$/.test(new URL(r.url()).pathname),
    );
    await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();

    const body = await (await created).json();
    const party = (body.parties || [])[0];

    expect(party?.pending, 'the server reports no account behind that number').toBe(true);
    await expect(page.getByText(/isn.t on Draazy yet/)).toBeVisible();
    await expect(page.getByText('Waiting for them to open the invite')).toHaveCount(0);
    // Mask echoed pending numbers so the panel cannot leak someone else's phone.
    expect(party.mobile, 'the echoed number is masked').not.toBe(strangerMobile);
    expect(party.mobile, 'and most of it is withheld').toContain('XXXXX');
    expect(party.mobile, 'though the last three stay, so the owner can tell who they meant').toContain(strangerMobile.slice(-3));
    expect(
      party.mobile,
      'the middle is genuinely gone, not merely styled over',
    ).not.toContain(strangerMobile.slice(2, 7));
  });

  test('the invited tenant is told from their own dashboard, and the card routes into the invite', async ({ page }) => {
    const ownerMobile = uniqueMobile();
    const { accessToken: ownerToken } = await apiLogin(ownerMobile, { api: API });
    const tenantMobile = uniqueMobile();
    const { accessToken: tenantToken } = await apiLogin(tenantMobile, { api: API });
    const invited = (rows) => rows.filter((n) => n.type === 'service.party-invited');
    expect(invited(await notificationsFor(tenantToken)), 'a brand-new account has no invitation notice to begin with').toHaveLength(0);

    const { requestId, partyId } = await coFillOverHttp(ownerToken, tenantMobile);

    const notices = invited(await notificationsFor(tenantToken));
    expect(notices, 'the invitation raised exactly one notice in the tenant\'s inbox').toHaveLength(1);
    expect(notices[0].link, 'the notice opens the invite it is about').toContain(`party=${partyId}`);
    expect(notices[0].link).toContain(`request=${requestId}`);
    expect(notices[0].link, 'not the mock bearer-token link the live wizard ignores').not.toContain('invite=');
    expect(notices[0].read, 'an unread notice is what surfaces the bell').toBe(false);
    expect(
      invited(await notificationsFor(ownerToken)),
      'the person who SENT the invitation is not the person it notifies',
    ).toHaveLength(0);

    /* A browser that has never run the owner's wizard. Nothing local could tell it this exists. */
    await signedInAs(page, tenantMobile);
    await page.goto(`${BASE}/dashboard#rental`, { waitUntil: 'networkidle' });

    await expect(
      page.getByText('Action needed: complete your rent agreement'),
      'the invited tenant is told, in the browser they actually use',
    ).toBeVisible();

    const fill = page.getByRole('link', { name: /Fill my details/ });
    await expect(fill).toBeVisible();
    /* The link has to be the account-addressed form. A `?invite=` href would render identically
       and dead-end on the expired panel, so assert the address before following it. */

    const href = await fill.getAttribute('href');
    expect(href, 'the card links to the account-addressed invite').toContain(`party=${partyId}`);
    expect(href).toContain(`request=${requestId}`);
    expect(href, 'not the mock bearer-token link the live wizard ignores').not.toContain('invite=');

    await fill.click();
    await expect(page).toHaveURL(new RegExp(`party=${partyId}`));
    await expect(
      page.getByText('Set up by the owner — view only'),
      'and it opens the invite rather than the expired panel',
    ).toBeVisible();

    await test.step('the invitee\'s own mobile is on their step, seeded from the account rather than from the owner\'s state', async () => {
      await clickNext(page, 1);
      await clickNext(page, 2);
      await expect(active(page).getByPlaceholder('10-digit mobile').first()).toHaveValue(tenantMobile);
    });
  });
});
