import { ACTORS, expect, test } from '../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../helpers/liveAuth.js';

const BODY = async (title, auth) => ({
  title,
  deal: 'rent',
  propertyType: 'apartment',
  price: 25000,
  locality: 'Kothrud',
  city: 'Pune',
  images: await uploadedListingPhotos(auth),
});

// `uniqueMobile()` can collide within one millisecond, merging distinct owners.
let seq = 0;
const newOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

// Post a listing as a brand-new owner and hand back its id.
async function freshListing(request, title) {
  const headers = await authHeaders(newOwner());
  const res = await request.post(`${API}/me/listings`, { headers, data: await BODY(title, headers) });
  expect(res.status(), await res.text()).toBe(201);
  return { id: (await res.json()).id, headers };
}

// 404, not 403: the public read must not confirm that an unapproved listing exists.
async function expectNotPublic(request, id) {
  expect((await request.get(`${API}/properties/${id}`)).status()).toBe(404);
}

const REVIEW_CHECKLIST = [
  'Photos are real and match the listing',
  'Not a duplicate of another listing',
  'Details and location look right',
];

async function tickChecklist(request, id, headers) {
  const opened = await request.post(`${API}/properties/${id}/verification/start`, { headers });
  expect(opened.status(), await opened.text()).toBe(200);
  for (const item of REVIEW_CHECKLIST) {
    const ticked = await request.patch(`${API}/properties/${id}/verification/checklist`, {
      headers,
      data: { item, pass: true },
    });
    expect(ticked.status(), await ticked.text()).toBe(200);
  }
}

test.describe('listing publication (live)', () => {
  test('a pending listing is invisible, and clearing a flag does not publish it', async ({ request }) => {
    const admin = await authHeaders(ACTORS.admin);
    const { id } = await freshListing(request, 'Flag-clear publication probe');

    // Assert public 404 because stranger unreadability is the promise.
    await expectNotPublic(request, id);

    // Flagged state is console-only, so this follows the moderator path.
    const flagged = await request.post(`${API}/properties/${id}/flag`, {
      headers: admin,
      data: { reason: 'Reported by a neighbour' },
    });
    expect(flagged.status(), await flagged.text()).toBeLessThan(300);

    const cleared = await request.delete(`${API}/properties/${id}/flag`, { headers: admin });
    expect(cleared.status()).toBe(204);

    // Reply must not become a second publication route.
    await expectNotPublic(request, id);
  });

  test('approving from the queue publishes, whether pressed once or in bulk', async ({ request }) => {
    const admin = await authHeaders(ACTORS.admin);

    // Two listings through the same route, because "Approve selected" is a loop over the single-row action.
    const single = await freshListing(request, 'Single approve probe');
    const bulk = await freshListing(request, 'Bulk approve probe');

    for (const { id } of [single, bulk]) {
      await tickChecklist(request, id, admin);
      const approved = await request.patch(`${API}/properties/${id}/status`, {
        headers: admin,
        data: { status: 'approved' },
      });
      expect(approved.status(), await approved.text()).toBeLessThan(300);
    }

    for (const { id } of [single, bulk]) {
      const read = await request.get(`${API}/properties/${id}`);
      expect(read.status(), `approved listing ${id} is still not publicly readable`).toBe(200);
      expect((await read.json()).status).toBe('approved');
    }
  });

  test('a rejected listing stays final when its owner replies', async ({ request }) => {
    const admin = await authHeaders(ACTORS.admin);
    const { id, headers } = await freshListing(request, 'Rectification loop probe');

    // Open the case file as the owner, then reject it with a reason.
    const opened = await request.post(`${API}/properties/${id}/verification`, { headers });
    expect(opened.status(), await opened.text()).toBe(201);

    const rejected = await request.post(`${API}/properties/${id}/verification/decision`, {
      headers: admin,
      data: { decision: 'reject', reasonCode: 'document_unreadable', note: 'The electricity bill is not legible.' },
    });
    expect(rejected.status(), await rejected.text()).toBe(200);
    await expectNotPublic(request, id);

    // Owner replies must reopen fixable rejections, not leave them terminal.
    const replied = await request.post(`${API}/properties/${id}/verification/messages`, {
      headers,
      data: { body: 'Re-uploaded a clearer scan of the bill.' },
    });
    expect(replied.status(), await replied.text()).toBe(201);

    const caseFile = await request.get(`${API}/properties/${id}/verification`, { headers });
    expect(caseFile.status()).toBe(200);
    expect((await caseFile.json()).status).toBe('rejected');

    await expectNotPublic(request, id);
  });
});
