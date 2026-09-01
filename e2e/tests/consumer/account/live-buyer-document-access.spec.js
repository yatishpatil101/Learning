import { test, expect } from '../../../fixtures/live.js';
import { ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

/* The **buyer's** half of the document gate, against the live API.
 *
 * Until this slice the seam was drawn on the owner's side only: a buyer's request was written into
 * the *owner's* `localStorage` under a key derived from `p.ownerMobile` — which on a live detail
 * read is the **masked** number until the contact gate is passed, while the owner's dashboard reads
 * its inbox under the real one. Live, the request was filed where its owner would never look.
 *
 * ## Why this spec exists, and what no other one can prove
 *
 * `platform/live-verification-disclaimer` drives the *submit* through the property page and asserts
 * the chips flip to "Awaiting owner". That is the write. Nothing anywhere asserted the **read**, and
 * the read is where the product promise lived:
 *
 *   - `shareToken` is **owner-facing by contract** — it is minted for the owner so they can forward
 *     the link to a lawyer or a banker deliberately. A buyer therefore only ever reached their own
 *     approved papers if the owner *chose* to forward it. A buyer whose owner never did saw the
 *     status "Granted" on the listing and a dead end.
 *   - The fix is emphatically **not** to hand the buyer the token: their own request list would then
 *     be a bearer credential, and one leaked page of JSON would unlock every vault they have ever
 *     been let into, for the full life of each grant. So the token stays redacted on the requester
 *     projection and `GET /me/document-requests/{reqId}/documents` gives them a read that needs no
 *     forwardable credential at all.
 *
 * Both of those are *negative* properties of a JSON response, and a mock provider cannot hold an
 * opinion about either: a mock has no reason to hide anything from itself, and there is no token in
 * it to redact. This is the class of bug that is invisible to the provider that lacks the field.
 *
 * ## Fixture strategy
 *
 * `docs/system/fixture-registry.md` publishes no seeded `document` fixtures, so this spec builds its
 * own world over the API and takes it down again. Two deliberate choices:
 *
 *   - **The buyer is a fresh account** (`signedInAsNew`), never `ACTORS.buyer`. The e2e database
 *     persists for a whole run and `platform/live-verification-disclaimer` files a request as Rahul
 *     against `p5021`; granting one for the same pair here would decide a row that spec expects to
 *     find pending, forty tests away and looking like flakiness.
 *   - **The uploaded file is deleted in teardown**, and its category is `Society NOC` rather than
 *     the `Sale Deed` slot `live-property-integration`'s vault round-trip occupies. Two specs
 *     writing the same slot of the same vault would take turns failing on each other's leftovers.
 *
 * Fixtures: `ACTORS.owner` (Meera — holds the anchor listings), one throwaway buyer per test, one
 * `Society NOC` file uploaded and removed within the spec.
 */

/** Not `Sale Deed`: that slot belongs to `live-property-integration`'s vault round-trip. */
const CATEGORY = 'Society NOC';

const asOwner = () => authHeaders(ACTORS.owner);

/**
 * The bearer alone, for the one multipart write here.
 *
 * `authHeaders` bakes in `content-type: application/json`, which is right for every other call in
 * this file and fatal for an upload: the declared JSON type replaces the `multipart/form-data`
 * boundary Playwright built, and `MeDocumentsController` pins `consumes` to multipart precisely so
 * that the wrong content type is refused as a 415 before any of its code runs. It is — watched.
 */
async function bearerOnly(mobile) {
  return { authorization: (await authHeaders(mobile)).authorization };
}

/** The owner's newest listing id, which is what `/me/documents/{propId}` is scoped by. */
async function ownedListing(request) {
  const res = await request.get(`${API}/me/listings?size=5`, { headers: await asOwner() });
  expect(res.status()).toBe(200);
  const rows = (await res.json()).content;
  // A floor, not scenery: with no listing every assertion below would fail as a 404 on the upload,
  // which reads as a broken endpoint rather than as an owner who has nothing to share.
  expect(rows.length).toBeGreaterThan(0);
  return rows[0].id;
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

/**
 * An error body with its per-request `traceId` removed.
 *
 * The comparison this enables is the point — two refusals that differ anywhere else restore the
 * existence oracle the shared 404 was chosen to remove — and the trace id is the one field that
 * must differ, being how an operator finds this exact request in the log.
 */
const refusal = async (res) => {
  const { traceId, ...rest } = await res.json();
  expect(traceId, 'every refusal carries a trace id').toBeTruthy();
  return rest;
};

test.describe('a granted buyer can open their documents without the owner forwarding anything', () => {
  let propId;
  let docId;

  test.beforeEach(async ({ request }) => {
    propId = await ownedListing(request);
    docId = await uploadNoc(request, propId);
  });

  test.afterEach(async ({ request }) => {
    // The e2e database is reset at the *start* of a run, not per spec, so a file left behind is a
    // second `Society NOC` for the next test's grant to count — its `sharedDocumentCount` would
    // then read 2 and the failure would name a number rather than a leak.
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

    /* A pending ask is not permission to inventory a stranger's private vault. The count is the
       only number on this row that is derived from files the buyer cannot see, so it is the one
       that has to stay at zero until the owner has actually decided. */
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
    /* The owner's own projection *does* carry the token — that is the forwardable link they were
       given to send on. Asserting it here is what makes the buyer-side redaction below evidence of
       a deliberate redaction rather than of a token that was never minted.

       Read from the inbox rather than from the PATCH, which answers 200 with an **empty body** by
       contract precisely so the token is never handed back on the response to a state change; the
       owner refetches for it. */
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

    /* The buyer is the only party who does not already know the owner decided, so the notification
       is the whole of how they find out — and register 37 made it point at the grant rather than at
       the listing. Asserting the *link* and then navigating by it, instead of by a URL this file
       built, is what makes the two halves one claim: a server that stopped emitting the deep link
       would still pass a `page.goto` the spec assembled itself. */
    const notes = await request.get(`${API}/notifications`, { headers: buyerAuth });
    expect(notes.status()).toBe(200);
    const grantNote = (await notes.json()).content.find((n) => n.type === 'document.granted');
    expect(grantNote, 'the grant notifies the requester').toBeTruthy();
    expect(grantNote.link).toBe(`/view-documents/${reqId}`);
    // The credential stays out of the stored row; that is why the id is safe to put in one.
    expect(grantNote.link).not.toContain(ownerRow.shareToken);
    expect(grantNote.body).not.toContain(ownerRow.shareToken);

    /* Through the browser, because the endpoint answering is only half the promise: the viewer has
       to be reachable from a URL the buyer can construct out of their own request id. It used to be
       `/view-documents?o=<owner mobile>&r=<id>`, which a live buyer could not build at all — the
       owner's number arrives masked. */
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

    /* 404 rather than 403, and the same 404 as an id that never existed: a distinguishable refusal
       would confirm that this listing has a buyer asking after its paperwork, which is a fact about
       somebody else's dealings. */
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

    /* And the stranger's browser sees the refusal as a refusal. `page` is signed in as the stranger
       (the last `signedInAsNew` won), so this is the screen a forwarded id actually produces. */
    await page.goto(`/view-documents/${reqId}`);
    await expect(page.getByText('Access not available')).toBeVisible();
  });
});

