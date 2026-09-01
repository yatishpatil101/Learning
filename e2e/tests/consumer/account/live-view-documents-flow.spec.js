import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

const SHARED_CATEGORIES = ['Index II', 'Encumbrance Certificate'];
const EMPTY_CATEGORY = `Zztest awaiting upload ${Date.now()}`;

const asOwner = () => authHeaders(ACTORS.owner);

async function bearerOnly(mobile) {
  return { authorization: (await authHeaders(mobile)).authorization };
}

async function ownedListing(request) {
  const response = await request.get(`${API}/me/listings?size=5`, { headers: await asOwner() });
  expect(response.status()).toBe(200);
  const rows = (await response.json()).content;
  expect(rows.length, 'the fixture owner must hold a listing').toBeGreaterThan(0);
  return rows[0].id;
}

async function upload(request, propId, category) {
  const response = await request.post(`${API}/me/documents/${propId}`, {
    headers: await bearerOnly(ACTORS.owner),
    multipart: {
      category,
      file: {
        name: `${category.replace(/\W+/g, '-').toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4 ${category} viewer-flow fixture`),
      },
    },
  });
  expect(response.status(), `uploading ${category}`).toBe(201);
  return (await response.json()).id;
}

async function ownerRequest(request, requestId) {
  const response = await request.get(`${API}/me/documents/requests?size=50`, { headers: await asOwner() });
  expect(response.status()).toBe(200);
  const row = (await response.json()).content.find((item) => item.id === requestId);
  expect(row, 'the owner must see the document request').toBeTruthy();
  return row;
}

async function grantedRequest(page, request, propId, categories) {
  const buyer = await signedInAsNew(page);
  const buyerHeaders = await authHeaders(buyer);
  const asked = await request.post(`${API}/documents/requests`, {
    headers: buyerHeaders,
    data: { propertyId: propId, categories, acknowledgedDisclaimer: true },
  });
  expect(asked.status()).toBe(201);
  const requestId = (await asked.json()).id;

  const granted = await request.patch(`${API}/me/documents/requests/${requestId}`, {
    headers: await asOwner(),
    data: { status: 'granted' },
  });
  expect(granted.status()).toBe(200);

  const notices = await request.get(`${API}/notifications`, { headers: buyerHeaders });
  expect(notices.status()).toBe(200);
  const notice = (await notices.json()).content.find((item) =>
    item.type === 'document.granted' && item.link === `/view-documents/${requestId}`,
  );
  expect(notice, 'the server notification must carry the requester-safe viewer link').toBeTruthy();
  return { buyerHeaders, requestId, notice };
}

function viewerRead(page, requestId) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/me/document-requests/${requestId}/documents`
    && response.request().method() === 'GET'
    && response.status() === 200,
  );
}

test.describe('the live shared-document viewer', () => {
  let propId;
  let docIds;

  test.beforeEach(async ({ request }) => {
    propId = await ownedListing(request);
    docIds = [];
  });

  test.afterEach(async ({ request }) => {
    for (const docId of docIds) {
      const deleted = await request.delete(`${API}/me/documents/${propId}/${docId}`, { headers: await asOwner() });
      expect(deleted.status(), `cleaning up document ${docId}`).toBe(204);
    }
  });

  test('shows every server-matched document from the grant notification without offering a download', async ({ page, request }) => {
    for (const category of SHARED_CATEGORIES) {
      docIds.push(await upload(request, propId, category));
    }

    const grant = await grantedRequest(page, request, propId, SHARED_CATEGORIES);
    const stored = await ownerRequest(request, grant.requestId);
    expect(stored.status).toBe('granted');
    expect(stored.sharedDocumentCount).toBe(SHARED_CATEGORIES.length);

    const read = viewerRead(page, grant.requestId);
    await page.goto(grant.notice.link);
    await read;
    await expect(page.getByRole('heading', { name: 'Shared Documents' })).toBeVisible();
    for (const category of SHARED_CATEGORIES) {
      const filename = `${category.toLowerCase().replace(/\W+/g, '-')}.pdf`;
      await expect(page.getByRole('tab', { name: new RegExp(filename.replace('.', '\\.')) })).toBeVisible();
    }
    await expect(page.getByText('2 documents shared for your review.')).toBeVisible();
    await expect(page.getByRole('button', { name: /download/i })).toHaveCount(0);
    await expect(page.locator('a[download], a[href*="/documents/"]')).toHaveCount(0);
  });

  test('shows the honest awaiting-upload state after a server grant matches no files', async ({ page, request }) => {
    const grant = await grantedRequest(page, request, propId, [EMPTY_CATEGORY]);
    const stored = await ownerRequest(request, grant.requestId);
    expect(stored.status).toBe('granted');
    expect(stored.sharedDocumentCount).toBe(0);

    const read = viewerRead(page, grant.requestId);
    await page.goto(grant.notice.link);
    await read;
    await expect(page.getByRole('heading', { name: 'Shared Documents' })).toBeVisible();
    await expect(page.getByText('Documents not uploaded yet')).toBeVisible();
    await expect(page.getByRole('button', { name: /download/i })).toHaveCount(0);
    await expect(page.locator('a[download], a[href*="/documents/"]')).toHaveCount(0);
  });
});