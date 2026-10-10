import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

const CATEGORY = `Zztest payload ${Date.now()}`;

const asOwner = () => authHeaders(ACTORS.owner);

async function bearerOnly(mobile) {
  return { authorization: (await authHeaders(mobile)).authorization };
}

test.describe('documents are listed as metadata and signed when opened', () => {
  let propId;
  let docId;

  test.beforeEach(async ({ request }) => {
    const listings = await request.get(`${API}/me/listings?size=5`, { headers: await asOwner() });
    propId = (await listings.json()).content[0].id;
    const up = await request.post(`${API}/me/documents/${propId}`, {
      headers: await bearerOnly(ACTORS.owner),
      multipart: { category: CATEGORY, file: { name: 'payload.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 payload fixture') } },
    });
    expect(up.status()).toBe(201);
    docId = (await up.json()).id;
  });

  test.afterEach(async ({ request }) => {
    await request.delete(`${API}/me/documents/${propId}/${docId}`, { headers: await asOwner() });
  });

  test('the owner vault carries no url, a stranger cannot mint one, and a buyer opens a granted file by click', async ({ page, request }) => {
    const mine = await (await request.get(`${API}/me/documents/${propId}`, { headers: await asOwner() })).json();
    const row = mine.find((d) => d.id === docId);
    expect(Object.keys(row).sort()).toEqual(['category', 'fileName', 'id', 'mimeType', 'sizeBytes', 'uploadedAt']);

    const minted = await request.get(`${API}/me/documents/${docId}/url`, { headers: await asOwner() });
    expect(minted.status()).toBe(200);
    expect((await minted.json()).url).toBeTruthy();

    const buyer = await signedInAsNew(page);
    const buyerAuth = await authHeaders(buyer);
    const stranger = await request.get(`${API}/me/documents/${docId}/url`, { headers: buyerAuth });
    expect(stranger.status()).toBe(404);

    const asked = await request.post(`${API}/documents/requests`, {
      headers: buyerAuth,
      data: { propertyId: propId, categories: [CATEGORY], acknowledgedDisclaimer: true },
    });
    expect(asked.status()).toBe(201);
    const requestId = (await asked.json()).id;
    const grant = await request.patch(`${API}/me/documents/requests/${requestId}`, { headers: await asOwner(), data: { status: 'granted' } });
    expect(grant.status()).toBe(200);

    const inbox = await (await request.get(`${API}/me/documents/requests?size=100`, { headers: await asOwner() })).json();
    expect(inbox.content.find((r) => r.id === requestId)).not.toHaveProperty('shareToken');

    const signed = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/me/document-requests/${requestId}/documents/${docId}/url`);
    await page.goto(`/view-documents/${requestId}`);
    expect((await signed).status()).toBe(200);
  });
});

test('the support list is one summary per ticket with no thread and no author id', async ({ page, request }) => {
  const mobile = await signedInAsNew(page);
  const headers = await authHeaders(mobile);
  const created = await request.post(`${API}/support/tickets`, {
    headers,
    data: { subject: 'Payload guard', category: 'other', body: 'x'.repeat(300) },
  });
  expect(created.status()).toBe(201);

  const list = await (await request.get(`${API}/support/tickets`, { headers })).json();
  expect(list).toHaveLength(1);
  expect(list[0]).not.toHaveProperty('messages');
  expect(list[0].lastMessage.body.length).toBeLessThanOrEqual(161);
  expect(typeof list[0].unread).toBe('boolean');

  const detail = await (await request.get(`${API}/support/tickets/${list[0].id}`, { headers })).json();
  expect(detail.messages).toHaveLength(1);
  expect(detail.messages[0]).not.toHaveProperty('authorId');

  await page.goto('/support');
  await expect(page.getByText('Payload guard')).toBeVisible();
});
