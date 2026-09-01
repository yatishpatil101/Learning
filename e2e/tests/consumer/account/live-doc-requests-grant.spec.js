import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, signedInAsNew } from '../../../helpers/liveAuth.js';

/*
 * The **owner** grants a document request from the dashboard Leads inbox, against the live API.
 *
 * The sibling `live-buyer-document-access.spec.js` already proves the grant *contract* — but it
 * grants by calling `PATCH /me/documents/requests/{reqId}` directly. Nothing anywhere drove the
 * owner's actual screen, and that screen is the reason the retired mock spec existed: the dashboard
 * used to read its inbox straight from `localStorage` while the Documents tab read it through
 * `documentService`, so the two disagreed and a grant issued from the Leads inbox never reached the
 * server. A test that grants over the API cannot fail for that, because it never touches the
 * surface that was wrong.
 *
 * ## What the mock version could not do
 *
 * Its closing assertion read `puneNestDocReq:<owner>` out of the browser it had just written it in,
 * and checked `sharedDocIds` against two file ids the spec itself had invented. Here the grant is
 * read back through `GET /me/documents/requests` **outside the browser**, so "the seam wrote
 * through" is a statement about Postgres rather than about localStorage.
 *
 * ## Fixture strategy
 *
 * Same discipline as `live-buyer-document-access`, for the same reasons:
 *
 *   - **The buyer is a throwaway** (`signedInAsNew`), never `ACTORS.buyer` — `platform/
 *     live-verification-disclaimer` files a request as Rahul against `p5021` and expects to find it
 *     pending. It is given a real name over `PATCH /auth/me`, because the inbox row is identified on
 *     screen by the requester's name and a freshly registered account has none; deriving the
 *     expected label from an account that might be nameless would make the assertion conditional,
 *     which is a skipped test wearing a assertion's clothes.
 *   - **The two categories are neither `Sale Deed` nor `Society NOC`.** Those slots belong to
 *     `live-property-integration`'s vault round-trip and to `live-buyer-document-access`
 *     respectively, and three specs sharing one vault would take turns failing on each other's
 *     leftovers. Both uploads are removed in teardown.
 */

/** Not `Sale Deed` (live-property-integration) and not `Society NOC` (live-buyer-document-access). */
const CATEGORIES = ['Index II', 'Encumbrance Certificate'];

const BUYER_NAME = 'Priya Docseeker';

const asOwner = () => authHeaders(ACTORS.owner);

/**
 * The bearer alone, for the multipart uploads.
 *
 * `authHeaders` bakes in `content-type: application/json`, which would replace the multipart
 * boundary Playwright builds and be refused as a 415 by `MeDocumentsController`'s `consumes`.
 */
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
    /* A registered-but-unnamed account renders as a blank in the inbox. Naming it makes the
       on-screen identity assertion unconditional. */
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
    // The e2e database resets at the start of a run, not per spec. A file left behind is another
    // document for the next grant to count, and the failure would then name a number.
    for (const docId of docIds) {
      await request.delete(`${API}/me/documents/${propId}/${docId}`, { headers: await asOwner() });
    }
  });

  test('grants from the dashboard UI, and the grant reaches the database', async ({ page, request }) => {
    /* The expected caption is built from what the server says the request contains, not from the
       constant above: `EnquiriesPanel.itemDoc` renders `docTypes.slice(0, 3).join(', ')`, and
       pinning an order the API never promised is how a green spec becomes a flaky one. */
    const before = await ownerRow(request, reqId);
    expect(before.status).toBe('pending');
    const caption = `Wants ${before.categories.length} documents: ${before.categories.slice(0, 3).join(', ')}`;

    await signedInAs(page, ACTORS.owner);
    const inbox = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/api/me/documents/requests') &&
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
    /* The write, on the wire. This is the assertion the retired spec had no way to make, and the
       exact regression it was blind to: a dashboard that decided the request in its own copy of the
       inbox rendered every screen below correctly and told the server nothing. */
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

