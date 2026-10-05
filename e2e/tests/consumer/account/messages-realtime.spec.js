import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

const BANER_FLAT_ID = '615287b3-7a3b-530f-84aa-773753e8682b';

async function actor(request, name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const response = await request.patch(`${API}/auth/me`, { headers, data: { name, shareActivityStatus: true, shareReadReceipts: true } });
  expect(response.status()).toBe(200);
  return { mobile, headers, name };
}

async function liveThread(request) {
  const suffix = Date.now();
  const buyer = await actor(request, `Realtime Buyer ${suffix}`);
  const ownerHeaders = await authHeaders(ACTORS.owner);
  await request.patch(`${API}/auth/me`, { headers: ownerHeaders, data: { shareActivityStatus: true, shareReadReceipts: true, hideNumber: false } });

  const contact = await request.post(`${API}/contacts/request`, {
    headers: buyer.headers,
    data: { propertyId: BANER_FLAT_ID },
  });
  expect(contact.status()).toBe(200);

  const inbox = await request.get(`${API}/me/contact-requests?size=20`, { headers: ownerHeaders });
  const requestRow = (await inbox.json()).content.find((row) =>
    row.propertyId === BANER_FLAT_ID && row.requester?.name === buyer.name,
  );
  expect(requestRow).toBeTruthy();

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
  return { buyer, ownerHeaders, conversation: await created.json() };
}

const replyResponse = (page, conversationId) => page.waitForResponse((response) =>
  new URL(response.url()).pathname === `/api/messages/${conversationId}/reply`
    && response.request().method() === 'POST'
    && response.status() === 201,
);

test.describe('Messages realtime — live API', () => {
  test('streams messages, typing, presence and reciprocal ticks', async ({ page, browser, request }) => {
    const thread = await liveThread(request);
    const id = thread.conversation.id;
    const buyerContext = await browser.newContext();
    const buyerPage = await buyerContext.newPage();

    try {
      await buyerPage.bringToFront();
      const buyerStream = buyerPage.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/messages/stream'
          && response.status() === 200
          && (response.headers()['content-type'] || '').includes('text/event-stream'),
      { timeout: 30000 });
      await signedInAs(buyerPage, thread.buyer.mobile);
      await buyerStream;
      await buyerPage.goto(`/messages?c=${id}`);
      await expect(buyerPage.locator('.pc-input')).toBeVisible();

      await signedInAs(page, ACTORS.owner);
      await page.goto(`/messages?c=${id}`);
      await expect(page.locator('.pc-input')).toBeVisible();
      await expect(page.locator('.pc-head-sub')).toContainText(/online/i, { timeout: 5000 });

      await page.locator('.pc-input').fill('I am typing this live');
      await expect(buyerPage.locator('.pc-typing')).toBeVisible({ timeout: 5000 });
      await expect(buyerPage.locator('.pc-head-sub')).toContainText(/typing/i);

      const body = `Realtime owner reply ${Date.now()}`;
      await page.locator('.pc-input').fill(body);
      const started = Date.now();
      await Promise.all([replyResponse(page, id), page.locator('.pc-send').click()]);
      await expect(buyerPage.locator('.pc-bubble.them', { hasText: body })).toBeVisible({ timeout: 5000 });
      expect(Date.now() - started).toBeLessThan(20000);
      await expect(page.locator('.pc-bubble.me', { hasText: body }).locator('.tick.read')).toBeVisible({ timeout: 5000 });

      await request.patch(`${API}/auth/me`, { headers: thread.buyer.headers, data: { shareReadReceipts: false } });
      const noRead = `Delivered not read ${Date.now()}`;
      await page.locator('.pc-input').fill(noRead);
      await Promise.all([replyResponse(page, id), page.locator('.pc-send').click()]);
      await expect(buyerPage.locator('.pc-bubble.them', { hasText: noRead })).toBeVisible({ timeout: 5000 });
      const ownerBubble = page.locator('.pc-bubble.me', { hasText: noRead });
      await expect(ownerBubble.locator('.tick.delivered')).toBeVisible({ timeout: 5000 });
      await expect(ownerBubble.locator('.tick.read')).toHaveCount(0);
    } finally {
      await buyerContext.close();
    }
  });
});
