import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/* In-app chat with an owner, from the listing page into Messages, against real HTTP.
 *
 * ## What the mock version was actually asserting
 *
 * `chat-owner.spec.js` wrote `puneNestContactReq:<ownerMobile>` into localStorage — a JSON array
 * holding a row with `status: 'approved'` — and then asserted the listing page offered "Chat with
 * Owner". The contact gate was read out of the same key the test had just written, so the test
 * proved that a value put into a browser store came back out of it. Nothing about who may reach an
 * owner was under test, and the button would have appeared for a buyer with no relationship to the
 * listing at all as long as the string was present.
 *
 * Live, the gate is `contact_requests` on the server and the answer arrives from
 * `GET /contacts/status`. The only way to open it is the real two-step: the buyer asks
 * (`POST /contacts/request`) and the owner grants (`PATCH /me/contact-requests/{id}`). Both
 * sides are exercised below with two separate accounts, so the "approved" state is one the server
 * agreed to rather than one the test declared.
 *
 * ## The staged-chat split, and why the middle test is about the Requests tab
 *
 * "Contact Owner" is reachable *before* the gate opens, but `POST /messages` answers 403 without an
 * approved request in one direction or the other — the relationship guard that stops the endpoint
 * being a way to probe mobile numbers against the user base. So the seam stages the chat locally
 * (`http/conversationProvider.js#queuePendingChat`) and flushes it once the gate opens. A staged
 * row carries `staged: true` and a `staged:` id, and Messages files it under **Requests**, not
 * Chats (D52).
 *
 * That split is the thing worth pinning: the middle test asserts the buyer lands on a *waiting*
 * row with no composer, and the last test asserts that after approval there is a real server
 * thread with one. A spec that asserted a live thread straight after clicking "Contact Owner"
 * would be asserting the 403 away.
 *
 * ## Seed gap
 *
 * There is no seeded `contact_requests` row between the fixture users, and borrowing a seeded pair
 * would not help — the endpoint is idempotent on (requester, property), so a second run against a
 * shared listing re-reads the first run's row and the assertions start describing history. Every
 * account and the listing are minted per test.
 */

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/* A named throwaway account. Registration leaves `name` unset and the owner card falls back to a
   placeholder, so an unnamed owner would let "the owner's name is shown" pass against a constant. */
async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

/* An approved listing owned by a throwaway account.
 *
 * The wire vocabulary, not the client's: `propertyType` rather than `type`, `bhk` as a number,
 * `furnishing: 'semi-furnished'` rather than the client's `semi`. Posting the client's spelling
 * here would 422 on some fields and pass through untranslated on others. */
async function fixture() {
  const owner = await actor('Zztest Chat Owner');
  const res = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest chat-owner ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    bhk: 2,
    price: 27000,
    area: 940,
    areaUnit: 'sqft',
    furnishing: 'semi-furnished',
    city: 'Pune',
    locality: 'Baner',
    address: 'D110 Chat Owner Residency, C-402',
  });
  expect(res.status, `creating the fixture listing (${JSON.stringify(res.body)})`).toBe(201);
  const id = res.body.id;
  expect(id, 'the server issued an id').toBeTruthy();
  created.add(id);

  const admin = await authHeaders(ACTORS.admin);
  const appr = await api('PATCH', `/properties/${id}/status`, admin, { status: 'approved' });
  expect(appr.status, 'approving the fixture listing').toBe(200);

  return { owner, id };
}

/* Drive the real gate to `approved`, both halves, and assert each one.
 *
 * The owner's PATCH is the half that matters: without it the request sits at `pending` and the
 * page keeps offering "Contact Owner". Asserting the buyer's request landed as `pending` FIRST is
 * what stops the approval assertion from being satisfied by a listing that was somehow open all
 * along. */
async function openTheGate(buyer, owner, propertyId) {
  const req = await api('POST', '/contacts/request', buyer.headers, { propertyId });
  expect(req.status, `requesting contact (${JSON.stringify(req.body)})`).toBe(200);
  expect(req.body.status, 'a fresh request starts pending, not approved').toBe('pending');

  const inbox = await api('GET', '/me/contact-requests', owner.headers);
  expect(inbox.status, 'the owner reading their request inbox').toBe(200);
  const row = (inbox.body?.content ?? []).find((r) => r.propertyId === propertyId);
  expect(row, 'the buyer\'s request reached the owner\'s inbox').toBeTruthy();

  const grant = await api('PATCH', `/me/contact-requests/${row.id}`, owner.headers, { status: 'approved' });
  expect(grant.status, 'the owner approving the request').toBe(200);

  const after = await api('GET', `/contacts/status?propertyId=${propertyId}`, buyer.headers);
  expect(after.status).toBe(200);
  expect(after.body.status, 'the gate is open for this buyer on this listing').toBe('approved');
}

