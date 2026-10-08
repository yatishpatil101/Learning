import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, signedInAsNew } from '../../../helpers/liveAuth.js';

/* This drives the owner's actual grant screen and verifies the write outside the browser, so a
   dashboard-only local copy cannot pass as a database grant. */

/** Not `Sale Deed` (property-integration) and not `Society NOC` (buyer-document-access). */
const CATEGORIES = ['Index II', 'Encumbrance Certificate'];

const BUYER_NAME = 'Priya Docseeker';

const asOwner = () => authHeaders(ACTORS.owner);

/* Multipart uploads need only the bearer; `authHeaders` would replace Playwright's form boundary
   with JSON and be refused as 415. */
async function bearerOnly(mobile) {
  return { authorization: (await authHeaders(mobile)).authorization };
}

/** The owner's newest listing — what `/me/documents/{propId}` is scoped by. */
async function ownedListing(request) {
  const res = await request.get(`${API}/me/listings?size=5`, { headers: await asOwner() });
  expect(res.status()).toBe(200);
  const rows = (await res.json()).content;
  // A floor, not scenery: with no listing the uploads 404 and the failure reads as a broken
  // endpoint rather than as an owner with nothing to share.
  expect(rows.length, 'the fixture owner must hold a listing').toBeGreaterThan(0);
  return rows[0].id;
}

async function upload(request, propId, category) {
  const res = await request.post(`${API}/me/documents/${propId}`, {
    headers: await bearerOnly(ACTORS.owner),
    multipart: {
      category,
      file: {
        name: `${category.replace(/\W+/g, '-').toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4 ${category} for the grant test`),
      },
    },
  });
  expect(res.status(), `uploading ${category}`).toBe(201);
  return (await res.json()).id;
}

/** The owner's inbox row, which is the projection the dashboard renders. */
async function ownerRow(request, reqId) {
  const res = await request.get(`${API}/me/documents/requests?size=50`, { headers: await asOwner() });
  expect(res.status()).toBe(200);
  const row = (await res.json()).content.find((r) => r.id === reqId);
  expect(row, 'the owner must see the request in their inbox').toBeTruthy();
  return row;
}

test.describe('the owner grants a document request from the Leads inbox', () => {
  let propId;
  let docIds = [];
  let reqId;

  test.beforeEach(async ({ request, page }) => {
    propId = await ownedListing(request);
    docIds = [];
    for (const category of CATEGORIES) {
      docIds.push(await upload(request, propId, category));
    }

    const buyer = await signedInAsNew(page);
    const buyerAuth = await authHeaders(buyer);
    /* A registered-but-unnamed account renders blank in the inbox; naming it makes the assertion
       unconditional. */
    const named = await request.patch(`${API}/auth/me`, {
      headers: buyerAuth,
      data: { name: BUYER_NAME },
    });
    expect(named.status(), 'the buyer must be nameable').toBe(200);

    const asked = await request.post(`${API}/documents/requests`, {
      headers: buyerAuth,
      data: { propertyId: propId, categories: CATEGORIES, acknowledgedDisclaimer: true },
    });
    expect(asked.status()).toBe(201);
    reqId = (await asked.json()).id;
  });

  test.afterEach(async ({ request }) => {
    // The database resets per run, not per spec; a leftover document would skew the next grant count.
    for (const docId of docIds) {
      await request.delete(`${API}/me/documents/${propId}/${docId}`, { headers: await asOwner() });
    }
  });

  test('grants from the dashboard UI, and the grant reaches the database', async ({ page, request }) => {
    /* Build the caption from the server row because the API never promised category order. */
    const before = await ownerRow(request, reqId);
    expect(before.status).toBe('pending');
    const caption = `Wants ${before.categories.length} documents: ${before.categories.slice(0, 3).join(', ')}`;

    await signedInAs(page, ACTORS.owner);
    const inbox = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/api/me/dashboard') &&
      r.request().method() === 'GET' &&
      r.status() === 200,
    );
    await page.goto('/dashboard#enquiries');
    await inbox;

    // The Documents sub-tab lists only document requests, grouped one lead per buyer+property.
    await page.getByRole('tab', { name: /Documents/i }).click();

    await expect(page.getByText(BUYER_NAME).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(caption, { exact: false })).toBeVisible();

    const grantAll = page.getByRole('button', { name: 'Grant all' });
    await expect(grantAll).toBeVisible();

    const patched = page.waitForResponse((r) =>
      /\/api\/me\/documents\/requests\/[^/?]+$/.test(r.url()) && r.request().method() === 'PATCH',
    );
    await grantAll.click();
    /* The retired screen-only spec could not catch a dashboard that updated its local inbox and told
       the server nothing. */
    expect((await patched).status(), 'the grant was refused').toBe(200);

    // The toast names the real count from the share ledger, not a blanket "granted". Matched
    // without the leading "Access granted \u2014", whose em dash is not worth a byte-exact matcher.
    await expect(page.getByRole('alert')).toContainText(/2 documents now visible to this buyer/i);

    // After the re-read the group leaves the pending state: the buttons go and the row confirms.
    await expect(page.getByRole('button', { name: 'Grant all' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Open ${BUYER_NAME} details` }).locator('..').getByText('All granted')).toBeVisible();

    /* And the database agrees. `sharedDocumentCount` counts *files*, not categories, which is the
       number that would stay at zero if the grant had matched no uploads. */
    const after = await ownerRow(request, reqId);
    expect(after.status).toBe('granted');
    expect(after.sharedDocumentCount).toBe(CATEGORIES.length);
    expect(after.shareToken, 'a granted row carries the owner-facing forwardable token').toBeTruthy();
  });
});
