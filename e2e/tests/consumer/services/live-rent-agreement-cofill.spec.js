// @ts-check
import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/*
 * Rent Agreement — the co-fill invite, against the server that addresses it.
 *
 * ## Why this could never be a mock test
 *
 * Co-fill is a *two-account* flow: an owner invites a tenant, and the tenant — a different
 * person, on a different phone, in a different browser — opens their half. The mock provider
 * says so itself: its comment calls the one-browser limit "the same one-browser limit that made
 * the whole co-fill flow a live-only feature."
 *
 * The retired mock trio worked around that by keeping both actors in one browser context and
 * one `localStorage`, and it shows in what they were able to assert:
 *
 *   - `rent-agreement.spec.js:307` **wrote** `puneNestRAInvite:9822334455` itself and then
 *     asserted the app redirected with `mobile=9822334455` — a number the test had just put
 *     there. Both halves of that assertion are the browser talking to itself.
 *   - `:342` logged in as the tenant in the *same* context, with a comment conceding "the invite
 *     + request the owner just created are already in localStorage".
 *   - `:135` asserted the deep link contained `?invite=<bearer token>`.
 *
 * ## Two claims that have since reversed — not ported
 *
 * 1. **The deep link is no longer a bearer token.** Live moved to an *account-addressed* invite,
 *    `?party=…&request=…`, resolved only after sign-in (`useRentAgreement.js:552-607`). Holding
 *    the link is not authority; being the invited account is.
 * 2. **The invited mobile is no longer put in the sign-in URL.** Mock sent
 *    `?reason=invite&mobile=9822334455` so the field could be prefilled — which discloses the
 *    tenant's number to anyone holding the link. Live sends only `reason` and `next`. Asserting
 *    the *absence* of `mobile=` is the point of the third test; porting the mock's assertion
 *    verbatim would have re-pinned a leak.
 *
 * Likewise the mock's `wrongNumber` state ("this invite was sent to {{mobile}}") is unreachable
 * live and deliberately so: it was a client-side `digits(user.mobile) !== digits(rec.toMobile)`
 * comparison against a record the browser held, and it told a stranger both that the invite
 * existed and roughly who it was for. Live the server simply does not return the row, so a
 * stranger gets the neutral `expired` panel. That is asserted below rather than mourned.
 *
 * ## Owned elsewhere, deliberately not re-proved here
 *
 *   - Pricing, the `awaiting-payment` park and the 409 on a second unpaid request —
 *     `live-rent-agreement.spec.js`.
 *   - The owner's KYC uploads reaching the request row — same file.
 *   - Settlement (a signed webhook moving a parked request on) — backend
 *     `ServiceRequestFlowTest.PaidGate`; no browser can send it.
 *   - Draft share / approve / request-changes — not yet covered anywhere; see COVERAGE.md.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const active = (page) => page.locator('.step-panel.active');

/* Click Next, and prove the wizard actually moved. Every panel shares its placeholders, so a
   refused Next silently redirects the next helper's typing into the panel it is already on and
   the run falls over somewhere unrelated. Asserting the step turns that into a failure that names
   the step that would not advance.

   Page-scoped, and the progress dot rather than the panel, because the Next button sits *outside*
   `.step-panel` — scoping it to the active panel finds the fields but never the button. */
async function clickNext(page, expectStep) {
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(
    page.locator('.step-dot').nth(expectStep),
    `wizard did not advance to step ${expectStep + 1}`,
  ).toHaveClass(/\bactive\b/);
}

async function fillProperty(page) {
  const p = active(page);
  await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
  await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
  await p.getByPlaceholder('e.g. Baner').fill('Baner');
  await p.getByPlaceholder('411045').fill('411045');
  await clickNext(page, 1);
}

async function fillOwner(page) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').fill('Anita Verma');
  await p.getByPlaceholder('ABCDE1234F').fill('ABCDE1234F');
  await p.getByPlaceholder('12-digit Aadhaar').fill('123412341234');
  await p.getByPlaceholder('10-digit mobile').fill('9811223344');
  await p.getByPlaceholder('Full permanent address').fill('12, MG Road, Pune 411001');
  await clickNext(page, 2);
}

/** Step 3 in *invite* mode: name the counterparty instead of typing their details. */
async function inviteTenant(page, mobile) {
  const p = active(page);
  await p.getByText('Invite the tenant', { exact: true }).click();
  await p.getByPlaceholder('10-digit mobile').fill(mobile);
  await clickNext(page, 3);
}

