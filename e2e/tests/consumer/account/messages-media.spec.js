import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

const BANER_FLAT_ID = '615287b3-7a3b-530f-84aa-773753e8682b';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=',
  'base64',
);

async function actor(request, name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const response = await request.patch(`${API}/auth/me`, { headers, data: { name } });
  expect(response.status()).toBe(200);
  return { mobile, headers, name };
}

async function liveThread(request) {
  const buyer = await actor(request, `Media Buyer ${Date.now()}`);
  const ownerHeaders = await authHeaders(ACTORS.owner);
  await request.patch(`${API}/auth/me`, { headers: ownerHeaders, data: { hideNumber: false } });

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
  await request.patch(`${API}/me/contact-requests/${requestRow.id}`, {
    headers: ownerHeaders,
    data: { status: 'approved' },
  });

  const created = await request.post(`${API}/messages`, {
    headers: buyer.headers,
    data: { propertyId: BANER_FLAT_ID, body: 'Photo thread started.' },
  });
  expect(created.status()).toBe(201);
  return { buyer, conversation: await created.json() };
}

test.describe('Messages media — live API', () => {
  test('sends photos, refuses invalid files and keeps mobile controls usable', async ({ page, browser, request }) => {
    const thread = await liveThread(request);
    const id = thread.conversation.id;
    const caption = `Kitchen photo ${Date.now()}`;

    await signedInAs(page, thread.buyer.mobile);
    await page.goto(`/messages?c=${id}`);
    await expect(page.locator('.pc-input')).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({ name: 'chat.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('dialog', { name: 'Photo preview' })).toBeVisible();
    await page.getByPlaceholder('Add a caption').fill(caption);
    const uploaded = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/messages/${id}/photos`
        && response.request().method() === 'POST'
        && [200, 201].includes(response.status()),
    );
    await page.getByRole('button', { name: 'Send photo' }).click();
    await uploaded;
    await expect(page.locator('.pc-bubble.me', { hasText: caption }).locator('img')).toBeVisible();

    await page.reload();
    await expect(page.locator('.pc-bubble.me', { hasText: caption }).locator('img')).toBeVisible();

    const ownerContext = await browser.newContext();
    try {
      const ownerPage = await ownerContext.newPage();
      await signedInAs(ownerPage, ACTORS.owner);
      await ownerPage.goto(`/messages?c=${id}`);
      await expect(ownerPage.locator('.pc-bubble.them', { hasText: caption }).locator('img')).toBeVisible();
    } finally {
      await ownerContext.close();
    }

    await page.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    const invalidToast = page.locator('[role="alert"]', { hasText: /Upload a JPEG or PNG up to 8 MB/i });
    await expect(invalidToast.first()).toBeVisible();
    await expect(invalidToast).toHaveCount(0, { timeout: 5000 });
    await page.locator('input[type="file"]').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(8_000_001) });
    await expect(invalidToast.first()).toBeVisible();

    await page.addInitScript(() => localStorage.setItem('dz_draaz_nudge', '2'));
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/messages?c=${id}`);
    await expect(page.locator('.pc-input')).toBeVisible();
    for (const selector of ['.pc-attach', '.pc-send']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});
