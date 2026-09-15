// @ts-check
import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

/* The customer half of the maker→checker, read back from the server rather than the browser. A
   valuation because the one priced desk can never reach `draft-shared` without the signed webhook. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* A seeded `valuation` staffer. The desk is team-scoped, so the maker must match the request's
   type — the same account and the same reasoning as `ops/live-drafting-desk.spec.js`. */
const STAFFER = '9383334640';

const auth = (token) => ({ authorization: `Bearer ${token}` });
const json = (token) => ({ ...auth(token), 'content-type': 'application/json' });

async function apiJson(res) {
  const body = await res.text();
  try {
    return { status: res.status, body: body ? JSON.parse(body) : null };
  } catch {
    return { status: res.status, body };
  }
}

/* File a free valuation request for `token`'s account and hand it to the staffer. The property id is
   not decoration: a document hangs off a property, so an unlinked request can never receive a draft. */
async function fileRequest(token) {
  const props = await (await fetch(`${API}/properties?page=0&size=1`, { headers: auth(token) })).json();
  const propertyId = (props.items || props.content || props)[0].id;
  const res = await fetch(`${API}/service-requests`, {
    method: 'POST',
    headers: json(token),
    body: JSON.stringify({ type: 'valuation', propertyId, details: { property: 'Valuation probe' } }),
  });
  expect(res.status, 'a free desk files straight into the queue').toBe(201);
  return (await res.json()).id;
}

/** The maker: take the request off the queue, then share a draft on it (multipart). */
async function shareDraft(staffToken, requestId, note = 'Draft v1 for your review') {
  const took = await fetch(`${API}/service-requests/${requestId}/status`, {
    method: 'PATCH',
    headers: json(staffToken),
    body: JSON.stringify({ status: 'assigned' }),
  });
  expect(took.status, 'ops pick the request up before drafting on it').toBe(200);

  const form = new FormData();
  form.set('note', note);
  form.set('file', new Blob([Buffer.from('%PDF-1.4 draft')], { type: 'application/pdf' }), 'draft.pdf');
  const res = await fetch(`${API}/service-requests/${requestId}/draft`, {
    method: 'POST',
    headers: auth(staffToken),
    body: form,
  });
  const { status, body } = await apiJson(res);
  expect(status, `share draft: ${JSON.stringify(body)}`).toBe(200);
  expect(body.status).toBe('draft-shared');
  return body;
}

/** The request as the *server* holds it — never as the browser rendered it. */
async function readBack(token, requestId) {
  const res = await fetch(`${API}/service-requests/${requestId}`, { headers: auth(token) });
  expect(res.status).toBe(200);
  return res.json();
}

/* The tracker panel on whichever service page is open, scoped by its standing copy: every account
   here is minted fresh and files exactly one request, so there is nothing to disambiguate. */
const tracker = (page) =>
  page.locator('section').filter({ hasText: 'Track progress, review the draft we prepare' });