async function fillTerms(page) {
  const p = active(page);
  await p.locator('.pn-datefield').click();
  await page.locator('.pn-cal').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: todayIso(), exact: true }).first().click();
  await page.locator('.pn-cal').waitFor({ state: 'detached' });
  await p.getByPlaceholder('e.g. 25000').fill('30000');
  await p.getByPlaceholder('e.g. 100000').fill('150000');
  await clickNext(page, 4);
}

const authed = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

/** The invitations the server considers addressed to this account. */
async function invitesFor(token) {
  const res = await fetch(`${API}/me/service-request-invites`, { headers: authed(token) });
  expect(res.status, 'an account can always read its own invite list').toBe(200);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

/**
 * This account's own inbox, read outside the browser.
 *
 * Deliberately the API rather than the bell: what is being checked is that the *server* raised the
 * row against this user id. Reading it through the page would put the client's own rendering — and
 * `notificationMapper`'s wire-to-chip translation — between the assertion and the fact, so a type
 * the mapper mishandled would look like a notification that was never sent.
 */
async function notificationsFor(token) {
  const res = await fetch(`${API}/notifications?size=100`, { headers: authed(token) });
  expect(res.status, 'an account can always read its own inbox').toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.content), 'the notification contract returns a page envelope').toBe(true);
  return body.content;
}

/**
 * File a co-fill request the way the wizard does, without driving the wizard.
 *
 * `type` is the wire value `rent-agreement`, not the client's `rental`: `toWireType` maps between
 * them and the server refuses the client word outright ("Unknown service request type 'rental'").
 * Bypassing the mapper here means the wire vocabulary is spelled out rather than assumed.
 */
