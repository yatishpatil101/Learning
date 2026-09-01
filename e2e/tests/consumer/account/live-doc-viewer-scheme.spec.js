import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9QQAAAABJRU5ErkJggg==', 'base64');
const createdDocumentIds = new Set();

async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const named = await fetch(`${API}/auth/me`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name }),
  });
  expect(named.status, 'naming the document owner').toBe(200);
  return { mobile, headers };
}

async function upload(headers, { name, type, bytes }) {
  const form = new FormData();
  form.append('category', 'Aadhaar Card');
  form.append('file', new Blob([bytes], { type }), name);
  const { 'content-type': _jsonContentType, ...multipartHeaders } = headers;
  const response = await fetch(`${API}/me/documents/personal`, {
    method: 'POST',
    headers: multipartHeaders,
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test.afterEach(async () => {
  for (const { mobile, id } of createdDocumentIds) {
    const response = await fetch(`${API}/me/documents/personal/${id}`, {
      method: 'DELETE',
      headers: await authHeaders(mobile),
    });
    expect(response.status, `cleaning up personal document ${id}`).toBe(204);
  }
  createdDocumentIds.clear();
});

test.describe('Document viewer — live storage and content rules', () => {
  test('a server-stored PNG opens through the vetted viewer URL', async ({ page, context }) => {
    const owner = await actor(`Zztest Document Viewer ${Date.now()}`);
    const uploaded = await upload(owner.headers, {
      name: 'identity.png',
      type: 'image/png',
      bytes: PNG,
    });
    expect(uploaded.status, 'uploading a viewable image').toBe(201);
    expect(uploaded.body.url, 'the server response carries a hosted URL, not a browser data URL').not.toMatch(/^data:/);
    createdDocumentIds.add({ mobile: owner.mobile, id: uploaded.body.id });

    await signedInAs(page, owner.mobile);
    await page.goto('/dashboard#documents');
    await expect(page.getByText('identity.png')).toBeVisible();

    const [viewer] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: /^View$/i }).first().click(),
    ]);
    await viewer.waitForURL(/\/api\//);
    expect(viewer.url(), 'the viewer opens the server-owned file URL').toContain('/api/');
    await viewer.close();
  });

  test('an HTML upload is rejected and never becomes a personal-vault row', async () => {
    const owner = await actor(`Zztest Document Reject ${Date.now()}`);
    const before = await fetch(`${API}/me/documents/personal`, { headers: owner.headers });
    expect(before.status, 'reading the empty personal vault').toBe(200);
    const initial = await before.json();

    const rejected = await upload(owner.headers, {
      name: 'unsafe.html',
      type: 'text/html',
      bytes: Buffer.from('<script>window.pwned = true</script>'),
    });
    expect(rejected.status, 'HTML is not an allowed document media type').toBe(415);

    const after = await fetch(`${API}/me/documents/personal`, { headers: owner.headers });
    expect(after.status, 'reading the personal vault after the rejected upload').toBe(200);
    expect(await after.json(), 'the refused upload did not create a previewable row').toEqual(initial);
  });

  test('the shared viewer guard never opens an active data URL', async ({ page }) => {
    await page.goto('/');
    const opened = await page.evaluate(async () => {
      const { openDocUrl } = await import('/src/lib/openDoc.js');
      const original = window.open;
      let calls = 0;
      window.open = () => { calls += 1; return null; };
      try {
        return { result: openDocUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), calls };
      } finally {
        window.open = original;
      }
    });
    expect(opened).toEqual({ result: false, calls: 0 });
  });
});