test.afterEach(async () => {
  const admin = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, admin, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic chat-owner fixture',
    });
  }
  created.clear();
});

/* The detail page's right rail mounts after the first paint, so every assertion below is gated
   behind a positive anchor that is always present once it has. Without one, `toHaveCount(0)` on
   "Chat with Owner" passes while the rail is still empty — the exact false green an absence
   assertion is written to avoid. */
async function openListing(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  // Derived from deal + bhk + locality by the page, not the posted title.
  await expect(page.getByRole('heading', { level: 1, name: '2 BHK Flat for Rent in Baner' })).toBeVisible({ timeout: 20000 });
}

const contactBtn = (page) => page.getByRole('button', { name: /Contact Owner/i }).first();
const chatLink = (page) => page.getByRole('link', { name: /Chat with Owner/i }).first();

test.describe('Chat with the owner from a listing', () => {
  test('before the owner approves, the page offers "Contact Owner" and not the chat route', async ({ page }) => {
    const { id } = await fixture();
    const buyer = await actor('Zztest Chat Buyer');
    await signedInAs(page, buyer.mobile);
    await openListing(page, id);

    // Positive anchor for the absence below: the button that stands in for the chat link.
    await expect(contactBtn(page)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('link', { name: /Chat with Owner/i })).toHaveCount(0);
  });

  test('clicking "Contact Owner" stages the chat and shows it waiting, with no composer', async ({ page }) => {
    const { id } = await fixture();
    const buyer = await actor('Zztest Staging Buyer');
    await signedInAs(page, buyer.mobile);
    await openListing(page, id);

    await contactBtn(page).click();
    await expect(page).toHaveURL(new RegExp(`/messages\\?openProp=${id}`));

    /* The thread pane opened on the right row. `?openProp=` is matched client-side against the
       conversation's `propertyId`, which live is the listing UUID on both the server rows and the
       staged one — so this also pins the two spellings agreeing. */
    const chip = page.locator('.pc-propchip');
    await expect(chip.getByText(/View listing/i)).toBeVisible({ timeout: 20000 });
    await expect(chip.getByRole('link', { name: /View listing/i })).toHaveAttribute('href', `/property/${id}`);

    // The message the seam composed on the buyer's behalf is already in the thread...
    await expect(page.getByText(/interested in/i).first()).toBeVisible();
    // ...and it is explicitly not sent: waiting copy in place of the composer.
    await expect(page.getByText(/Waiting for the owner to accept/i)).toBeVisible();
    await expect(page.locator('input.pc-input')).toHaveCount(0);

    /* The server was never asked to create this thread, which is the whole point of staging — a
       `POST /messages` here would have been a 403. An empty inbox is the proof. */
    const inbox = await api('GET', '/messages', buyer.headers);
    expect(inbox.status).toBe(200);
    expect(inbox.body.content, 'staging must not have created a server thread').toHaveLength(0);
  });

  test('once the owner approves, the page offers "Chat with Owner" and it opens a real thread', async ({ page }) => {
    const { owner, id } = await fixture();
    const buyer = await actor('Zztest Approved Buyer');
    await openTheGate(buyer, owner, id);

    /* A real server thread, created now that the gate permits it. This is what the staged row in
       the previous test becomes once `drainPendingChats` succeeds; created directly here so the
       assertion is about the approved state and not about the flush.

       Addressed by `propertyId` with no `counterpartyMobile`, because that is the only shape a
       buyer can actually produce: under D5 the owner's number is masked for every non-owner, so a
       test that passed the real digits would be proving a path no user can walk. The server derives
       the owner from the listing. */
    const conv = await api('POST', '/messages', buyer.headers, {
      propertyId: id,
      body: 'Zztest — is this flat still available?',
    });
    expect(conv.status, `opening the thread (${JSON.stringify(conv.body)})`).toBe(201);
    expect(conv.body.propertyId, 'the thread is bound to this listing').toBe(id);

    await signedInAs(page, buyer.mobile);
    await openListing(page, id);

    // Positive anchor first, then the absence: approval swaps the button for the link.
    const link = chatLink(page);
    await expect(link).toBeVisible({ timeout: 20000 });
    await expect(link).toHaveAttribute('href', `/messages?openProp=${id}`);
    await expect(page.getByRole('button', { name: /Contact Owner/i })).toHaveCount(0);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/messages\\?openProp=${id}`));

    await expect(page.locator('.pc-propchip').getByText(/View listing/i)).toBeVisible({ timeout: 20000 });
    // The message posted over HTTP is rendered by the page — the thread is the server's, not a stage.
    await expect(page.getByText(/is this flat still available\?/i).first()).toBeVisible();
    // A usable composer is the difference between an approved thread and a waiting one.
    await expect(page.locator('input.pc-input')).toBeVisible();
    await expect(page.getByText(/Waiting for the owner to accept/i)).toHaveCount(0);
  });
});
