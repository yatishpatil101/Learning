import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
/* Each test creates a thread for a unique buyer: the named seed conversation is shared by other
   specs, so writing to it would leak messages across retries and suppress the next run's replies. */

const OWNER_MESSAGE = 'Thursday after six suits me. I will share the gate code.';
const BANER_FLAT_ID = '615287b3-7a3b-530f-84aa-773753e8682b';

async function actor(request, name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const response = await request.patch(`${API}/auth/me`, { headers, data: { name } });
  expect(response.status(), `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

async function liveThread(request) {
  const suffix = Date.now();
  const buyer = await actor(request, `Live Inbox Buyer ${suffix}`);
  const ownerHeaders = await authHeaders(ACTORS.owner);
  const ownerProfile = await request.patch(`${API}/auth/me`, {
    headers: ownerHeaders,
    data: { hideNumber: false },
  });
  expect(ownerProfile.status(), 'owner allows approved buyers to call').toBe(200);

  const contact = await request.post(`${API}/contacts/request`, {
    headers: buyer.headers,
    data: { propertyId: BANER_FLAT_ID },
  });
  expect(contact.status()).toBe(200);
  expect((await contact.json()).status).toBe('pending');

  const inbox = await request.get(`${API}/me/contact-requests?size=20`, { headers: ownerHeaders });
  expect(inbox.status()).toBe(200);
  const requestRow = (await inbox.json()).content.find((row) =>
    row.propertyId === BANER_FLAT_ID && row.requester?.name === buyer.name,
  );
  expect(requestRow, 'the owner must receive the buyer contact request').toBeTruthy();

  const granted = await request.patch(`${API}/me/contact-requests/${requestRow.id}`, {
    headers: ownerHeaders,
    data: { status: 'approved' },
  });
  expect(granted.status()).toBe(200);

  const created = await request.post(`${API}/messages`, {
    headers: buyer.headers,
    data: { propertyId: BANER_FLAT_ID, body: 'Hello, is this flat still available?' },
  });
  expect(created.status()).toBe(201);
  const conversation = await created.json();

  const ownerReply = await request.post(`${API}/messages/${conversation.id}/reply`, {
    headers: ownerHeaders,
    data: { body: OWNER_MESSAGE },
  });
  expect(ownerReply.status()).toBe(201);

  return { buyer, conversation, propertyTitle: conversation.propertyTitle };
}

const replyResponse = (page, conversationId) => page.waitForResponse((response) => {
  const request = response.request();
  return new URL(response.url()).pathname === `/api/messages/${conversationId}/reply`
    && request.method() === 'POST'
    && response.status() === 201;
});

test.describe('Messages inbox — live API', () => {
  let thread;

  test.beforeEach(async ({ request }) => {
    thread = await liveThread(request);
  });

  test('a buyer sends quick and typed messages through the real thread', async ({ page }) => {
    const typedMessage = `Live inbox message ${Date.now()}`;

    await signedInAs(page, thread.buyer.mobile);
    await page.goto('/');
    // The fixture owner reply is unread, so the app-level indicator has real server data.
    await expect(page.locator('a[href="/messages"]').first().locator('span').first()).toHaveText(/\d+/);

    const detail = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/messages/${thread.conversation.id}` && response.status() === 200,
    );
    await page.goto(`/messages?c=${thread.conversation.id}`);
    await detail;

    await expect(page.locator('.pc-list-head h2')).toHaveText('Messages');
    // The list first renders a real row, then the deliberately unmatched query reaches its empty state.
    await expect(page.locator('.pc-conv').first()).toBeVisible();
    await expect(page.locator('.pc-bubble.them', { hasText: OWNER_MESSAGE })).toBeVisible();
    await expect(page.locator('.pc-head-actions a[href^="tel:+91"]').first()).toHaveAttribute('href', /^tel:\+91\d{10}$/);

    const quickReply = page.locator('.pc-quick-chip').first();
    await expect(quickReply).toBeVisible();
    const quickText = await quickReply.textContent();
    const [quickResponse] = await Promise.all([replyResponse(page, thread.conversation.id), quickReply.click()]);
    expect((await quickResponse.json()).body).toBe(quickText);

    await page.locator('.pc-input').fill(typedMessage);
    const [typedResponse] = await Promise.all([replyResponse(page, thread.conversation.id), page.locator('.pc-send').click()]);
    expect((await typedResponse.json()).body).toBe(typedMessage);
    await expect(page.locator('.pc-bubble.me', { hasText: typedMessage })).toBeVisible();

    await page.reload();
    await expect(page.locator('.pc-bubble.me', { hasText: quickText })).toBeVisible();
    await expect(page.locator('.pc-bubble.me', { hasText: typedMessage })).toBeVisible();
    await expect(page.locator('.pc-conv').first()).toBeVisible();
    await page.locator('.pc-search input').fill('zzzz-no-live-conversation');
    await expect(page.locator('.pc-empty-list')).toBeVisible();
  });

  test('the owner sees the requester contact and can open the report modal', async ({ page }) => {
    await signedInAs(page, ACTORS.owner);
    await page.goto(`/messages?c=${thread.conversation.id}`);

    await expect(page.locator('.pc-bubble.them', { hasText: /Hello, is this flat still available/i })).toBeVisible();
    await expect(page.locator('.pc-input')).toBeVisible();
    await expect(page.locator('.pc-head-actions a[href^="tel:+91"]').first()).toHaveAttribute('href', /^tel:\+91\d{10}$/);

    await page.getByRole('button', { name: 'Conversation actions' }).click();
    await page.getByRole('button', { name: 'Report this user' }).click();
    await expect(page.getByRole('dialog', { name: /Report/i })).toBeVisible();
  });

  test('staged chats stay in Requests and are scoped to the signed-in user', async ({ page, request }) => {
    const first = await actor(request, `Staged Buyer A ${Date.now()}`);
    const second = await actor(request, `Staged Buyer B ${Date.now()}`);
    const title = `Private staged chat ${Date.now()}`;

    await signedInAs(page, first.mobile);
    await page.goto('/');
    const firstUserId = await page.evaluate(() => JSON.parse(localStorage.getItem('draazyUser')).id);
    await page.evaluate(({ userId, title: stagedTitle }) => {
      localStorage.setItem('dzPendingRequests', JSON.stringify([{
        kind: 'chat',
        userId,
        propertyId: 'local-staged-property',
        at: Date.now(),
        property: { title: stagedTitle, price: '₹28,000/mo', loc: 'Baner', img: '' },
        party: { name: 'Private Owner', role: 'Owner' },
        firstMessage: 'Private staged message',
      }]));
    }, { userId: firstUserId, title });

    await page.goto('/messages');
    await expect(page.locator('.pc-conv[data-staged="true"]')).toHaveCount(0);
    await page.getByRole('tab', { name: /Requests/ }).click();
    await expect(page.locator('.pc-conv[data-staged="true"]', { hasText: title })).toBeVisible();

    await signedInAs(page, second.mobile);
    await page.goto('/messages');
    await page.getByRole('tab', { name: /Requests/ }).click();
    await expect(page.locator('.pc-conv', { hasText: title })).toHaveCount(0);
  });

  test('thread actions reach the server: delete for me, mute, archive and block', async ({ page }) => {
    const id = thread.conversation.id;
    const read = async () => {
      const res = await fetch(`${API}/messages/${id}`, { headers: thread.buyer.headers });
      expect(res.status).toBe(200);
      return res.json();
    };
    const call = (method, suffix) => page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/messages/${id}${suffix}`
        && response.request().method() === method && response.ok());

    await signedInAs(page, thread.buyer.mobile);
    await page.goto(`/messages?c=${id}`);
    const ownerBubble = page.locator('.pc-bubble.them', { hasText: OWNER_MESSAGE });
    await expect(ownerBubble).toBeVisible();

    await ownerBubble.click({ button: 'right' });
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/api/messages/${id}/items/`) && r.ok()),
      page.getByRole('menuitem', { name: 'Delete for me' }).click(),
    ]);
    await expect(ownerBubble).toHaveCount(0);
    expect((await read()).messages.some((m) => m.body === OWNER_MESSAGE), 'delete for me is per-account').toBe(false);

    const actions = page.getByRole('button', { name: 'Conversation actions' });
    await actions.click();
    await Promise.all([call('PATCH', '/state'), page.locator('.pc-menu').getByRole('button', { name: 'Mute', exact: true }).click()]);
    expect((await read()).muted).toBe(true);

    await actions.click();
    await Promise.all([call('POST', '/block'), page.locator('.pc-menu').getByRole('button', { name: 'Block', exact: true }).click()]);
    const ownerReply = await fetch(`${API}/messages/${id}/reply`, {
      method: 'POST',
      headers: await authHeaders(ACTORS.owner),
      body: JSON.stringify({ body: 'Are you still there?' }),
    });
    expect(ownerReply.status, 'a blocked counterparty cannot keep messaging').toBe(403);

    await actions.click();
    await Promise.all([call('PATCH', '/state'), page.locator('.pc-menu').getByRole('button', { name: 'Archive', exact: true }).click()]);
    expect((await read()).archived).toBe(true);
    await expect(page.getByRole('button', { name: /Archived \(\d+\)/ })).toBeVisible();
  });

  test('the dashboard Messages entry delegates to the canonical inbox', async ({ page }) => {
    await signedInAs(page, thread.buyer.mobile);
    const inbox = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/messages' && response.status() === 200,
    );
    await page.goto('/dashboard#messages');

    await page.waitForURL(/\/messages/);
    await inbox;
    await expect(page.locator('.pc-list-head h2')).toHaveText('Messages');
    await expect(page.locator('.pc-conv', { hasText: thread.propertyTitle })).toBeVisible();
  });
});
