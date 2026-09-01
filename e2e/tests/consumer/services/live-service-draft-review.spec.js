// @ts-check
import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

/*
 * The draft review — the customer half of the maker→checker, against the server that enforces it.
 *
 * ## What this replaces, and why the mock trio could not have proved it
 *
 * Three mock tests in `rent-agreement.spec.js` covered draft review, and all three began with the
 * same line: `getByRole('button', { name: /Preview with a sample draft/ })`. That button is a
 * **demo affordance**, and `ServiceTracker.jsx:138` gates it off the moment the app is live:
 *
 *     const canSample = sampleName !== undefined && !isHttpDomain('serviceRequest');
 *
 * with the comment "a customer cannot share a draft to themselves". So the mock's maker was the
 * customer's own browser. There was no second party, and therefore no maker-checker to test:
 *
 *   - `:166` "customer (checker) can approve the draft our team shares" — the draft our team
 *     shares was fabricated client-side one line earlier.
 *   - `:314` "sharing a draft raises a dashboard bell notification" — asserted by reading
 *     `localStorage['pnNotifications:' + mobile]`, which the same browser had just written.
 *   - `:332` "request-changes … records the note" — the modal half was a real component claim; the
 *     "records the note" half read `localStorage['puneNestServiceReq:' + mobile]` back.
 *
 * Here the maker is a **real staffer on a real desk**, over HTTP, and every outcome is read back
 * from the server rather than from the browser that caused it.
 *
 * ## Why a valuation and not a rent agreement
 *
 * A rent agreement is the one priced desk, so it opens in `awaiting-payment` — and
 * `ServiceRequestStatus.ALLOWED` lets that state reach only `new` or `cancelled`. Nothing a
 * browser can do moves it on: only the signed Cashfree webhook does, and `STAFF_SETTABLE` is
 * `{assigned, in-progress, cancelled}`, deliberately excluding `new` so that a status endpoint
 * cannot be used to skip the till. A rent-agreement request therefore **cannot reach
 * `draft-shared` from e2e at all**.
 *
 * Valuation is free, opens in `new`, and is worked through the *same* `ServiceTracker` component
 * (`PropertyValuation.jsx` passes `typeFilter="valuation"`, `RentAgreement.jsx` passes
 * `"rental"` — same component, same buttons, same modal). The service type is incidental to every
 * claim below; the maker-checker is not. `ops/live-drafting-desk.spec.js` files a valuation for
 * exactly this reason, and says so.
 *
 * ## A defect this conversion found and fixed
 *
 * `shareDraft` moved the request into `draft-shared` and **told nobody**. `decideDraft` accepts a
 * decision from the requester and from literally nobody else — so an unannounced share stalls the
 * request forever, with each side believing it is the other's move. Twelve other flows already
 * notify through `Notifier`; service requests were the outlier. Fixed in
 * `ServiceRequestService.shareDraft`, and test 1 is what holds it.
 *
 * ## Owned elsewhere, deliberately not re-proved here
 *
 *   - The ops side of the desk — the queue, the filters, the upload form — `ops/live-drafting-desk`.
 *   - Pricing, the `awaiting-payment` park, the 409 — `live-rent-agreement.spec.js`.
 *   - Co-fill invitations — `live-rent-agreement-cofill.spec.js`.
 */

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

/**
 * File a free valuation request for `token`'s account and hand it to the staffer.
 *
 * The property id is not decoration: `POST /{id}/draft` stores a document, and a document hangs
 * off a property — an unlinked request answers 409 "not linked to a property, so documents cannot
 * be attached". A request created without one can never receive a draft, which is a real gap on
 * the cold rent-agreement wizard and is already filed in `tasks/DECISIONS-NEEDED.md`.
 */
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

/**
 * The tracker panel on whichever service page is open.
 *
 * Scoped by its own standing copy rather than by a card locator: every account in this file is
 * minted fresh and files exactly one request, so the panel holds exactly one card and there is
 * nothing to disambiguate. Each test still asserts the request id is on screen, which is what
 * proves the card is *this* row and not a leftover.
 */
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

    // …and that it survives the wire→UI translation. `service.draft-shared` is dotted, so it
    // reaches the page only because `notificationMapper.js` maps it; without that entry it
    // renders as an anonymous grey "system" row and matches no filter chip.
    await signedInAs(page, mobile);
    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
    const row = page.locator('.notif').filter({ hasText: 'Your draft is ready to review' });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.locator('a').first()).toHaveAttribute('href', '/services/property-valuation');
    // Presented as paperwork, not as an anonymous grey "system" row. This is the assertion that
    // actually holds the mapper entry: without it `toUiType` falls through to `system`, and the
    // only visible difference is this swatch — the title, the text and the link are unaffected,
    // so every other assertion here would stay green while the row silently degraded.
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

    // D121: a rejection lands in `changes-requested` — *not* back in the state a request that was
    // never rejected also sits in — and the note is written as the customer's own message on the
    // thread, not buried in `audit_log` where no surface a customer reads would ever show it.
    await expect
      .poll(async () => (await readBack(customer, requestId)).status, { timeout: 15000 })
      .toBe('changes-requested');
    const server = await readBack(customer, requestId);
    // `body`, not `text` — the client's own vocabulary is `text` (`ServiceTracker` renders
    // `x.text`, mapped in `serviceRequestMapper.js`). Asserting the client's spelling against the
    // wire is the mistake that reads as "the note was never recorded" when it was recorded fine.
    const mine2 = server.messages.find((m) => m.body === note);
    expect(mine2, `note missing from thread: ${JSON.stringify(server.messages)}`).toBeTruthy();
    // D121 again: written as the *customer's own* message, not as an ops note and not as a
    // timeline event — that is what puts it on a surface the customer and the operator both
    // already read. Pinned by author id rather than by `authorRole`, which is whatever role the
    // account happens to hold (`buyer` here) and would pass just as happily for a staff author.
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

    // The whole maker-checker: the person who produced the draft must not be the person who
    // accepts it. `POST /draft/decision` carries no `@PreAuthorize` *deliberately* — the rule is
    // "is this the requester", which no role expression can state, and which an
    // "admin can do anything" carve-out would quietly delete. No mock test made this claim,
    // because in the mock the maker and the checker were the same browser.
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