test.describe('Service draft review — the customer is the checker', () => {
  test('sharing a draft tells the customer, and the bell links to the tracker', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken: customer } = await apiLogin(mobile);
    const { accessToken: staff } = await apiLogin(STAFFER);
    const requestId = await fileRequest(customer);

    // Nothing is waiting on the customer yet, so nothing should be shouting at them. Asserted
    // before the share so the row below cannot be a pre-existing one.
    const before = await (await fetch(`${API}/notifications?size=100`, { headers: auth(customer) })).json();
    expect(before.content, 'a request nobody has drafted on is silent').toHaveLength(0);

    await shareDraft(staff, requestId);

    // The bell is server-side now. Read it from the API first — a notification the browser
    // renders but the server never stored is exactly what the mock test was asserting.
    const after = await (await fetch(`${API}/notifications?size=100`, { headers: auth(customer) })).json();
    expect(after.content).toHaveLength(1);
    const bell = after.content[0];
    expect(bell.type).toBe('service.draft-shared');
    expect(bell.read).toBe(false);
    expect(bell.link, 'the link must land on the tracker that holds the decision')
      .toBe('/services/property-valuation');

    // …and that it survives the wire→UI translation: `service.draft-shared` is dotted, so it reaches
    // the page only because `notificationMapper.js` maps it.
    await signedInAs(page, mobile);
    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
    const row = page.locator('.notif').filter({ hasText: 'Your draft is ready to review' });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.locator('a').first()).toHaveAttribute('href', '/services/property-valuation');
    // The assertion that holds the mapper entry: without it `toUiType` falls through to `system` and
    // this swatch is the only visible difference, so every other assertion would stay green.
    await expect(row.locator('.w-11').first()).toHaveClass(/bg-teal-400/);
  });

  test('the customer can approve the draft our team shares, and the server records it', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken: customer } = await apiLogin(mobile);
    const { accessToken: staff } = await apiLogin(STAFFER);
    const requestId = await fileRequest(customer);
    await shareDraft(staff, requestId);

    await signedInAs(page, mobile);
    await page.goto(`${BASE}/services/property-valuation`, { waitUntil: 'networkidle' });

    const mine = tracker(page);
    await expect(mine.getByText(requestId.slice(0, 10))).toBeVisible({ timeout: 15000 });
    // The status chip proves the hyphenated wire status survived `serviceRequestMapper.js` —
    // an unmapped one renders as the raw key and the Approve button never appears at all.
    await expect(mine.getByText('Draft ready for your review')).toBeVisible();

    await mine.getByRole('button', { name: /^Approve$/ }).click();

    // Assert the *response*, not the UI settling. A card that re-renders looks identical whether
    // the POST landed or was swallowed by the catch in `ServiceTracker.approve`.
    await expect
      .poll(async () => (await readBack(customer, requestId)).status, { timeout: 15000 })
      .toBe('approved');
  });

  test('request-changes opens an on-brand modal, is gated on a real note, and the note reaches the thread', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken: customer, user } = await apiLogin(mobile);
    const customerId = user.id;
    const { accessToken: staff } = await apiLogin(STAFFER);
    const requestId = await fileRequest(customer);
    await shareDraft(staff, requestId);

    await signedInAs(page, mobile);
    await page.goto(`${BASE}/services/property-valuation`, { waitUntil: 'networkidle' });

    const mine = tracker(page);
    await expect(mine.getByText(requestId.slice(0, 10))).toBeVisible({ timeout: 15000 });
    await mine.getByRole('button', { name: /Request changes/ }).click();

    // An in-app dialog, not `window.prompt` — a native prompt is unstyleable, unlocalisable and
    // invisible to Playwright's accessibility tree, so this is the assertion that keeps it out.
    const dialog = page.getByRole('dialog', { name: 'Request changes' });
    await expect(dialog).toBeVisible();
    const send = dialog.getByRole('button', { name: /Send request/ });
    await expect(send, 'a rejection with no reason is not a rejection, it is a stall').toBeDisabled();

    const note = `Please correct the valuation basis (${requestId.slice(0, 8)}).`;
    await dialog.getByRole('textbox').fill(note);
    await expect(send).toBeEnabled();
    await send.click();

    // A rejection lands in `changes-requested` — *not* back in the state a request that was never
    // rejected also sits in — and the note goes on the thread, not into `audit_log`.
    await expect
      .poll(async () => (await readBack(customer, requestId)).status, { timeout: 15000 })
      .toBe('changes-requested');
    const server = await readBack(customer, requestId);
    // `body`, not `text` — the client's own vocabulary is `text`, and asserting the client's spelling
    // against the wire reads as "the note was never recorded" when it was recorded fine.
    const mine2 = server.messages.find((m) => m.body === note);
    expect(mine2, `note missing from thread: ${JSON.stringify(server.messages)}`).toBeTruthy();
    // Written as the *customer's own* message, so it lands on a surface both sides already read.
    // Pinned by author id, not `authorRole`, which would pass just as happily for a staff author.
    expect(mine2.authorId).toBe(customerId);
  });

  test('the maker cannot approve their own work, and nor can a stranger', async () => {
    const mobile = uniqueMobile();
    const { accessToken: customer } = await apiLogin(mobile);
    const { accessToken: staff } = await apiLogin(STAFFER);
    const { accessToken: stranger } = await apiLogin(uniqueMobile());
    const requestId = await fileRequest(customer);
    await shareDraft(staff, requestId);

    const decide = (token, decision) =>
      fetch(`${API}/service-requests/${requestId}/draft/decision`, {
        method: 'POST',
        headers: json(token),
        body: JSON.stringify({ decision }),
      });

    // The whole maker-checker: whoever produced the draft must not be the one who accepts it. No
    // `@PreAuthorize` — "is this the requester" is not a role expression an admin carve-out can hold.
    expect((await decide(staff, 'approve')).status, 'ops must not sign off their own draft').toBe(403);
    expect((await decide(stranger, 'approve')).status).toBe(403);
    expect((await readBack(customer, requestId)).status, 'and the refusals left it untouched')
      .toBe('draft-shared');

    // The checker's own decision still works, and is not repeatable — a second approval is a
    // conflict, not a silent no-op that would let a UI double-submit look successful.
    expect((await decide(customer, 'approve')).status).toBe(200);
    expect((await decide(customer, 'approve')).status).toBe(409);
    expect((await readBack(customer, requestId)).status).toBe('approved');
  });
});
