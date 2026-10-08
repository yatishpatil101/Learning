import { test, expect } from '../../../fixtures/live.js';
import { ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

/* Buyer grants must be readable by JWT while owner share tokens stay redacted; this spec builds and
   tears down its own vault data so shared seeded requests cannot cross-contaminate. */

/** Not `Sale Deed`: that slot belongs to `property-integration`'s vault round-trip. */
const CATEGORY = 'Society NOC';

const asOwner = () => authHeaders(ACTORS.owner);

/* Multipart uploads need only the bearer; `authHeaders` would replace Playwright's form boundary
   with JSON and be refused before controller code runs. */
async function bearerOnly(mobile) {
  return { authorization: (await authHeaders(mobile)).authorization };
}

/** The owner's newest listing id, which is what `/me/documents/{propId}` is scoped by. */
async function ownedListing(request) {
  const res = await request.get(`${API}/me/listings?size=5`, { headers: await asOwner() });
  expect(res.status()).toBe(200);
  const rows = (await res.json()).content;
    /* Use the public anchor listing; moderation-only rows upload fine but leave the browser route
      stuck in its legacy loading state. */
    const row = rows.find((listing) => listing.slug === 'p5021');
    expect(row, 'the published p5021 fixture must remain owned by Meera').toBeTruthy();
    return { id: row.id, ref: row.slug };
}

async function uploadNoc(request, propId) {
  const res = await request.post(`${API}/me/documents/${propId}`, {
    headers: await bearerOnly(ACTORS.owner),
    multipart: {
      category: CATEGORY,
      file: {
        name: 'live-society-noc.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 live buyer-access test'),
      },
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

/** The buyer's own row, read back through the requester projection rather than the owner inbox. */
async function myRequest(request, buyerMobile, reqId) {
  const res = await request.get(`${API}/me/document-requests?size=50`, {
    headers: await authHeaders(buyerMobile),
  });
  expect(res.status()).toBe(200);
  const row = (await res.json()).content.find((r) => r.id === reqId);
  expect(row, 'the buyer must be able to find the request they just wrote').toBeTruthy();
  return row;
}

/** The same row through the **owner's** projection, which is the one that carries the token. */
async function ownerInbox(request, reqId) {
  const res = await request.get(`${API}/me/documents/requests?size=50`, { headers: await asOwner() });
  expect(res.status()).toBe(200);
  const row = (await res.json()).content.find((r) => r.id === reqId);
  expect(row, 'the owner must see the request in their inbox').toBeTruthy();
  return row;
}

/* Strip only traceId so two 404 bodies can be compared without restoring the existence oracle the
   shared status code removes. */
const refusal = async (res) => {
  const { traceId, ...rest } = await res.json();
  expect(traceId, 'every refusal carries a trace id').toBeTruthy();
  return rest;
};

test.describe('a granted buyer can open their documents without the owner forwarding anything', () => {
  let propId;
  let propRef;
  let docId;

  test.beforeEach(async ({ request }) => {
    const property = await ownedListing(request);
    propId = property.id;
    propRef = property.ref;
    docId = await uploadNoc(request, propId);
  });

  test.afterEach(async ({ request }) => {
    // The database resets per run, not per spec; a leftover NOC would make the next grant count two.
    if (docId) {
      await request.delete(`${API}/me/documents/${propId}/${docId}`, { headers: await asOwner() });
    }
  });

  test('the grant is readable by JWT, and the token is never echoed to the requester', async ({ page, request }) => {
    const buyer = await signedInAsNew(page);
    const buyerAuth = await authHeaders(buyer);

    const asked = await request.post(`${API}/documents/requests`, {
      headers: buyerAuth,
      data: { propertyId: propId, categories: [CATEGORY], acknowledgedDisclaimer: true },
    });
    expect(asked.status()).toBe(201);
    const reqId = (await asked.json()).id;

    /* A pending ask is not permission to inventory the vault, so the file-derived count must stay
       zero until the owner decides. */
    const pending = await myRequest(request, buyer, reqId);
    expect(pending.status).toBe('pending');
    expect(pending.sharedDocumentCount).toBe(0);
    expect(pending.shareToken).toBeNull();

    // And the door is shut, not merely empty: "your access has not started" and "there is nothing
    // behind it" are different facts, and only one of them is true here.
    const early = await request.get(`${API}/me/document-requests/${reqId}/documents`, { headers: buyerAuth });
    expect(early.status()).toBe(404);

    const granted = await request.patch(`${API}/me/documents/requests/${reqId}`, {
      headers: await asOwner(),
      data: { status: 'granted' },
    });
    expect(granted.status()).toBe(200);
    /* The owner inbox carries the forwardable token; PATCH is empty by contract so state changes do
       not echo bearer credentials. */
    const ownerRow = await ownerInbox(request, reqId);
    expect(ownerRow.status).toBe('granted');
    expect(ownerRow.shareToken).toBeTruthy();

    const live = await myRequest(request, buyer, reqId);
    expect(live.status).toBe('granted');
    expect(live.sharedDocumentCount).toBe(1);
    /* The load-bearing assertion of this file. The buyer is entitled to the *documents* and is not
       entitled to a credential that unlocks them for anyone holding it. */
    expect(live.shareToken).toBeNull();

    const opened = await request.get(`${API}/me/document-requests/${reqId}/documents`, { headers: buyerAuth });
    expect(opened.status()).toBe(200);
    const docs = await opened.json();
    expect(docs).toHaveLength(1);
    expect(docs[0].category).toBe(CATEGORY);

    /* Assert and follow the server-emitted grant link; a `page.goto` assembled here would miss a
       broken notification deep link. */
    const notes = await request.get(`${API}/notifications`, { headers: buyerAuth });
    expect(notes.status()).toBe(200);
    const grantNote = (await notes.json()).content.find((n) => n.type === 'document.granted');
    expect(grantNote, 'the grant notifies the requester').toBeTruthy();
    expect(grantNote.link).toBe(`/view-documents/${reqId}`);
    // The credential stays out of the stored row; that is why the id is safe to put in one.
    expect(grantNote.link).not.toContain(ownerRow.shareToken);
    expect(grantNote.body).not.toContain(ownerRow.shareToken);

    /* The viewer must be reachable from the buyer's own request id; masked owner numbers cannot be
       part of the URL contract. */
    await page.goto(grantNote.link);
    await expect(page.getByText('1 document shared for your review.')).toBeVisible();
    await expect(page.getByText('live-society-noc.pdf')).toBeVisible();
  });

  test('possessing the request id buys a stranger nothing', async ({ page, request }) => {
    const buyer = await signedInAsNew(page);
    const asked = await request.post(`${API}/documents/requests`, {
      headers: await authHeaders(buyer),
      data: { propertyId: propId, categories: [CATEGORY], acknowledgedDisclaimer: true },
    });
    expect(asked.status()).toBe(201);
    const reqId = (await asked.json()).id;

    await request.patch(`${API}/me/documents/requests/${reqId}`, {
      headers: await asOwner(),
      data: { status: 'granted' },
    });

    /* The stranger and invented-id refusals must match; distinguishable 404s reveal another
       person's paperwork request exists. */
    const stranger = await signedInAsNew(page);
    const foreign = await request.get(`${API}/me/document-requests/${reqId}/documents`, {
      headers: await authHeaders(stranger),
    });
    expect(foreign.status()).toBe(404);
    const invented = await request.get(
      `${API}/me/document-requests/00000000-0000-0000-0000-000000000000/documents`,
      { headers: await authHeaders(stranger) },
    );
    expect(invented.status()).toBe(404);
    // Compared, not just counted: two distinguishable 404s restore the existence oracle the status
    // code was chosen to remove.
    expect(await refusal(foreign)).toEqual(await refusal(invented));

    // Anonymous is refused by authentication, before any of the above is even consulted.
    const anonymous = await request.get(`${API}/me/document-requests/${reqId}/documents`);
    expect(anonymous.status()).toBe(401);

    /* The page is signed in as the stranger, so this is what a forwarded request id actually shows. */
    await page.goto(`/view-documents/${reqId}`);
    await expect(page.getByText('Access not available')).toBeVisible();
  });

  test('a declined request is shown as declined, not as still under review', async ({ page, request }) => {
    const buyer = await signedInAsNew(page);
    const buyerAuth = await authHeaders(buyer);
    const asked = await request.post(`${API}/documents/requests`, {
      headers: buyerAuth,
      /* Use a visible checklist category; the uploaded NOC is sixth and would make the declined-chip
         assertion vacuous. */
      data: { propertyId: propId, categories: ['Sale Deed'], acknowledgedDisclaimer: true },
    });
    expect(asked.status()).toBe(201);
    const reqId = (await asked.json()).id;

    const declined = await request.patch(`${API}/me/documents/requests/${reqId}`, {
      headers: await asOwner(),
      data: { status: 'declined' },
    });
    expect(declined.status()).toBe(200);
    expect((await myRequest(request, buyer, reqId)).status).toBe('declined');

    /* The property page must reflect a final decline, not invite one-click repeat pressure or
       promise a future owner answer. */
    const propertyRead = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/properties/${encodeURIComponent(propRef)}`;
    });
    await page.goto(`/property/${propRef}`);
    expect((await propertyRead).status()).toBe(200);
    await page.getByRole('tab', { name: /Verification & Docs/i }).click();
    await expect(page.getByText('Owner declined', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('The owner declined this request.', { exact: true })).toBeVisible();
    await expect(page.getByText('Request sent — owner reviewing', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Request to view documents' })).toHaveCount(0);
  });
});