async function coFillOverHttp(ownerToken, inviteeMobile) {
  const res = await fetch(`${API}/service-requests/co-fill`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      request: {
        type: 'rent-agreement',
        details: { ownerName: 'Anita Verma', property: 'B-1204, Skyline Heights', rent: '30000' },
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
  test('the owner\'s invite becomes a row the SERVER addressed to the tenant\'s account, and the tenant opens it from a different browser with only their own section editable', async ({ page, browser }) => {
    /* Two actors, a full wizard run and a second browser context. */
    test.slow();

    /* The tenant's account exists *before* the invite is sent. That is what makes the panel below
       say "waiting for them to open the invite" rather than "this number isn't on PuneNest yet" —
       the two are decided by `party.pending`, which is the server answering whether a user row
       exists. A browser cannot know that about someone else's phone number. */
    const tenantMobile = uniqueMobile();
    const { accessToken: tenantToken } = await apiLogin(tenantMobile, { api: API });

    /* Snapshot before the write. An id-set delta survives a seeded or concurrently-written list,
       which an absolute count does not — and `GET` list rows are projections, so diffing ids is
       also immune to a field simply not being carried. */
    const before = new Set((await invitesFor(tenantToken)).map((r) => r.id));

    await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page);
    await inviteTenant(page, tenantMobile);
    await fillTerms(page);
    await clickNext(page, 5); // witnesses -> review

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

    /* The live deep link is account-addressed. `?invite=` was the mock's bearer token. */
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
      await expect(active(tenantPage).getByPlaceholder('e.g. Skyline Heights')).toBeDisabled();

      await clickNext(tenantPage, 1); // Property -> Owner (still read-only)
      await clickNext(tenantPage, 2); // Owner -> Tenant
      await expect(tenantPage.getByText('Your details — please complete this step')).toBeVisible();
      await expect(active(tenantPage).getByPlaceholder('As per PAN/Aadhaar')).toBeEnabled();

      /* The invitee may come back. Accepting removes the row from `GET /me/service-request-invites`
         — that list is of *pending* invitations — so a second visit finds nothing there and must
         not read that absence as expiry. Regression guard: before the fix that shipped with this
         spec, reopening one's own invite said "This invite is no longer available", and the tenant
         had no way back into a request they had already been added to. */
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

  test('an invite addressed to one account is invisible to another — the SERVER withholds it rather than the browser being discreet', async ({ page }) => {
    const ownerMobile = uniqueMobile();
    const { accessToken: ownerToken } = await apiLogin(ownerMobile, { api: API });
    const tenantMobile = uniqueMobile();
    await apiLogin(tenantMobile, { api: API });

    const { requestId, partyId } = await coFillOverHttp(ownerToken, tenantMobile);

    /* A third account: not the owner, not the invitee, holding the exact link. */
    const strangerMobile = uniqueMobile();
    const { accessToken: strangerToken } = await apiLogin(strangerMobile, { api: API });

    expect(
      (await invitesFor(strangerToken)).map((r) => r.id),
      'the invitation is not in a stranger\'s list at all',
    ).not.toContain(partyId);

    /* 404, not 403. The stranger is not told "you may not see this request", which would confirm
       it exists; they are told there is nothing there. */
    const peek = await fetch(`${API}/service-requests/${requestId}`, { headers: authed(strangerToken) });
    expect(peek.status, 'the request does not exist as far as a stranger is concerned').toBe(404);

    await signedInAs(page, strangerMobile);
    await page.goto(inviteUrl({ partyId, requestId }), { waitUntil: 'networkidle' });

    /* Positive wait first. `toHaveCount(0)` is satisfied instantly by a page that has not
       rendered, so without this the two absence assertions below would pass on a blank screen. */
    await expect(page.getByText('This invite is no longer available')).toBeVisible();

    /* The neutral refusal, not the mock's `wrongNumber` panel — which named the invited number
       to whoever was holding the link. */
    await expect(page.getByText(/sent to a different number/i)).toHaveCount(0);
    await expect(active(page).getByPlaceholder('As per PAN/Aadhaar')).toHaveCount(0);
  });

  test('a signed-out invitee is sent to sign in and back — without the invited mobile being put in the URL', async ({ page }) => {
    const ownerMobile = uniqueMobile();
    const { accessToken: ownerToken } = await apiLogin(ownerMobile, { api: API });
    const tenantMobile = uniqueMobile();
    await apiLogin(tenantMobile, { api: API });

    const { requestId, partyId } = await coFillOverHttp(ownerToken, tenantMobile);

    /* No sign-in step: this context has never authenticated. */
    await page.goto(inviteUrl({ partyId, requestId }), { waitUntil: 'networkidle' });

    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=invite/);
    await expect(page.getByText('Sign in to complete your Rent Agreement')).toBeVisible();

    /* The return path is preserved, so signing in resumes the invite rather than dumping them on
       a dashboard. */
    const url = new URL(page.url());
    expect(decodeURIComponent(url.searchParams.get('next') || ''), 'the invite is resumed after sign-in').toContain(`party=${partyId}`);

    /* The reversal. The mock asserted `mobile=9822334455` was prefilled here — from a record the
       test itself had seeded. Live the number is never put in the URL, so a forwarded link does
       not disclose whose invite it is. */
    expect(url.searchParams.get('mobile'), 'the invited number is not leaked into the sign-in URL').toBeNull();
    expect(page.url()).not.toContain(tenantMobile);
  });

  test('inviting a number with no PuneNest account says so, and asks for a signup rather than a resend', async ({ page }) => {
    /* Never registered — `uniqueMobile()` without the `apiLogin` the other tests pair it with. */
    const strangerMobile = uniqueMobile();

    await signedInAsNew(page, { api: API });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page);
    await inviteTenant(page, strangerMobile);
    await fillTerms(page);
    await clickNext(page, 5);

    const review = active(page);
    await review.getByRole('checkbox').check();

    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests\/co-fill$/.test(new URL(r.url()).pathname),
    );
    await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();

    const body = await (await created).json();
    const party = (body.parties || [])[0];

    /* Only the server can answer "is there an account behind this number?", and it is the whole
       basis for the advice the owner is given. "Resend it" would be useless — the link cannot
       open until they sign up. */
    expect(party?.pending, 'the server reports no account behind that number').toBe(true);
    await expect(page.getByText(/isn.t on PuneNest yet/)).toBeVisible();
    await expect(page.getByText('Waiting for them to open the invite')).toHaveCount(0);

    /* The server masks the number it echoes back, so the panel cannot become a place to read a
       full phone number off someone else's screen. Measured shape: first two digits, then five
       X, then the last three — `9712345074` comes back as `97XXXXX074`. */
    expect(party.mobile, 'the echoed number is masked').not.toBe(strangerMobile);
    expect(party.mobile, 'and most of it is withheld').toContain('XXXXX');
    expect(party.mobile, 'though the last three stay, so the owner can tell who they meant').toContain(strangerMobile.slice(-3));
    expect(
      party.mobile,
      'the middle is genuinely gone, not merely styled over',
    ).not.toContain(strangerMobile.slice(2, 7));
  });

  test('the invited tenant is told from their own dashboard, and the card routes into the invite', async ({ page }) => {
    /* Supersedes the mock's "request surfaces in My Rental first" half of `invited tenant:
       request surfaces in My Rental first, and only the Tenant tab is editable`. That test could
       only ever pass because one browser held both actors' `localStorage`: the panel read the
       invitation out of the same key the owner's wizard had just written, in the same tab.

       Live, the invitation is a row the owner created against *this* account, and this browser has
       never seen it — which is exactly why the dashboard was reading it from the wrong place.
       Before the fix that ships with this spec, `MyRentalPanel` sourced the card from
       `pendingInvites()` (localStorage) and `Dashboard` gated the whole My Rental tab on
       `pendingInviteCount()`, so live the invited tenant was never told at all and, if they were
       an owner too, had no tab to be told in. The card's link was also still the mock's
       `?invite=<token>` form, which the live wizard does not resolve. */
    const ownerMobile = uniqueMobile();
    const { accessToken: ownerToken } = await apiLogin(ownerMobile, { api: API });
    const tenantMobile = uniqueMobile();
    await apiLogin(tenantMobile, { api: API });

    const { requestId, partyId } = await coFillOverHttp(ownerToken, tenantMobile);

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
  });

  /*
   * The invitation announces itself, and to the right person.
   *
   * Until the server raised this, the only thing that ever notified an invited tenant was
   * `pushNotificationFor` in `useRentAgreement.generate` — a write into `localStorage` under the
   * key `pnNotifications:<tenant>`, performed by the *owner's* browser. Storage is per-origin and
   * per-browser, so that row reached the tenant only when tenant and owner were the same person:
   * true in the mock, never true on live. The invitation was discoverable (`myInvites` puts it on
   * the dashboard) but silent — nothing told the tenant to go and look.
   *
   * Both halves are asserted deliberately. The BEFORE is not decoration: without it a server that
   * pre-filled every inbox, or a `type` that happened to match some unrelated seeded row, would
   * satisfy the AFTER on its own. And the owner's inbox is checked precisely because writing into
   * the *inviter's* store is the original defect — a notification raised against the wrong user id
   * would still make the tenant-side count non-zero if the two were confused, so the negative is
   * what pins the recipient.
   *
   * Time-independent by construction: quiet hours DEFER delivery (`NotificationPublisher`), and
   * `NotificationService.list` withholds a row until its window closes. Both accounts are created
   * fresh here, and `quiet_hours_enabled` defaults to false, so nothing is held back. A test that
   * reused a seeded account could pass by day and fail at night.
   */
  test('the SERVER announces the invitation to the invited tenant — into their inbox, not the inviter\'s browser', async () => {
    const tenantMobile = uniqueMobile();
    const { accessToken: tenantToken } = await apiLogin(tenantMobile, { api: API });
    const { accessToken: ownerToken } = await apiLogin(uniqueMobile(), { api: API });

    const invited = (rows) => rows.filter((n) => n.type === 'service.party-invited');

    const before = invited(await notificationsFor(tenantToken));
    expect(before, 'a brand-new account has no invitation notice to begin with').toHaveLength(0);

    const { requestId, partyId } = await coFillOverHttp(ownerToken, tenantMobile);

    const after = invited(await notificationsFor(tenantToken));
    expect(after, 'the invitation raised exactly one notice in the tenant\'s inbox').toHaveLength(1);

    /* The notice has to be actionable, not merely present: the link is the whole point of sending
       it. Same account-addressed shape the dashboard card uses — asserted here too because a
       notification is the one surface a user reaches without passing through that card. */
    expect(after[0].link, 'the notice opens the invite it is about').toContain(`party=${partyId}`);
    expect(after[0].link).toContain(`request=${requestId}`);
    expect(after[0].link, 'not the mock bearer-token link the live wizard ignores').not.toContain('invite=');
    expect(after[0].read, 'an unread notice is what surfaces the bell').toBe(false);

    /* The negative that names the recipient. */
    expect(
      invited(await notificationsFor(ownerToken)),
      'the person who SENT the invitation is not the person it notifies',
    ).toHaveLength(0);
  });
});
